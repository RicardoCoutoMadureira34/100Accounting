import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnsFromInOut, describeProblem, reviewStatement, type ReviewDoc, type ReviewLineInput } from "./review";
import { mergeReads, prepareDocument, readStatement, splitIntoChunks, type StatementRead } from "./read-statement";
import { buildPdf, fakeModelClient } from "./test-utils";

const doc = (over: Partial<ReviewDoc> = {}): ReviewDoc => ({
  openingBalance: 1000,
  closingBalance: 1080,
  totalDebits: null,
  totalCredits: null,
  openingRowDebits: null,
  openingRowCredits: null,
  ...over,
});

const l = (date: string, description: string, debit: number | null, credit: number | null, balanceAfter: number | null): ReviewLineInput => ({
  date,
  description,
  debit,
  credit,
  balanceAfter,
});

// Extrato bancário: 1000 -> -50 -> +200 -> -20 -> -50 -> 1080
const full: ReviewLineInput[] = [
  l("2026-03-02", "A", 50, null, 950),
  l("2026-03-03", "B", null, 200, 1150),
  l("2026-03-04", "C", 20, null, 1130),
  l("2026-03-05", "D", 50, null, 1080),
];

describe("passo 2: verificação que aponta a linha", () => {
  it("leitura certa: confirmada, sem linha problemática", () => {
    const r = reviewStatement("bank", doc(), full);
    assert.equal(r.ok, true);
    assert.equal(r.firstBadIndex, null);
    assert.equal(r.differenceCents, 0);
    assert.equal(r.totalInCents, 20000);
    assert.equal(r.totalOutCents, 12000);
    assert.deepEqual(r.computedBalanceCents, [95000, 115000, 113000, 108000]);
  });

  it("falta um movimento: aponta a primeira linha onde o saldo corrido deixa de bater", () => {
    // sem o movimento C (-20): a linha D já não bate
    const missing = [full[0], full[1], full[3]];
    const r = reviewStatement("bank", doc(), missing);
    assert.equal(r.ok, false);
    assert.equal(r.firstBadIndex, 2, "a linha D (índice 2) é a primeira que não bate");
    assert.equal(r.differenceCents, -2000, "o saldo calculado fica 20,00 € acima do indicado");
    assert.equal(describeProblem(r), "A leitura não bate certo por 20,00 €");
    // saldo calculado vs saldo do documento
    assert.equal(r.computedBalanceCents[2], 110000);
  });

  it("valor lido errado numa linha: aponta essa linha", () => {
    const wrong = full.map((x) => ({ ...x }));
    wrong[1] = { ...wrong[1], credit: 220 };
    const r = reviewStatement("bank", doc(), wrong);
    assert.equal(r.firstBadIndex, 1);
    assert.equal(r.differenceCents, -2000);
  });

  it("não corrige sinais em silêncio (o utilizador pode ter editado)", () => {
    const flipped = full.map((x) => ({ ...x }));
    flipped[0] = { ...flipped[0], debit: null, credit: 50 }; // entrada em vez de saída
    const r = reviewStatement("bank", doc(), flipped);
    assert.equal(r.ok, false);
    assert.equal(r.firstBadIndex, 0);
    assert.equal(r.verification.corrections.length, 0);
    assert.equal(r.amountCents[0], 5000, "fica com o sinal que lá está");
  });

  it("depois de acrescentar o movimento em falta a leitura volta a bater certo", () => {
    const missing = [full[0], full[1], full[3]];
    const fixed = [missing[0], missing[1], l("2026-03-04", "C", 20, null, 1130), missing[2]];
    assert.equal(reviewStatement("bank", doc(), fixed).ok, true);
  });

  it("sem coluna de saldo só há a comparação global (não se indica linha)", () => {
    const noBalance = full.map((x) => ({ ...x, balanceAfter: null }));
    const missing = [noBalance[0], noBalance[1], noBalance[3]];
    const r = reviewStatement("bank", doc(), missing);
    assert.equal(r.ok, false);
    assert.equal(r.hasBalanceColumn, false);
    assert.equal(r.firstBadIndex, null);
    assert.equal(r.differenceCents, -2000);
  });

  it("sem saldos nem totais não dá para confirmar", () => {
    const r = reviewStatement("bank", doc({ openingBalance: null, closingBalance: null }), full.map((x) => ({ ...x, balanceAfter: null })));
    assert.equal(r.verifiable, false);
    assert.equal(r.ok, false);
    assert.match(describeProblem(r), /Não foi possível confirmar/);
  });

  it("razão da contabilidade (Débito é entrada) e conversão entrada/saída", () => {
    const acct = [l("2026-03-02", "Recebimento", 200, null, 1200), l("2026-03-03", "Pagamento", null, 50, 1150)];
    const r = reviewStatement("accounting", doc({ closingBalance: 1150 }), acct);
    assert.equal(r.ok, true);
    assert.deepEqual(r.amountCents, [20000, -5000]);

    assert.deepEqual(columnsFromInOut("bank", 200, null), { debit: null, credit: 200, amountCents: 20000 });
    assert.deepEqual(columnsFromInOut("bank", null, 50), { debit: 50, credit: null, amountCents: -5000 });
    assert.deepEqual(columnsFromInOut("accounting", 200, null), { debit: 200, credit: null, amountCents: 20000 });
    assert.deepEqual(columnsFromInOut("accounting", null, 50), { debit: null, credit: 50, amountCents: -5000 });
  });
});

describe("PDFs longos: leitura por blocos de páginas", () => {
  const pages = Array.from({ length: 9 }, (_, i) => `texto da pagina ${i + 1} com movimentos de teste`);

  it("até 4 páginas é um só bloco; acima, blocos de 4 com a numeração real das páginas", () => {
    assert.equal(splitIntoChunks(pages.slice(0, 4)).length, 1);
    const chunks = splitIntoChunks(pages);
    assert.deepEqual(chunks.map((c) => [c.from, c.to, c.total]), [[1, 4, 9], [5, 8, 9], [9, 9, 9]]);
    assert.match(chunks[1].text, /=== Página 5 ===/);
    assert.doesNotMatch(chunks[1].text, /=== Página 4 ===/);
  });

  it("junta as linhas por ordem, o saldo inicial do primeiro bloco e o final/totais do último", async () => {
    const pdf = buildPdf(pages.map((text) => [{ x: 40, y: 700, text }]));
    const empty = (over: Partial<StatementRead>): StatementRead => ({
      readable: true,
      issues: [],
      periodStart: null,
      periodEnd: null,
      sourceName: null,
      openingBalance: null,
      closingBalance: null,
      documentTotalDebits: null,
      documentTotalCredits: null,
      openingRowDebits: null,
      openingRowCredits: null,
      lines: [],
      ...over,
    });
    const { client, calls } = fakeModelClient((_s, userText) => {
      const nums = [...userText.matchAll(/=== Página (\d+) ===/g)].map((m) => Number(m[1]));
      const first = nums[0];
      const last = nums[nums.length - 1];
      return empty({
        openingBalance: first === 1 ? 0 : null,
        closingBalance: last === 9 ? 90 : null,
        documentTotalCredits: last === 9 ? 90 : null,
        sourceName: first === 1 ? "Banco Exemplo" : null,
        lines: nums.map((n) => ({
          date: `2026-06-0${n}`,
          description: `MOV PAG ${n}`,
          reference: null,
          debit: null,
          credit: 10,
          balanceAfter: null,
          page: n,
        })),
      });
    });
    const out = await readStatement(await prepareDocument("bank", pdf), { client });

    assert.equal(calls.length, 3, "3 blocos: páginas 1-4, 5-8 e 9");
    assert.match(calls[0].userText, /BLOCO do documento: as páginas 1 a 4 de 9/);
    assert.match(calls[2].userText, /BLOCO do documento: as páginas 9 a 9 de 9/);
    assert.deepEqual(out.read.lines.map((x) => x.description), pages.map((_, i) => `MOV PAG ${i + 1}`));
    assert.equal(out.read.openingBalance, 0);
    assert.equal(out.read.closingBalance, 90);
    assert.equal(out.read.sourceName, "Banco Exemplo");
    assert.equal(out.verified, true, "0 + 9 x 10 = 90 e o total de créditos bate");
  });

  it("mergeReads: primeiro valor para saldo inicial, último para saldo final e totais", () => {
    const base = {
      readable: true,
      issues: [],
      periodStart: null,
      periodEnd: null,
      sourceName: null,
      openingRowDebits: null,
      openingRowCredits: null,
      documentTotalDebits: null,
      documentTotalCredits: null,
      lines: [],
    };
    const merged = mergeReads([
      { ...base, openingBalance: 5, closingBalance: 7, issues: ["a"] },
      { ...base, openingBalance: 6, closingBalance: 9, issues: ["a", "b"] },
    ]);
    assert.equal(merged.openingBalance, 5);
    assert.equal(merged.closingBalance, 9);
    assert.deepEqual(merged.issues, ["a", "b"]);
  });
});
