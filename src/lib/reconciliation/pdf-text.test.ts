import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelClient } from "./anthropic";
import { analyzeReconciliation } from "./analyze";
import { UserFacingError } from "./errors";
import { detectNumericColumns, extractPdfText, layoutPageText, type PositionedText } from "./pdf-text";
import { buildPdf } from "./test-utils";

const item = (str: string, x: number, y: number, width = str.length * 5): PositionedText => ({ str, x, y, width, height: 10 });

describe("layoutPageText (colunas preservadas)", () => {
  const items = [
    item("Data", 40, 700),
    item("Descrição", 100, 700),
    item("Débito", 300, 700),
    item("Crédito", 380, 700),
    item("Saldo", 470, 700),
    item("01-06", 40, 680),
    item("COMPRA LOJA", 100, 680),
    item("12,50", 300, 680),
    item("87,50", 470, 680),
    item("02-06", 40, 660),
    item("TRF CLIENTE", 100, 660),
    item("200,00", 380, 660),
    item("287,50", 470, 660),
  ];
  const lines = layoutPageText(items).split("\n");

  it("junta os fragmentos da mesma linha e ordena de cima para baixo", () => {
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Data\s+Descrição\s+Débito\s+Crédito\s+Saldo$/);
    assert.match(lines[1], /^01-06\s+COMPRA LOJA\s+12,50\s+87,50$/);
  });

  it("um valor na coluna Débito fica por baixo de Débito e um valor em Crédito por baixo de Crédito", () => {
    const col = (line: string, s: string) => line.indexOf(s);
    assert.ok(Math.abs(col(lines[1], "12,50") - col(lines[0], "Débito")) <= 1);
    assert.ok(Math.abs(col(lines[2], "200,00") - col(lines[0], "Crédito")) <= 1);
    assert.equal(col(lines[2], "12,50"), -1);
  });

  it("a coluna vazia continua a ocupar espaço (o crédito não desliza para o débito)", () => {
    assert.ok(lines[2].indexOf("200,00") > lines[1].indexOf("12,50") + 12);
  });

  it("página sem texto dá string vazia", () => {
    assert.equal(layoutPageText([]), "");
    assert.equal(layoutPageText([item("   ", 10, 10)]), "");
  });
});

// Geometria real de um razão: valores alinhados à DIREITA e cabeçalhos mais
// à esquerda da margem dos números (por isso só o espaço não chega).
const span = (str: string, left: number, right: number, y: number): PositionedText => ({ str, x: left, y, width: right - left, height: 10 });

describe("etiquetas de coluna (números alinhados à direita)", () => {
  const items: PositionedText[] = [
    span("Débito", 325, 351, 738),
    span("Crédito", 388, 417, 738),
    span("Sald.Déb.", 446, 485, 738),
    span("Sald.Cré.", 509, 546, 738),
    span("Documentos Bancarios", 129, 228, 714),
    span("17 000,00", 398, 433, 714),
    span("11 554,27", 521, 556, 714),
    span("Recebimentos de Clientes", 129, 238, 680),
    span("2 976,00", 337, 368, 680),
    span("42 140,61", 521, 556, 680),
    span("Despesas Bancárias", 129, 217, 658),
    span("10,40", 413, 433, 658),
    span("34 647,01", 521, 556, 658),
    span("Recebimentos de Clientes", 129, 238, 620),
    span("7 268,45", 462, 494, 620),
    span("21 979,39", 337, 368, 620),
    span("Pagamentos a Fornecedores", 129, 240, 600),
    span("50,00", 413, 433, 600),
    span("7 218,45", 462, 494, 600),
  ];
  const columns = detectNumericColumns(items);
  const text = layoutPageText(items, columns);

  it("deteta as 4 colunas numéricas e dá-lhes o nome do cabeçalho", () => {
    assert.deepEqual(columns.map((c) => c.label), ["Débito", "Crédito", "Sald.Déb.", "Sald.Cré."]);
  });

  it("etiqueta cada valor com a sua coluna, mesmo com larguras diferentes", () => {
    assert.match(text, /17 000,00 \[Crédito\]/);
    assert.match(text, /2 976,00 \[Débito\]/);
    assert.match(text, /10,40 \[Crédito\]/);
    assert.match(text, /11 554,27 \[Sald\.Cré\.\]/);
    assert.match(text, /7 268,45 \[Sald\.Déb\.\]/);
  });

  it("páginas de continuação sem cabeçalho herdam as colunas da página anterior", () => {
    const cont = [
      span("Pagamento", 129, 200, 700),
      span("50,00", 413, 433, 700),
      span("7 218,45", 462, 494, 700),
      span("Outro", 129, 170, 680),
      span("65,05", 413, 433, 680),
      span("7 139,15", 462, 494, 680),
    ];
    const t = layoutPageText(cont, detectNumericColumns(cont, columns));
    assert.match(t, /50,00 \[Crédito\]/);
    assert.match(t, /7 218,45 \[Sald\.Déb\.\]/);
  });

  it("datas e referências não são tratadas como valores", () => {
    const t = layoutPageText([span("30-06-2026", 39, 79, 700), span("FT 2026/0004420572", 237, 313, 700)], columns);
    assert.doesNotMatch(t, /\[/);
  });
});

describe("extractPdfText", () => {
  it("extrai texto com marcadores de página e posições", async () => {
    const pdf = buildPdf([
      [
        { x: 40, y: 700, text: "Data" },
        { x: 300, y: 700, text: "Debito" },
        { x: 40, y: 680, text: "01-06-2026 COMPRA LOJA MUITO LONGA" },
        { x: 300, y: 680, text: "12,50" },
      ],
      [{ x: 40, y: 700, text: "Pagina dois com mais texto suficiente" }],
    ]);
    const out = await extractPdfText(pdf);
    assert.equal(out.scanned, false);
    assert.equal(out.pages.length, 2);
    assert.match(out.text, /=== Página 1 ===/);
    assert.match(out.text, /=== Página 2 ===/);
    assert.match(out.pages[0], /COMPRA LOJA MUITO LONGA/);
    const debitCol = out.pages[0].split("\n")[0].indexOf("Debito");
    const valueCol = out.pages[0].split("\n")[1].indexOf("12,50");
    assert.ok(Math.abs(debitCol - valueCol) <= 2, `colunas desalinhadas: ${debitCol} vs ${valueCol}`);
  });

  it("um PDF sem texto é considerado digitalizado", async () => {
    const out = await extractPdfText(buildPdf([[]]));
    assert.equal(out.scanned, true);
  });
});

describe("PDF digitalizado", () => {
  it("dá a mensagem certa sem chamar a API", async () => {
    let apiCalls = 0;
    const client = {
      messages: {
        stream: () => {
          apiCalls++;
          throw new Error("a API não devia ser chamada");
        },
      },
    } as unknown as ModelClient;

    const blank = buildPdf([[]]);
    const text = buildPdf([[{ x: 40, y: 700, text: "Extrato com texto suficiente para não ser digitalizado" }]]);

    await assert.rejects(
      analyzeReconciliation(blank, text, { client }),
      (e: unknown) =>
        e instanceof UserFacingError &&
        e.message ===
          "O extrato bancário parece ser uma digitalização. Exporta-o em PDF diretamente do homebanking ou do programa de contabilidade."
    );
    await assert.rejects(
      analyzeReconciliation(text, blank, { client }),
      (e: unknown) =>
        e instanceof UserFacingError &&
        e.message ===
          "O extrato da contabilidade parece ser uma digitalização. Exporta-o em PDF diretamente do homebanking ou do programa de contabilidade."
    );
    assert.equal(apiCalls, 0);
  });
});
