import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excelSerialToIso, parseAmount, parseDateCell } from "./number-parse";

describe("parseAmount", () => {
  const cases: [string | number | null, number | null][] = [
    ["1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["-1234.56", -1234.56],
    ["-1 250,00", -1250],
    ["7.90-", -7.9],
    ["9.50-", -9.5],
    ["250.00", 250],
    ["(12,50)", -12.5],
    ["+15,5", 15.5],
    ["1,234.56", 1234.56],
    ["1.234.567,89", 1234567.89],
    ["12,5", 12.5],
    ["0,00", 0],
    ["€ 45,00", 45],
    ["45,00 EUR", 45],
    ["−3,10", -3.1],
    [12.34, 12.34],
    ["", null],
    ["-", null],
    ["abc", null],
    ["12/03/2026", null],
    [null, null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(parseAmount(input), expected);
    });
  }

  it("\"1.234\" depende do formato indicado (milhares ou decimal)", () => {
    assert.equal(parseAmount("1.234", "comma_decimal"), 1234);
    assert.equal(parseAmount("1.234", "dot_decimal"), 1.234);
    assert.equal(parseAmount("1,234", "dot_decimal"), 1234);
    assert.equal(parseAmount("1,234", "comma_decimal"), 1.234);
  });
});

describe("datas", () => {
  it("número de série do Excel", () => {
    assert.equal(excelSerialToIso(45000), "2023-03-15");
    assert.equal(excelSerialToIso(46083.5), "2026-03-02");
    assert.equal(excelSerialToIso(12), null);
  });

  it("DD/MM/AAAA e MM/DD/AAAA conforme o formato", () => {
    assert.equal(parseDateCell("15/03/2026", "dmy"), "2026-03-15");
    assert.equal(parseDateCell("03/15/2026", "mdy"), "2026-03-15");
    assert.equal(parseDateCell("15-03-26", "dmy"), "2026-03-15");
    assert.equal(parseDateCell("15.03.2026", "dmy"), "2026-03-15");
  });

  it("ISO, com hora e compacta", () => {
    assert.equal(parseDateCell("2026-03-15", "dmy"), "2026-03-15");
    assert.equal(parseDateCell("2026-03-15 00:00:00", "dmy"), "2026-03-15");
    assert.equal(parseDateCell("20260315", "dmy"), "2026-03-15");
    assert.equal(parseDateCell("15032026", "dmy"), "2026-03-15");
  });

  it("números e texto numérico como número de série", () => {
    assert.equal(parseDateCell(46083, "excel_serial"), "2026-03-02");
    assert.equal(parseDateCell("46083", "excel_serial"), "2026-03-02");
  });

  it("datas sem ano usam o ano indicado", () => {
    assert.equal(parseDateCell("07.01", "dmy", 2026), "2026-01-07");
    assert.equal(parseDateCell("07.01", "dmy"), null);
  });

  it("datas impossíveis ou texto não são datas", () => {
    assert.equal(parseDateCell("31/02/2026", "dmy"), null);
    assert.equal(parseDateCell("Saldo inicial", "dmy"), null);
    assert.equal(parseDateCell(null, "dmy"), null);
    assert.equal(parseDateCell("", "dmy"), null);
  });
});
