import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { extractStatement } from "./extract";
import { decideStepTwo, reviewStatement, type ReviewDoc, type ReviewLineInput } from "./review";
import { fakeModelClient } from "./test-utils";
import type { SheetMappingRaw } from "./spreadsheet";

const doc = (over: Partial<ReviewDoc> = {}): ReviewDoc => ({
  openingBalance: 1000,
  closingBalance: 1150,
  totalDebits: null,
  totalCredits: null,
  openingRowDebits: null,
  openingRowCredits: null,
  ...over,
});

const line = (debit: number | null, credit: number | null, balanceAfter: number | null): ReviewLineInput => ({
  date: "2026-03-02",
  description: "X",
  debit,
  credit,
  balanceAfter,
});

const good = [line(50, null, 950), line(null, 200, 1150)];

describe("passo 2 automático: quando saltar", () => {
  it("saldos batem certo: salta (PDF e Excel)", () => {
    for (const format of ["pdf", "xlsx", "csv"] as const) {
      const review = reviewStatement("bank", doc(), good);
      assert.deepEqual(decideStepTwo({ format, review, conversionProblems: 0, lineCount: 2 }), { skip: true, reason: null });
    }
  });

  it("saldos que não batem: mostra", () => {
    const review = reviewStatement("bank", doc({ closingBalance: 1170 }), good);
    const d = decideStepTwo({ format: "xlsx", review, conversionProblems: 0, lineCount: 2 });
    assert.deepEqual(d, { skip: false, reason: "mismatch" });
  });

  it("sem saldos para verificar: Excel/CSV salta, PDF mostra", () => {
    const review = reviewStatement("bank", doc({ openingBalance: null, closingBalance: null }), [line(50, null, null), line(null, 200, null)]);
    assert.equal(review.verifiable, false);
    assert.deepEqual(decideStepTwo({ format: "xlsx", review, conversionProblems: 0, lineCount: 2 }), { skip: true, reason: null });
    assert.deepEqual(decideStepTwo({ format: "csv", review, conversionProblems: 0, lineCount: 2 }), { skip: true, reason: null });
    assert.deepEqual(decideStepTwo({ format: "pdf", review, conversionProblems: 0, lineCount: 2 }), { skip: false, reason: "unverifiable" });
  });

  it("sem saldos mas com falhas de conversão (ou 0 linhas): mostra", () => {
    const review = reviewStatement("bank", doc({ openingBalance: null, closingBalance: null }), [line(50, null, null)]);
    assert.deepEqual(decideStepTwo({ format: "xlsx", review, conversionProblems: 2, lineCount: 1 }), { skip: false, reason: "conversion" });
    assert.deepEqual(decideStepTwo({ format: "xlsx", review, conversionProblems: 0, lineCount: 0 }), { skip: false, reason: "empty" });
  });
});

describe("Excel: contagem de valores e datas por converter", () => {
  const raw: SheetMappingRaw = {
    firstDataRow: 2,
    headerRow: 1,
    dateColumn: "A",
    descriptionColumn: "B",
    referenceColumn: null,
    debitColumn: "C",
    creditColumn: "D",
    amountColumn: null,
    balanceColumn: null,
    balanceCreditColumn: null,
    dateFormat: "dmy",
    numberFormat: "comma_decimal",
    openingBalance: null,
    closingBalance: null,
    periodStart: null,
    periodEnd: null,
    sourceName: null,
    issues: [],
  };
  const file = (aoa: (string | number | null)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const bytes = XLSX.write({ SheetNames: ["E"], Sheets: { E: ws } }, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return { name: "x.xlsx", bytes: new Uint8Array(bytes) };
  };

  it("conversão limpa: 0 problemas", async () => {
    const ex = await extractStatement(
      "bank",
      file([["Data", "Descrição", "Débito", "Crédito"], ["01/04/2026", "A", 10, null], ["02/04/2026", "B", null, 5]]),
      fakeModelClient(() => raw)
    );
    assert.equal(ex.conversionProblems, 0);
  });

  it("valor ou data ilegíveis contam como problemas", async () => {
    const ex = await extractStatement(
      "bank",
      file([["Data", "Descrição", "Débito", "Crédito"], ["01/04/2026", "OK", 3, null], ["02/04/2026", "A", "dez euros", null], ["ontem", "B", null, 5]]),
      fakeModelClient(() => raw)
    );
    assert.ok(ex.conversionProblems >= 2, `problemas: ${ex.conversionProblems}`);
  });
});
