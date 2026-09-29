import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveLists, type MatchRow, type Tx } from "./results";

const tx = (id: string, date: string, description: string, amount: number): Tx => ({
  id,
  transaction_date: date,
  description,
  amount,
  reference: null,
});

const row = (over: Partial<MatchRow> & Pick<MatchRow, "id" | "match_type">): MatchRow => ({
  confidence: null,
  category: null,
  group_id: null,
  note: null,
  status: "pending",
  bank_transaction: null,
  accounting_transaction: null,
  ...over,
});

describe("deriveLists", () => {
  const b1 = tx("b1", "2026-06-10", "TRF X", -50);
  const a1 = tx("a1", "2026-06-30", "Pagamento X", -50.4);

  const probable = (status: MatchRow["status"]) =>
    row({ id: "m1", match_type: "probable", status, confidence: 60, note: "Valor quase igual", bank_transaction: b1, accounting_transaction: a1 });

  it("um par provável pendente aparece só em Prováveis", () => {
    const l = deriveLists([probable("pending")]);
    assert.equal(l.probable.length, 1);
    assert.equal(l.bankOnly.length + l.acctOnly.length + l.reconciled.length, 0);
  });

  it("um par provável rejeitado volta a Só no Banco e Só na Contabilidade", () => {
    const l = deriveLists([probable("rejected")]);
    assert.equal(l.probable.length, 0);
    assert.deepEqual(l.bankOnly.map((t) => t.id), ["b1"]);
    assert.deepEqual(l.acctOnly.map((t) => t.id), ["a1"]);
    assert.equal(l.bankOnly[0].note, "Valor quase igual");
  });

  it("um par provável confirmado passa a Reconciliado com o lançamento do outro lado", () => {
    const l = deriveLists([probable("confirmed")]);
    assert.equal(l.reconciled.length, 1);
    assert.equal(l.reconciled[0].tx.id, "b1");
    assert.equal(l.reconciled[0].other?.id, "a1");
  });

  it("um grupo um-para-vários é um único cartão com as várias linhas", () => {
    const bank = [tx("b1", "2026-06-04", "ATM", -30), tx("b2", "2026-06-09", "ATM", -60), tx("b3", "2026-06-15", "ATM", -130)];
    const acct = tx("a1", "2026-06-30", "Levantamentos", -220);
    const rows = bank.map((b, i) =>
      row({ id: `m${i}`, match_type: "probable", group_id: "g1", bank_transaction: b, accounting_transaction: acct })
    );
    const l = deriveLists(rows);
    assert.equal(l.probable.length, 1);
    assert.deepEqual(l.probable[0].bank.map((t) => t.id), ["b1", "b2", "b3"]);
    assert.deepEqual(l.probable[0].accounting.map((t) => t.id), ["a1"]);
  });

  it("rejeitar um grupo devolve todas as linhas (sem duplicar o lado único)", () => {
    const bank = [tx("b1", "2026-06-04", "ATM", -30), tx("b2", "2026-06-09", "ATM", -190)];
    const acct = tx("a1", "2026-06-30", "Levantamentos", -220);
    const rows = bank.map((b, i) =>
      row({ id: `m${i}`, match_type: "probable", status: "rejected", group_id: "g1", bank_transaction: b, accounting_transaction: acct })
    );
    const l = deriveLists(rows);
    assert.deepEqual(l.bankOnly.map((t) => t.id), ["b1", "b2"]);
    assert.deepEqual(l.acctOnly.map((t) => t.id), ["a1"]);
  });

  it("os reconciliados guardam a transação real de cada lado", () => {
    const bank = tx("b1", "2026-06-10", "TRF JOAO", -120);
    const acct = tx("a1", "2026-06-30", "Pagamento fornecedor", -120);
    const l = deriveLists([row({ id: "m1", match_type: "exact", status: "confirmed", bank_transaction: bank, accounting_transaction: acct })]);
    assert.equal(l.reconciled[0].tx.description, "TRF JOAO");
    assert.equal(l.reconciled[0].other?.description, "Pagamento fornecedor");
  });
});
