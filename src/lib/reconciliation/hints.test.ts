import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectHints } from "./hints";
import { matchMovements, type MatchingResult, type MTx } from "./matching";

const tx = (id: number, date: string, description: string, euros: number): MTx => ({
  id,
  date,
  description,
  reference: null,
  cents: Math.round(euros * 100),
});

const onlyUnmatched = (unmatchedBank: MTx[], unmatchedAcct: MTx[]): MatchingResult => ({
  exact: [],
  probable: [],
  unmatchedBank,
  unmatchedAcct,
});

describe("indicação: duplicados", () => {
  it("lançamento repetido na contabilidade (o banco só tem um movimento)", () => {
    const bank = [tx(0, "2026-06-10", "PAG FORNECEDOR X", -50)];
    const acct = [tx(0, "2026-06-10", "PAG FORNECEDOR X", -50), tx(1, "2026-06-11", "PAG FORNECEDOR X", -50)];
    const m = matchMovements(bank, acct);
    assert.equal(m.exact.length, 1);
    assert.deepEqual(m.unmatchedAcct.map((t) => t.id), [1]);

    const h = detectHints({ matching: m, bankOpening: null, acctOpening: null });
    const hint = h.acct.get(1)!;
    assert.equal(hint.kind, "duplicate");
    assert.equal(hint.category, "duplicado");
    assert.match(hint.observation, /Possível lançamento em duplicado de PAG FORNECEDOR X de 50,00 €/);
    assert.match(hint.observation, /O banco só tem um movimento; verificar e anular o lançamento repetido\./);
    assert.equal(h.bank.size, 0);
  });

  it("movimento repetido no banco (a contabilidade só tem um lançamento)", () => {
    const bank = [tx(0, "2026-06-10", "COMPRA LOJA ABC", -20), tx(1, "2026-06-10", "COMPRA LOJA ABC", -20)];
    const acct = [tx(0, "2026-06-10", "Compra loja ABC", -20)];
    const m = matchMovements(bank, acct);
    const h = detectHints({ matching: m, bankOpening: null, acctOpening: null });
    assert.equal(h.bank.get(1)?.category, "duplicado");
    assert.match(h.bank.get(1)!.observation, /A contabilidade só tem um lançamento/);
  });

  it("descrição muito semelhante também conta", () => {
    const bank = [tx(0, "2026-06-10", "TRF P/O JOAO SILVA LDA", -300)];
    const acct = [tx(0, "2026-06-10", "TRF P/O JOAO SILVA LDA", -300), tx(1, "2026-06-12", "TRF P/O JOAO SILVA", -300)];
    const h = detectHints({ matching: matchMovements(bank, acct), bankOpening: null, acctOpening: null });
    assert.equal(h.acct.get(1)?.kind, "duplicate");
  });

  it("não marca se a descrição é diferente, a data está a mais de 3 dias ou o valor difere", () => {
    const bank = [tx(0, "2026-06-10", "PAG FORNECEDOR X", -50)];
    const base = tx(0, "2026-06-10", "PAG FORNECEDOR X", -50);
    for (const other of [
      tx(1, "2026-06-11", "ELECTRICIDADE DO NORTE", -50),
      tx(1, "2026-06-15", "PAG FORNECEDOR X", -50),
      tx(1, "2026-06-11", "PAG FORNECEDOR X", -90),
    ]) {
      const m = matchMovements(bank, [base, other]);
      const h = detectHints({ matching: m, bankOpening: null, acctOpening: null });
      assert.equal(h.acct.size, 0, `não devia marcar ${other.description} ${other.date} ${other.cents}`);
    }
  });

  it("não marca se o outro movimento igual também ficou sem correspondência (nada foi reconciliado)", () => {
    const m = onlyUnmatched([], [tx(0, "2026-06-10", "PAG X", -50), tx(1, "2026-06-10", "PAG X", -50)]);
    const h = detectHints({ matching: m, bankOpening: null, acctOpening: null });
    assert.equal(h.acct.size, 0);
  });
});

describe("indicação: movimentos de meses anteriores", () => {
  // banco 388,19 vs contabilidade 5.445,73: diferença de -5.057,54
  const OPENINGS = { bankOpening: 388.19, acctOpening: 5445.73 };

  it("só no banco: um movimento igual a -(diferença de saldos iniciais)", () => {
    const m = onlyUnmatched([tx(0, "2026-06-10", "DEPOSITO CHEQUE 123", 5057.54), tx(1, "2026-06-11", "OUTRO", 12)], []);
    const h = detectHints({ matching: m, ...OPENINGS });
    const hint = h.bank.get(0)!;
    assert.equal(hint.kind, "prior_period");
    assert.equal(hint.category, null, "mantém a categoria escolhida");
    assert.match(hint.observation, /Movimento já lançado na contabilidade num mês anterior e só agora apareceu no banco\./);
    assert.match(hint.observation, /Explica a diferença de saldos iniciais de 5057,54 €\./);
    assert.match(hint.observation, /Não é preciso lançar de novo\./);
    assert.equal(h.bank.has(1), false);
  });

  it("só no banco: um conjunto de até 3 movimentos cuja soma explica a diferença", () => {
    const m = onlyUnmatched(
      [tx(0, "2026-06-03", "DEP A", 3000), tx(1, "2026-06-04", "DEP B", 2000), tx(2, "2026-06-05", "DEP C", 57.54), tx(3, "2026-06-06", "OUTRO", 8)],
      []
    );
    const h = detectHints({ matching: m, ...OPENINGS });
    assert.deepEqual([...h.bank.keys()].sort(), [0, 1, 2]);
    assert.match(h.bank.get(0)!.observation, /Em conjunto com DEP B de 2000,00 € e DEP C de 57,54 € explica a diferença de saldos iniciais de 5057,54 €/);
  });

  it("só na contabilidade: valor igual à diferença de saldos iniciais (banco acima)", () => {
    const m = onlyUnmatched([], [tx(0, "2026-06-30", "Recebimento", 5057.54)]);
    const h = detectHints({ matching: m, bankOpening: 5445.73, acctOpening: 388.19 });
    assert.match(h.acct.get(0)!.observation, /Movimento já registado no banco num mês anterior e só agora lançado na contabilidade\. Explica a diferença de saldos iniciais de 5057,54 €\. Não é preciso lançar de novo\./);
  });

  it("exige igualdade ao cêntimo", () => {
    const m = onlyUnmatched([tx(0, "2026-06-10", "DEPOSITO", 5057.53)], []);
    assert.equal(detectHints({ matching: m, ...OPENINGS }).bank.size, 0);
  });

  it("sinal contrário não explica a diferença", () => {
    const m = onlyUnmatched([tx(0, "2026-06-10", "PAGAMENTO", -5057.54)], []);
    assert.equal(detectHints({ matching: m, ...OPENINGS }).bank.size, 0);
  });

  it("sem diferença de saldos iniciais (ou sem saldos) não há indicação", () => {
    const m = onlyUnmatched([tx(0, "2026-06-10", "DEPOSITO", 5057.54)], []);
    assert.equal(detectHints({ matching: m, bankOpening: 100, acctOpening: 100 }).bank.size, 0);
    assert.equal(detectHints({ matching: m, bankOpening: null, acctOpening: 100 }).bank.size, 0);
  });

  it("um conjunto de 4 movimentos já não conta", () => {
    const m = onlyUnmatched(
      [tx(0, "2026-06-03", "A", 2000), tx(1, "2026-06-04", "B", 2000), tx(2, "2026-06-05", "C", 1000), tx(3, "2026-06-06", "D", 57.54)],
      []
    );
    assert.equal(detectHints({ matching: m, ...OPENINGS }).bank.size, 0);
  });
});
