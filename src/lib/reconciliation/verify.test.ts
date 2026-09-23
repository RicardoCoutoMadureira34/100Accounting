import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountInCents, unverifiedWarning, verifyStatement, type ReadLine, type StatementData } from "./verify";

const line = (over: Partial<ReadLine>): ReadLine => ({
  date: "2026-06-01",
  description: "MOV",
  reference: null,
  debit: null,
  credit: null,
  balanceAfter: null,
  page: 1,
  ...over,
});

const data = (lines: ReadLine[], over: Partial<StatementData> = {}): StatementData => ({
  openingBalance: null,
  closingBalance: null,
  documentTotalDebits: null,
  documentTotalCredits: null,
  lines,
  ...over,
});

describe("sinais (feitos em código)", () => {
  it("extrato bancário: montante = crédito - débito", () => {
    assert.equal(amountInCents("bank", 10, null), -1000);
    assert.equal(amountInCents("bank", null, 25.5), 2550);
  });

  it("extrato contabilístico (conta 12): montante = débito - crédito", () => {
    assert.equal(amountInCents("accounting", 10, null), 1000);
    assert.equal(amountInCents("accounting", null, 25.5), -2550);
  });

  it("ignora sinais negativos vindos da leitura (usa o valor absoluto na coluna)", () => {
    assert.equal(amountInCents("bank", -10, null), -1000);
  });
});

describe("verificação aritmética", () => {
  it("passa quando saldo inicial + movimentos = saldo final (ao cêntimo)", () => {
    const v = verifyStatement(
      "bank",
      data([line({ debit: 10.1 }), line({ credit: 50.25 }), line({ debit: 0.15 })], { openingBalance: 100, closingBalance: 140 })
    );
    assert.equal(v.ok, true);
    assert.equal(v.equation?.diff, 0);
  });

  it("falha e descreve quanto falta quando a soma não bate", () => {
    const v = verifyStatement(
      "bank",
      data([line({ debit: 10 }), line({ credit: 50 })], { openingBalance: 100, closingBalance: 200 })
    );
    assert.equal(v.ok, false);
    assert.equal(v.equation?.diff, 60);
    assert.match(v.failures[0], /a soma dá 140,00 €, o saldo final é 200,00 € \(faltam 60,00 €\)/);
    assert.match(unverifiedWarning("bank", v), /extrato bancário não foi verificada/);
  });

  it("verifica os totais de débitos e créditos do documento", () => {
    const ok = verifyStatement(
      "accounting",
      data([line({ debit: 100 }), line({ credit: 30 })], { documentTotalDebits: 100, documentTotalCredits: 30 })
    );
    assert.equal(ok.ok, true);
    const bad = verifyStatement("accounting", data([line({ debit: 100 })], { documentTotalDebits: 90 }));
    assert.equal(bad.ok, false);
  });

  it("o Total do documento pode incluir os acumulados da linha de saldo inicial", () => {
    const v = verifyStatement(
      "accounting",
      data([line({ debit: 100 }), line({ credit: 30 })], {
        documentTotalDebits: 1100,
        documentTotalCredits: 530,
        openingRowDebits: 1000,
        openingRowCredits: 500,
      })
    );
    assert.equal(v.ok, true);
    const semAcumulados = verifyStatement("accounting", data([line({ debit: 100 })], { documentTotalDebits: 1100 }));
    assert.equal(semAcumulados.ok, false);
  });

  it("saldos com sinal em duas colunas (devedor +, credor -) batem certo linha a linha", () => {
    // razão de disponibilidades: 5 445,73 D -> crédito de 17 000 -> 11 554,27 C (negativo)
    const v = verifyStatement(
      "accounting",
      data([line({ credit: 17000, balanceAfter: -11554.27 }), line({ debit: 21979.39, balanceAfter: 10425.12 })], {
        openingBalance: 5445.73,
        closingBalance: 10425.12,
      })
    );
    assert.equal(v.corrections.length, 0);
    assert.equal(v.ok, true);
  });

  it("corrige o sinal quando contradiz a variação do saldo e regista o aviso", () => {
    // saldo 100 -> 90: era um débito de 10, mas foi lido como crédito
    const v = verifyStatement(
      "bank",
      data([line({ credit: 10, balanceAfter: 90 }), line({ credit: 5, balanceAfter: 95 })], {
        openingBalance: 100,
        closingBalance: 95,
      })
    );
    assert.equal(v.corrections.length, 1);
    assert.equal(v.lines[0].amountCents, -1000);
    assert.equal(v.lines[0].debit, 10);
    assert.equal(v.lines[0].credit, null);
    assert.equal(v.ok, true);
  });

  it("não é verificável sem saldos nem totais", () => {
    const v = verifyStatement("bank", data([line({ debit: 1 })]));
    assert.equal(v.performedChecks, 0);
    assert.equal(v.ok, false);
    assert.match(unverifiedWarning("bank", v), /Não foi possível verificar/);
  });

  it("movimentos a mais (ou saldo final mais baixo) rebentam a verificação", () => {
    const v = verifyStatement("bank", data([line({ debit: 10 })], { openingBalance: 100, closingBalance: 70 }));
    assert.equal(v.ok, false);
    assert.equal(v.equation?.diff, -20);
    assert.match(v.failures[0], /sobram 20,00 €/);
  });
});
