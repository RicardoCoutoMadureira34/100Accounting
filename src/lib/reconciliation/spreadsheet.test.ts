import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { UserFacingError } from "./errors";
import { detectFormat, extractStatement, prepareInput } from "./extract";
import {
  columnIndex,
  columnLetter,
  convertSheet,
  decodeCsvBytes,
  detectDelimiter,
  normalizeMapping,
  parseCsv,
  readSpreadsheet,
  type SheetMappingRaw,
} from "./spreadsheet";
import { fakeModelClient } from "./test-utils";

type AoA = (string | number | null)[][];

function xlsxFile(name: string, aoa: AoA, tweak?: (ws: XLSX.WorkSheet) => void, bookType: XLSX.BookType = "xlsx") {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  tweak?.(ws);
  const bytes = XLSX.write({ SheetNames: ["Extrato"], Sheets: { Extrato: ws } }, { type: "array", bookType }) as ArrayBuffer;
  return { name, bytes: new Uint8Array(bytes) };
}

const mappingRaw = (over: Partial<SheetMappingRaw>): SheetMappingRaw => ({
  firstDataRow: 5,
  headerRow: 4,
  dateColumn: "A",
  descriptionColumn: "B",
  referenceColumn: null,
  debitColumn: null,
  creditColumn: null,
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
  ...over,
});

// O modelo só devolve o mapeamento (nunca lê as linhas todas).
const withMapping = (raw: SheetMappingRaw) => fakeModelClient(() => raw);

const serial = (iso: string) => (Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000;

describe("Excel: débito e crédito em colunas separadas", () => {
  const aoa: AoA = [
    ["Extrato bancário"],
    ["Conta à ordem 0001"],
    [null],
    ["Data", "Descrição", "Débito", "Crédito", "Saldo"],
    [null, "SALDO INICIAL", null, null, 1000],
    ["02/03/2026", "COMPRA A", 50, null, 950],
    ["05/03/2026", "TRF CLIENTE", null, 200, 1150],
    ["09/03/2026", "COMISSAO", 5.5, null, 1144.5],
    [null, "SALDO FINAL", null, null, 1144.5],
  ];
  const raw = mappingRaw({ debitColumn: "C", creditColumn: "D", balanceColumn: "E", sourceName: "Banco Exemplo" });

  it("converte todas as linhas em código e a leitura fica verificada", async () => {
    const { client, calls } = withMapping(raw);
    const ex = await extractStatement("bank", xlsxFile("banco.xlsx", aoa), { client });

    assert.equal(calls.length, 1, "uma só chamada ao modelo, só para o mapeamento");
    assert.equal(ex.format, "xlsx");
    assert.equal(ex.sourceName, "Banco Exemplo");
    assert.equal(ex.lines.length, 3);
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [-5000, 20000, -550]);
    assert.deepEqual(ex.lines.map((l) => l.date), ["2026-03-02", "2026-03-05", "2026-03-09"]);
    assert.equal(ex.openingBalance, 1000);
    assert.equal(ex.closingBalance, 1144.5);
    assert.equal(ex.verified, true);
    assert.equal(ex.retried, false);
    assert.deepEqual(ex.lines.map((l) => l.origin), ["L6", "L7", "L8"]);
  });

  it("o modelo só recebe as primeiras linhas, nunca o ficheiro inteiro", async () => {
    const big: AoA = [["Data", "Descrição", "Débito", "Crédito", "Saldo"], [null, "SALDO INICIAL", null, null, 0]];
    let balance = 0;
    for (let i = 0; i < 200; i++) {
      balance += 10;
      big.push([`${String((i % 27) + 1).padStart(2, "0")}/03/2026`, `MOV ${i + 1}`, null, 10, balance]);
    }
    const { client, calls } = withMapping(mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", creditColumn: "D", balanceColumn: "E" }));
    const ex = await extractStatement("bank", xlsxFile("grande.xlsx", big), { client });
    assert.equal(ex.lines.length, 200);
    assert.equal(ex.verified, true);
    assert.match(calls[0].userText, /L20:/);
    assert.doesNotMatch(calls[0].userText, /L21:/, "só ~20 linhas vão à IA");
    assert.doesNotMatch(calls[0].userText, /MOV 150/);
  });

  it("no extrato da contabilidade Débito é entrada e Crédito é saída", async () => {
    const acct: AoA = [
      ["Data", "Descrição", "Débito", "Crédito", "Saldo"],
      [null, "Saldo inicial", null, null, 1000],
      ["05/03/2026", "Recebimento", 200, null, 1200],
      ["09/03/2026", "Pagamento", null, 55.5, 1144.5],
    ];
    const { client } = withMapping(mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", creditColumn: "D", balanceColumn: "E" }));
    const ex = await extractStatement("accounting", xlsxFile("razao.xlsx", acct), { client });
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [20000, -5550]);
    assert.equal(ex.verified, true);
  });

  it("ficheiro .xls (formato antigo) também se lê", async () => {
    const { client } = withMapping(raw);
    const ex = await extractStatement("bank", xlsxFile("banco.xls", aoa, undefined, "biff8"), { client });
    assert.equal(ex.lines.length, 3);
    assert.equal(ex.verified, true);
  });
});

describe("CSV: coluna única com sinal, ; e Windows-1252", () => {
  const text = [
    "Extrato;Fevereiro 2026;;",
    "Data;Descrição;Montante;Saldo",
    "01/02/2026;SALDO INICIAL;;8 905,20",
    "03/02/2026;CHEQUE 998877;-1 250,00;7 655,20",
    "10/02/2026;TPA LIQUIDAÇÃO;845,30;8 500,50",
    "27/02/2026;JUROS CREDORES;3,12;8 503,62",
  ].join("\r\n");
  const latin1 = { name: "banco.csv", bytes: new Uint8Array(Buffer.from(text, "latin1")) };
  const raw = mappingRaw({ firstDataRow: 3, headerRow: 2, amountColumn: "C", balanceColumn: "D" });

  it("deteta o separador ; e a codificação Windows-1252 (acentos)", () => {
    assert.equal(detectDelimiter(text), ";");
    assert.match(decodeCsvBytes(latin1.bytes), /LIQUIDAÇÃO/);
    const grid = readSpreadsheet(latin1);
    assert.equal(grid.format, "csv");
    assert.equal(grid.rows[4][1], "TPA LIQUIDAÇÃO");
  });

  it("valores com sinal: negativo sai, positivo entra; saldo final vem do último movimento", async () => {
    const { client } = withMapping(raw);
    const ex = await extractStatement("bank", latin1, { client });
    assert.equal(ex.format, "csv");
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [-125000, 84530, 312]);
    assert.equal(ex.openingBalance, 8905.2);
    assert.equal(ex.closingBalance, 8503.62);
    assert.equal(ex.verified, true);
    assert.match(ex.readIssues.join("\n"), /Saldo final tirado do último movimento/);
  });

  it("uma só coluna com valores tipo \"9,50-\" mapeada como Débito é tratada como coluna com sinal", async () => {
    const csv = [
      "Data;Descrição;Montante",
      ";Saldo inicial;212,40",
      "01.07.2026;COMPRA A;12,40-",
      "02.07.2026;COMPRA B;9,50-",
      "22.07.2026;CARREGAMENTO;250,00",
    ].join("\r\n");
    const file = { name: "cartao.csv", bytes: new Uint8Array(Buffer.from(csv, "latin1")) };
    // o modelo devolveu a coluna única como "debitColumn" (erro frequente)
    const wrong = mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", openingBalance: 212.4, closingBalance: 440.5 });
    const { client } = withMapping(wrong);
    const ex = await extractStatement("bank", file, { client });
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [-1240, -950, 25000]);
    assert.equal(ex.verified, true);
  });

  it("UTF-8 com BOM e separador vírgula com aspas", () => {
    const csv = '﻿Data,Descrição,Valor\n"01/03/2026","Compra, loja","-1.234,50"\n';
    const bytes = new TextEncoder().encode(csv);
    assert.equal(detectDelimiter(decodeCsvBytes(bytes)), ",");
    const rows = parseCsv(decodeCsvBytes(bytes), ",");
    assert.deepEqual(rows[1], ["01/03/2026", "Compra, loja", "-1.234,50"]);
  });
});

describe("Excel: datas como número de série", () => {
  it("células formatadas como data viram YYYY-MM-DD, sem ambiguidade", async () => {
    const aoa: AoA = [
      ["Data", "Descrição", "Débito", "Crédito", "Saldo"],
      [null, "Saldo inicial", null, null, 100],
      [serial("2026-03-02"), "A", 10, null, 90],
      [serial("2026-03-11"), "B", null, 30, 120],
    ];
    const file = xlsxFile("datas.xlsx", aoa, (ws) => {
      ws["A3"].z = "dd/mm/yyyy";
      ws["A4"].z = "dd/mm/yyyy";
    });
    const grid = readSpreadsheet(file);
    assert.equal(grid.rows[2][0], "2026-03-02");
    assert.equal(grid.display[2][0], "02/03/2026", "o modelo vê o que o utilizador vê");

    const { client } = withMapping(mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", creditColumn: "D", balanceColumn: "E" }));
    const ex = await extractStatement("bank", file, { client });
    assert.deepEqual(ex.lines.map((l) => l.date), ["2026-03-02", "2026-03-11"]);
    assert.equal(ex.verified, true);
  });

  it("números simples numa coluna de datas (formato Geral) com dateFormat excel_serial", async () => {
    const aoa: AoA = [
      ["Data", "Descrição", "Valor", "Saldo"],
      [null, "Saldo inicial", null, 100],
      [serial("2026-04-02"), "A", -10, 90],
      [serial("2026-04-20"), "B", 30, 120],
    ];
    const { client } = withMapping(
      mappingRaw({ firstDataRow: 2, headerRow: 1, amountColumn: "C", balanceColumn: "D", dateFormat: "excel_serial" })
    );
    const ex = await extractStatement("bank", xlsxFile("serial.xlsx", aoa), { client });
    assert.deepEqual(ex.lines.map((l) => l.date), ["2026-04-02", "2026-04-20"]);
    assert.equal(ex.verified, true);
  });
});

describe("Excel: lixo no topo, totais no fim, transportes e células fundidas", () => {
  const aoa: AoA = [
    ["Empresa Exemplo, Lda"],
    ["NIF 500000000"],
    ["Extrato de 01/04/2026 a 30/04/2026"],
    [null],
    ["Data", "Descrição", "Débito", "Crédito"],
    ["06/04/2026", "Pagamento A", 100, null],
    [null, "A transportar", 100, null],
    [null, "Transporte", 100, null],
    ["07/04/2026", "Recebimento B", null, 50],
    [null, null, null, null],
    ["Data", "Descrição", "Débito", "Crédito"],
    ["08/04/2026", "Compra C", 25, null],
    [null, "Total", 125, 50],
  ];
  const raw = mappingRaw({ firstDataRow: 6, headerRow: 5, debitColumn: "C", creditColumn: "D", periodStart: "2026-04-01", periodEnd: "2026-04-30" });

  it("ignora o lixo, os transportes e cabeçalhos repetidos, e usa a linha de Total para verificar", async () => {
    const { client } = withMapping(raw);
    const ex = await extractStatement("bank", xlsxFile("lixo.xlsx", aoa), { client });
    assert.equal(ex.lines.length, 3);
    assert.deepEqual(ex.lines.map((l) => l.description), ["Pagamento A", "Recebimento B", "Compra C"]);
    assert.equal(ex.totalDebits, 125);
    assert.equal(ex.totalCredits, 50);
    assert.equal(ex.periodStart, "2026-04-01");
    assert.equal(ex.verified, true, "soma dos débitos e créditos = linha de Total");
  });

  it("se a linha de Total não bater a leitura fica não verificada", async () => {
    const bad = aoa.map((r) => [...r]);
    bad[12] = [null, "Total", 999, 50];
    const { client } = withMapping(raw);
    const ex = await extractStatement("bank", xlsxFile("lixo2.xlsx", bad), { client });
    assert.equal(ex.verified, false);
    assert.match(ex.issues.join("\n"), /não foi verificada/);
  });

  it("células fundidas: a data escrita uma vez vale para as linhas seguintes", () => {
    const grid = readSpreadsheet(
      xlsxFile(
        "fundidas.xlsx",
        [
          ["Data", "Descrição", "Débito", "Crédito"],
          ["06/04/2026", "Pagamento A", 10, null],
          [null, "Pagamento B", 20, null],
          ["07/04/2026", "Recebimento", null, 5],
        ],
        (ws) => {
          ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
        }
      )
    );
    const c = convertSheet(grid, normalizeMapping(mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", creditColumn: "D" })), "bank");
    assert.deepEqual(c.lines.map((l) => l.date), ["2026-04-06", "2026-04-06", "2026-04-07"]);
    assert.deepEqual(c.lines.map((l) => l.debit), [10, 20, null]);
  });

  it("valores em texto: 1.234,56 / 1 234,56 / 7.90- convertem-se em código", () => {
    const grid = readSpreadsheet(
      xlsxFile("texto.xlsx", [
        ["Data", "Descrição", "Débito", "Crédito"],
        ["01/04/2026", "A", "1.234,56", null],
        ["02/04/2026", "B", "1 234,56", null],
        ["03/04/2026", "C", "7.90-", null],
        ["04/04/2026", "D", null, "250.00"],
      ])
    );
    const c = convertSheet(
      grid,
      normalizeMapping(mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "C", creditColumn: "D", numberFormat: "comma_decimal" })),
      "bank"
    );
    assert.deepEqual(c.lines.map((l) => [l.debit, l.credit]), [
      [1234.56, null],
      [1234.56, null],
      [7.9, null],
      [null, 250],
    ]);
  });
});

describe("Excel/CSV: verificação e repetição do mapeamento", () => {
  // Sem coluna de saldo: não há como corrigir o sinal em silêncio, por isso um
  // mapeamento errado tem mesmo de ser repetido. Saldos dados pelo modelo.
  const aoa: AoA = [
    ["Data", "Descrição", "Débito", "Crédito"],
    ["02/03/2026", "COMPRA", 50, null],
    ["05/03/2026", "TRF", null, 200],
  ];
  const good = mappingRaw({
    firstDataRow: 2,
    headerRow: 1,
    debitColumn: "C",
    creditColumn: "D",
    openingBalance: 1000,
    closingBalance: 1150,
  });
  // Mapeamento errado: colunas de débito e crédito trocadas
  const swapped = { ...good, debitColumn: "D", creditColumn: "C" };

  it("se o mapeamento dá uma leitura que não bate, repete uma vez indicando a diferença", async () => {
    const { client, calls } = fakeModelClient((_s, _u, i) => (i === 0 ? swapped : good));
    const ex = await extractStatement("bank", xlsxFile("t.xlsx", aoa), { client });
    assert.equal(calls.length, 2);
    assert.match(calls[1].userText, /ATENÇÃO/);
    assert.match(calls[1].userText, /a soma dá 850,00 €, o saldo final é 1150,00 €/);
    assert.equal(ex.retried, true);
    assert.equal(ex.verified, true);
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [-5000, 20000]);
  });

  it("com coluna de saldo, um Débito/Crédito trocado corrige-se pelo saldo e fica registado", async () => {
    const withBalance: AoA = [
      ["Data", "Descrição", "Débito", "Crédito", "Saldo"],
      [null, "Saldo inicial", null, null, 1000],
      ["02/03/2026", "COMPRA", 50, null, 950],
      ["05/03/2026", "TRF", null, 200, 1150],
    ];
    const swappedWithBalance = mappingRaw({ firstDataRow: 2, headerRow: 1, debitColumn: "D", creditColumn: "C", balanceColumn: "E" });
    const { client, calls } = fakeModelClient(() => swappedWithBalance);
    const ex = await extractStatement("bank", xlsxFile("t2.xlsx", withBalance), { client });
    assert.equal(calls.length, 1);
    assert.equal(ex.verified, true);
    assert.deepEqual(ex.lines.map((l) => l.amountCents), [-5000, 20000]);
    assert.equal(ex.readIssues.filter((i) => /Sinal corrigido/.test(i)).length, 2);
  });

  it("uma folha sem movimentos dá uma mensagem clara", async () => {
    const { client } = fakeModelClient(() => good);
    await assert.rejects(
      extractStatement("bank", xlsxFile("vazia.xlsx", [["Data", "Descrição", "Débito", "Crédito", "Saldo"]]), { client }),
      (e: unknown) => e instanceof UserFacingError && /Não foram encontrados movimentos/.test(e.message)
    );
  });
});

describe("formatos de ficheiro", () => {
  it("deteta PDF, Excel e CSV (pelo conteúdo ou pelo nome)", () => {
    assert.equal(detectFormat({ name: "x.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) }), "pdf");
    assert.equal(detectFormat(xlsxFile("qualquer.dat", [["a"]])), "xlsx");
    assert.equal(detectFormat({ name: "x.CSV", bytes: new TextEncoder().encode("a;b") }), "csv");
    assert.equal(detectFormat({ name: "x.docx", bytes: new TextEncoder().encode("a;b") }), null);
  });

  it("formato não suportado dá uma mensagem clara", async () => {
    await assert.rejects(
      prepareInput("bank", { name: "extrato.docx", bytes: new TextEncoder().encode("olá") }),
      (e: unknown) => e instanceof UserFacingError && /formato não suportado/.test(e.message)
    );
  });

  it("letras de colunas", () => {
    assert.equal(columnLetter(0), "A");
    assert.equal(columnLetter(26), "AA");
    assert.equal(columnIndex("C"), 2);
    assert.equal(columnIndex("aa"), 26);
    assert.equal(columnIndex("1"), null);
  });
});
