import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchMovements, usesMonthEndDates, type MTx } from "./matching";

let nextId = 0;
const tx = (date: string, description: string, euros: number, id = nextId++): MTx => ({
  id,
  date,
  description,
  reference: null,
  cents: Math.round(euros * 100),
});

describe("emparelhamento: valor repetido", () => {
  it("emparelha pela ordem em que aparecem e deixa sem correspondência os que sobram", () => {
    const bank = [tx("2026-06-02", "PAG A", -50, 0), tx("2026-06-09", "PAG B", -50, 1), tx("2026-06-16", "PAG C", -50, 2)];
    const acct = [tx("2026-06-02", "Pagamento A", -50, 0), tx("2026-06-09", "Pagamento B", -50, 1)];
    const r = matchMovements(bank, acct);

    assert.equal(r.exact.length, 2);
    assert.deepEqual(r.exact.map((e) => [e.bank.id, e.acct.id]), [[0, 0], [1, 1]]);
    assert.deepEqual(r.unmatchedBank.map((t) => t.id), [2]);
    assert.equal(r.unmatchedAcct.length, 0);
    assert.equal(r.probable.length, 0);
  });

  it("cada movimento é usado uma única vez", () => {
    const bank = [tx("2026-06-02", "A", 100, 0), tx("2026-06-03", "B", 100, 1)];
    const acct = [tx("2026-06-02", "A", 100, 0)];
    const r = matchMovements(bank, acct);
    const usedAcct = r.exact.map((e) => e.acct.id);
    assert.equal(new Set(usedAcct).size, usedAcct.length);
    assert.equal(r.exact.length, 1);
    assert.equal(r.unmatchedBank.length, 1);
  });

  it("valor igual mas sinal contrário não emparelha", () => {
    const r = matchMovements([tx("2026-06-02", "A", -75, 0)], [tx("2026-06-02", "A", 75, 0)]);
    assert.equal(r.exact.length, 0);
    assert.equal(r.unmatchedBank.length, 1);
    assert.equal(r.unmatchedAcct.length, 1);
  });

  it("é determinístico: as mesmas entradas dão as mesmas saídas", () => {
    const bank = [tx("2026-06-02", "A", -10, 0), tx("2026-06-05", "B", -10, 1), tx("2026-06-07", "C", 35.5, 2)];
    const acct = [tx("2026-06-30", "X", -10, 0), tx("2026-06-30", "Y", -10, 1), tx("2026-06-30", "Z", 35.5, 2)];
    assert.deepEqual(matchMovements(bank, acct), matchMovements([...bank].reverse(), [...acct].reverse()));
  });
});

describe("emparelhamento: contabilidade datada no fim do mês", () => {
  const bank = [
    tx("2026-06-03", "TRF JOAO", -120, 0),
    tx("2026-06-11", "COMPRA CONTINENTE", -45.9, 1),
    tx("2026-06-19", "TRF CLIENTE", 800, 2),
    tx("2026-06-25", "COMISSAO", -7.5, 3),
  ];
  const acct = [
    tx("2026-06-30", "Pagamento fornecedor", -120, 0),
    tx("2026-06-30", "Compra material", -45.9, 1),
    tx("2026-06-30", "Recebimento cliente", 800, 2),
    tx("2026-06-30", "Despesas bancárias", -7.5, 3),
  ];

  it("deteta o padrão de datas de fim de mês", () => {
    assert.equal(usesMonthEndDates(acct), true);
  });

  it("não marca como prováveis por causa da data (tudo exact)", () => {
    const r = matchMovements(bank, acct);
    assert.equal(r.exact.length, 4);
    assert.equal(r.probable.length, 0);
    assert.equal(r.unmatchedBank.length + r.unmatchedAcct.length, 0);
  });

  it("sem esse padrão, datas afastadas mais de 7 dias passam a prováveis", () => {
    const spread = [
      tx("2026-06-01", "A", -20, 0),
      tx("2026-06-08", "B", -30, 1),
      tx("2026-06-15", "C", -40, 2),
    ];
    const bankFar = [tx("2026-06-20", "A", -20, 0), tx("2026-06-08", "B", -30, 1), tx("2026-06-15", "C", -40, 2)];
    assert.equal(usesMonthEndDates(spread), false);
    const r = matchMovements(bankFar, spread);
    assert.equal(r.exact.length, 2);
    assert.equal(r.probable.length, 1);
    assert.equal(r.probable[0].kind, "date");
    assert.match(r.probable[0].reason, /19 dias/);
  });
});

describe("emparelhamento: um-para-vários", () => {
  it("30 + 60 + 130 no banco = 220 na contabilidade", () => {
    const bank = [
      tx("2026-06-04", "LEVANTAMENTO ATM", -30, 0),
      tx("2026-06-09", "LEVANTAMENTO ATM", -60, 1),
      tx("2026-06-15", "LEVANTAMENTO ATM", -130, 2),
      tx("2026-06-20", "COMPRA OUTRA", -13.13, 3),
    ];
    const acct = [tx("2026-06-30", "Levantamentos ATM", -220, 0)];
    const r = matchMovements(bank, acct);

    assert.equal(r.exact.length, 0);
    assert.equal(r.probable.length, 1);
    const g = r.probable[0];
    assert.equal(g.kind, "group");
    assert.deepEqual(g.bank.map((t) => t.id), [0, 1, 2]);
    assert.deepEqual(g.acct.map((t) => t.id), [0]);
    assert.match(g.reason, /30,00/);
    assert.deepEqual(r.unmatchedBank.map((t) => t.id), [3]);
    assert.equal(r.unmatchedAcct.length, 0);
  });

  it("funciona no sentido inverso (um movimento do banco = vários lançamentos)", () => {
    const bank = [tx("2026-06-10", "PAGAMENTO SALARIOS", -500, 0)];
    const acct = [tx("2026-06-10", "Salário A", -300, 0), tx("2026-06-10", "Salário B", -200, 1)];
    const r = matchMovements(bank, acct);
    assert.equal(r.probable.length, 1);
    assert.deepEqual(r.probable[0].bank.map((t) => t.id), [0]);
    assert.deepEqual(r.probable[0].acct.map((t) => t.id), [0, 1]);
  });

  it("prefere o subconjunto com descrições semelhantes", () => {
    const bank = [
      tx("2026-06-02", "SEGURO VIDA", -100, 0),
      tx("2026-06-02", "SEGURO AUTO", -120, 1),
      tx("2026-06-03", "COMPRA LOJA", -100, 2),
      tx("2026-06-03", "COMPRA OUTRA", -120, 3),
    ];
    const acct = [tx("2026-06-30", "Seguro", -220, 0)];
    const r = matchMovements(bank, acct);
    assert.deepEqual(r.probable[0].bank.map((t) => t.id), [0, 1]);
  });

  it("não usa um movimento em dois grupos", () => {
    const bank = [tx("2026-06-01", "A", -30, 0), tx("2026-06-02", "B", -60, 1), tx("2026-06-03", "C", -90, 2)];
    const acct = [tx("2026-06-30", "X", -90.5, 0), tx("2026-06-30", "Y", -30 - 60, 1)];
    const r = matchMovements(bank, acct);
    const used = r.probable.flatMap((p) => p.bank.map((t) => t.id));
    assert.equal(new Set(used).size, used.length);
  });
});

describe("emparelhamento: valor quase igual e dígitos trocados", () => {
  it("valor até 1 € de diferença é provável", () => {
    const r = matchMovements([tx("2026-06-05", "TRF", -250.5, 0)], [tx("2026-06-05", "Transferência", -250, 0)]);
    assert.equal(r.probable.length, 1);
    assert.equal(r.probable[0].kind, "near");
    assert.match(r.probable[0].reason, /0,50/);
  });

  it("dígitos trocados (1.250,00 vs 1.520,00) são prováveis", () => {
    const r = matchMovements([tx("2026-06-05", "FATURA", -1250, 0)], [tx("2026-06-06", "Fatura", -1520, 0)]);
    assert.equal(r.probable.length, 1);
    assert.equal(r.probable[0].kind, "transposed");
  });

  it("valores muito diferentes ficam sem correspondência", () => {
    const r = matchMovements([tx("2026-06-05", "A", -100, 0)], [tx("2026-06-05", "A", -300, 0)]);
    assert.equal(r.probable.length, 0);
    assert.equal(r.unmatchedBank.length, 1);
    assert.equal(r.unmatchedAcct.length, 1);
  });

  it("confiança fica entre 0 e 100", () => {
    const r = matchMovements([tx("2026-06-05", "A", -100.4, 0)], [tx("2026-06-05", "A", -100, 0)]);
    for (const p of r.probable) assert.ok(p.confidence >= 0 && p.confidence <= 100);
  });
});
