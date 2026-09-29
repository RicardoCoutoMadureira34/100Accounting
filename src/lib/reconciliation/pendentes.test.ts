import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionFor, buildPendentesWorkbook, computeMapa, pendentesFilename } from "./pendentes";
import type { ProbableGroup, Tx, UnmatchedRow } from "./results";

// Par 3 ("Coluna Montante com sinal") de "PDFs de teste RB": números reais do
// RESULTADO ESPERADO.txt, para confirmar que o mapa fecha em 0,00.
const tx = (id: string, date: string, description: string, amount: number, reference: string | null = null): Tx => ({
  id,
  transaction_date: date,
  description,
  amount,
  reference,
});

const unmatched = (t: Tx, category: string | null, note: string | null): UnmatchedRow => ({ ...t, category, note });

describe("actionFor", () => {
  it("banco: comissão, débito não registado e erro de transcrição -> lançar", () => {
    assert.equal(actionFor("bank", "comissao_juro_bancario", null), "Lançar na contabilidade");
    assert.equal(actionFor("bank", "debito_nao_registado", null), "Lançar na contabilidade");
    assert.equal(actionFor("bank", "erro_transcricao", null), "Lançar na contabilidade");
    assert.equal(actionFor("bank", "outro", null), "Lançar na contabilidade");
  });

  it("banco: movimento de mês anterior -> nenhuma, seja qual for a categoria", () => {
    const note = "Movimento já lançado na contabilidade num mês anterior. Explica a diferença de saldos iniciais de 1.250,00 €. Não é preciso lançar de novo.";
    assert.equal(actionFor("bank", "cheque_em_transito", note), "Nenhuma — já lançado em mês anterior");
  });

  it("contabilidade: cheque/depósito em trânsito -> aguardar", () => {
    assert.equal(actionFor("acct", "cheque_em_transito", null), "Aguardar — em trânsito (não lançar)");
    assert.equal(actionFor("acct", "deposito_em_transito", null), "Aguardar — em trânsito (não lançar)");
  });

  it("contabilidade: duplicado -> anular; erro/outro -> verificar", () => {
    assert.equal(actionFor("acct", "duplicado", null), "Anular lançamento duplicado");
    assert.equal(actionFor("acct", "erro_transcricao", null), "Verificar lançamento");
    assert.equal(actionFor("acct", "outro", null), "Verificar lançamento");
  });
});

describe("computeMapa: Par 3 (coluna Montante, fevereiro 2026)", () => {
  const priorNote =
    "Movimento já lançado na contabilidade num mês anterior e só agora apareceu no banco. Explica a diferença de saldos iniciais de 1.250,00 €. Não é preciso lançar de novo.";

  const bankOnly: UnmatchedRow[] = [
    unmatched(tx("b1", "2026-02-03", "CHEQUE 998877", -1250), "cheque_em_transito", priorNote),
    unmatched(tx("b2", "2026-02-27", "JUROS CREDORES", 3.12), "comissao_juro_bancario", null),
    unmatched(tx("b3", "2026-02-27", "RETENCAO IRC S/ JUROS", -0.78), "comissao_juro_bancario", null),
  ];
  const acctOnly: UnmatchedRow[] = [
    unmatched(tx("a1", "2026-02-17", "Pagamento Fornecedor Teta FT 331", -612, "FT 331"), "duplicado", "lançado 2 vezes na contabilidade"),
    unmatched(tx("a2", "2026-02-27", "Recebimento paciente - transferência", 420), "deposito_em_transito", null),
  ];
  const probable: ProbableGroup[] = [
    {
      matchId: "p1",
      groupId: "g1",
      status: "pending",
      bank: [tx("pb1", "2026-02-10", "TPA", 845.3)],
      accounting: [tx("pa1", "2026-02-03", "Venda 1", 300), tx("pa2", "2026-02-05", "Venda 2", 245.3), tx("pa3", "2026-02-09", "Venda 3", 300)],
    },
    {
      matchId: "p2",
      groupId: null,
      status: "pending",
      bank: [tx("pb2", "2026-02-13", "Levantamento", -89.95)],
      accounting: [tx("pa4", "2026-02-13", "Levantamento", -90)],
    },
  ];

  const mapaInput = {
    bankClose: 1591.11,
    acctClose: 1396.72,
    bankOpen: 8905.2,
    acctOpen: 7655.2,
    bankOnly,
    acctOnly,
    probable,
  };

  it("líquidos, diferença de valor e diferença de saldos iniciais batem com o esperado", () => {
    const m = computeMapa(mapaInput);
    assert.equal(m.liquidBank, -1247.66);
    assert.equal(m.liquidAcct, -192);
    assert.equal(m.diffValor, 0.05);
    assert.equal(m.diffOpening, 1250);
  });

  it("saldo contabilístico calculado bate com o saldo real (diferença por explicar = 0,00)", () => {
    const m = computeMapa(mapaInput);
    assert.equal(m.calculated, 1396.72);
    assert.equal(m.explain, 0);
  });

  it("o workbook tem as 3 folhas e o nome do ficheiro usa o mês do período", () => {
    const input = { createdAt: "2026-03-01T10:00:00Z", periodStart: "2026-02-01", periodEnd: "2026-02-28", ...mapaInput, bankBalance: mapaInput.bankClose, accountingBalance: mapaInput.acctClose, bankOpeningBalance: mapaInput.bankOpen, accountingOpeningBalance: mapaInput.acctOpen };
    const wb = buildPendentesWorkbook(input);
    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ["Só no Banco", "Só na Contabilidade", "Mapa de reconciliação"]
    );
    assert.equal(pendentesFilename(input), "Pendentes_Reconciliacao_2026-02.xlsx");

    const bankSheet = wb.getWorksheet("Só no Banco")!;
    // Cabeçalho a negrito.
    assert.equal(bankSheet.getRow(1).getCell(1).font?.bold, true);
    // As 3 linhas de "Só no Banco" + 2 subtotais (Lançar / Nenhuma) + total geral = 6 linhas de dados.
    assert.equal(bankSheet.rowCount, 1 + 3 + 2 + 1);

    const acctSheet = wb.getWorksheet("Só na Contabilidade")!;
    const refs = new Set<unknown>();
    acctSheet.eachRow((row) => refs.add(row.getCell(2).value));
    assert.ok(refs.has("FT 331"), "N.º documento não aparece na folha"); // N.º documento
  });

  it("sem movimentos: as folhas e o mapa não rebentam", () => {
    const input = {
      createdAt: "2026-03-01T10:00:00Z",
      periodStart: null,
      periodEnd: null,
      bankBalance: 100,
      accountingBalance: 100,
      bankOpeningBalance: 100,
      accountingOpeningBalance: 100,
      bankOnly: [],
      acctOnly: [],
      probable: [],
    };
    const wb = buildPendentesWorkbook(input);
    assert.equal(wb.worksheets.length, 3);
    assert.equal(computeMapa({ bankClose: 100, acctClose: 100, bankOpen: 100, acctOpen: 100, bankOnly: [], acctOnly: [], probable: [] }).explain, 0);
  });
});
