import * as XLSX from "xlsx";
import { z } from "zod";
import { callStructured, type ModelClient } from "./anthropic";
import { KIND_LABEL, UserFacingError, type StatementKind } from "./errors";
import {
  excelSerialToIso,
  normalizeDateFormat,
  normalizeNumberFormat,
  parseAmount,
  parseDateCell,
  type DateFormat,
  type NumberFormat,
} from "./number-parse";
import { amountInCents, type ReadLine } from "./verify";

// Excel/CSV: o modelo vê SÓ as primeiras linhas (como texto tabular, com as
// letras das colunas) e diz como a folha está organizada. Depois é o CÓDIGO
// que converte TODAS as linhas com esse mapeamento; o ficheiro inteiro nunca
// vai ao modelo.

export type Cell = string | number | null;

export interface Merge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface SheetGrid {
  format: "xlsx" | "csv";
  sheetName: string;
  // Valores em bruto: números como números, datas formatadas como YYYY-MM-DD,
  // texto como texto (CSV: tudo texto).
  rows: Cell[][];
  // O que o utilizador vê no Excel (usado só para mostrar as primeiras linhas ao modelo).
  display: string[][];
  merges: Merge[];
}

export const SAMPLE_ROWS = 20;
export const SAMPLE_ROWS_LARGE = 60;
const MAX_ROWS = 50_000;

// ---------- CSV ----------

// UTF-8 (com ou sem BOM); se não for UTF-8 válido assume Windows-1252 (Excel PT).
export function decodeCsvBytes(bytes: Uint8Array): string {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) n++;
  }
  return n;
}

// Separador mais provável (";", ",", tab ou "|") olhando para as primeiras linhas.
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 15);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const score = counts.reduce((s, c) => s + c, 0) + counts.filter((c) => c > 0).length * 2;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") pushRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

// ---------- ficheiros ----------

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

const norm = (v: unknown): Cell => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/ /g, " ").trim();
  return s === "" ? null : s;
};

function gridFromCsv(bytes: Uint8Array): SheetGrid {
  const text = decodeCsvBytes(bytes);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter).slice(0, MAX_ROWS).map((r) => r.map(norm));
  return { format: "csv", sheetName: "CSV", rows, display: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))), merges: [] };
}

function gridFromWorkbook(bytes: Uint8Array): SheetGrid {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true });
  let best: { name: string; count: number } | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const count = Object.keys(ws).filter((k) => k[0] !== "!").length;
    if (!best || count > best.count) best = { name, count };
  }
  if (!best) throw new UserFacingError("A folha de cálculo está vazia.");

  const ws = wb.Sheets[best.name];
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const rows: Cell[][] = [];
  const display: string[][] = [];
  const lastRow = Math.min(range.e.r, MAX_ROWS - 1);
  for (let r = range.s.r; r <= lastRow; r++) {
    const row: Cell[] = [];
    const disp: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null) {
        row.push(null);
        disp.push("");
        continue;
      }
      let value: Cell;
      if (cell.t === "n") {
        // Célula numérica formatada como data -> data ISO (sem ambiguidade DD/MM vs MM/DD).
        value = cell.z && XLSX.SSF.is_date(String(cell.z)) ? (excelSerialToIso(Number(cell.v)) ?? Number(cell.v)) : Number(cell.v);
      } else if (cell.t === "s") value = norm(cell.v);
      else value = null;
      row.push(value);
      disp.push(cell.w != null ? String(cell.w) : value == null ? "" : String(value));
    }
    rows.push(row);
    display.push(disp);
  }

  const merges: Merge[] = (ws["!merges"] ?? []).map((m) => ({
    r1: m.s.r - range.s.r,
    c1: m.s.c - range.s.c,
    r2: m.e.r - range.s.r,
    c2: m.e.c - range.s.c,
  }));
  return { format: "xlsx", sheetName: best.name, rows, display, merges };
}

export function readSpreadsheet(file: InputFile): SheetGrid {
  const isCsv = /\.csv$/i.test(file.name) || /\.txt$/i.test(file.name);
  const grid = isCsv ? gridFromCsv(file.bytes) : gridFromWorkbook(file.bytes);
  const hasData = grid.rows.some((r) => r.some((c) => c != null));
  if (!hasData) throw new UserFacingError("O ficheiro está vazio.");
  return grid;
}

// ---------- amostra para o modelo ----------

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function columnIndex(letter: string | null | undefined): number | null {
  if (!letter) return null;
  const s = letter.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function formatSampleForModel(grid: SheetGrid, maxRows: number): string {
  const lines: string[] = [];
  const shown = Math.min(maxRows, grid.display.length);
  for (let r = 0; r < shown; r++) {
    const cells = grid.display[r]
      .map((text, c) => (text.trim() === "" ? null : `${columnLetter(c)}=${text.trim().slice(0, 40)}`))
      .filter((x): x is string => x !== null);
    lines.push(`L${r + 1}: ${cells.length > 0 ? cells.join(" | ") : "(linha vazia)"}`);
  }
  return `Folha "${grid.sheetName}" com ${grid.rows.length} linhas. Primeiras ${shown} linhas:\n${lines.join("\n")}`;
}

// ---------- mapeamento (o que o modelo devolve) ----------

export const SheetMappingSchema = z.object({
  firstDataRow: z.number().describe("Número (L..) da primeira linha que já é um movimento real"),
  headerRow: z.number().nullable().describe("Número (L..) da linha com os nomes das colunas, ou null"),
  dateColumn: z.string().describe("Letra da coluna da data do movimento"),
  descriptionColumn: z.string().nullable(),
  referenceColumn: z.string().nullable(),
  debitColumn: z.string().nullable(),
  creditColumn: z.string().nullable(),
  amountColumn: z.string().nullable().describe("Coluna única de valor com sinal (negativo = saída), só se não houver débito/crédito"),
  balanceColumn: z.string().nullable().describe("Saldo depois de cada movimento (ou saldo devedor, se estiver dividido em dois)"),
  balanceCreditColumn: z.string().nullable().describe("Saldo credor, só se o saldo estiver dividido em devedor/credor"),
  dateFormat: z.string().describe("dmy, mdy, ymd ou excel_serial"),
  numberFormat: z.string().describe("comma_decimal (1.234,56 ou 1 234,56) ou dot_decimal (1,234.56 ou 1234.56)"),
  openingBalance: z.number().nullable().describe("Saldo inicial, só se estiver numa célula própria visível nas linhas mostradas"),
  closingBalance: z.number().nullable().describe("Saldo final, só se estiver numa célula própria visível nas linhas mostradas"),
  periodStart: z.string().nullable().describe("YYYY-MM-DD, se o período estiver visível"),
  periodEnd: z.string().nullable(),
  sourceName: z.string().nullable().describe("Banco ou programa de contabilidade que emitiu o documento, se se perceber"),
  issues: z.array(z.string()),
});
export type SheetMappingRaw = z.infer<typeof SheetMappingSchema>;

export interface SheetMapping {
  firstDataIndex: number; // 0-based
  headerIndex: number | null;
  dateCol: number;
  descCol: number | null;
  refCol: number | null;
  debitCol: number | null;
  creditCol: number | null;
  amountCol: number | null;
  balanceCol: number | null;
  balanceCreditCol: number | null;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  sourceName: string | null;
  issues: string[];
}

export function normalizeMapping(raw: SheetMappingRaw): SheetMapping {
  const dateCol = columnIndex(raw.dateColumn);
  if (dateCol == null) throw new UserFacingError("Não foi possível identificar a coluna das datas na folha.");
  const debitCol = columnIndex(raw.debitColumn);
  const creditCol = columnIndex(raw.creditColumn);
  const amountCol = columnIndex(raw.amountColumn);
  if (debitCol == null && creditCol == null && amountCol == null) {
    throw new UserFacingError("Não foi possível identificar as colunas dos valores (débito/crédito ou montante) na folha.");
  }
  return {
    firstDataIndex: Math.max(0, Math.round(raw.firstDataRow) - 1),
    headerIndex: raw.headerRow == null ? null : Math.max(0, Math.round(raw.headerRow) - 1),
    dateCol,
    descCol: columnIndex(raw.descriptionColumn),
    refCol: columnIndex(raw.referenceColumn),
    debitCol,
    creditCol,
    // Se há débito/crédito separados, a coluna única de montante não é usada.
    amountCol: debitCol != null || creditCol != null ? null : amountCol,
    balanceCol: columnIndex(raw.balanceColumn),
    balanceCreditCol: columnIndex(raw.balanceCreditColumn),
    dateFormat: normalizeDateFormat(raw.dateFormat),
    numberFormat: normalizeNumberFormat(raw.numberFormat),
    openingBalance: raw.openingBalance,
    closingBalance: raw.closingBalance,
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    sourceName: raw.sourceName?.trim() || null,
    issues: raw.issues,
  };
}

const MAPPING_SYSTEM_PROMPT = `Recebes as primeiras linhas de uma folha de cálculo (Excel ou CSV) com um extrato bancário ou um extrato da contabilidade. Cada linha vem numerada (L1, L2, ...) e cada célula vem com a letra da sua coluna (A=..., B=...). A tua ÚNICA tarefa é identificar como a folha está organizada, para que um programa a converta. Não convertas nem somes valores.

REGRAS
- firstDataRow: o número da primeira linha que já é um movimento real. Linhas de título, empresa, período, cabeçalhos e "Saldo inicial" ficam antes (ou são ignoradas pelo programa).
- headerRow: o número da linha com os nomes das colunas (null se não existir).
- dateColumn: a coluna da data do movimento (se houver data do movimento e data-valor, usa a do movimento).
- descriptionColumn: descrição do movimento. referenceColumn: número de documento, cheque ou referência (null se não existir).
- Se existirem colunas separadas de Débito e Crédito devolve debitColumn e creditColumn e deixa amountColumn a null. Usa as colunas com o nome que têm na folha. Se as colunas se chamarem Entradas/Saídas: no extrato bancário Saídas é debitColumn e Entradas é creditColumn; no extrato da contabilidade (conta de depósitos à ordem) Entradas é debitColumn e Saídas é creditColumn.
- Se houver UMA só coluna de valor com sinal (negativo = dinheiro que sai), devolve só amountColumn. Isto inclui colunas onde o sinal vem depois do número (por exemplo "12,40-"), ou onde há valores com e sem sinal.
- balanceColumn: o saldo depois de cada movimento. Se o saldo estiver dividido em duas colunas (devedor e credor), balanceColumn é o devedor e balanceCreditColumn o credor.
- dateFormat: "dmy" (dia/mês/ano), "mdy", "ymd" ou "excel_serial" (números como 45000 numa coluna de datas).
- numberFormat: "comma_decimal" (1.234,56 ou 1 234,56) ou "dot_decimal" (1,234.56 ou 1234.56).
- openingBalance e closingBalance: só se o saldo inicial ou final estiver escrito numa célula própria visível nestas linhas (por exemplo "Saldo inicial: 1.000,00"), como número; caso contrário null.
- periodStart e periodEnd (YYYY-MM-DD) se o período estiver visível; sourceName: o banco ou programa de contabilidade, se se perceber.
- Usa sempre as letras de coluna e os números de linha tal como aparecem. Nunca inventes.
- issues: só problemas graves de interpretação (por exemplo, não consegues identificar as colunas). NÃO comentes que algo "não está visível nas primeiras linhas": o programa lê o ficheiro todo. Na dúvida, devolve uma lista vazia.`;

export async function mapSheetWithModel(
  grid: SheetGrid,
  kind: StatementKind,
  opts: { client?: ModelClient; sampleRows?: number; retryNote?: string } = {}
): Promise<SheetMapping> {
  const sample = formatSampleForModel(grid, opts.sampleRows ?? SAMPLE_ROWS);
  const raw = await callStructured({
    client: opts.client,
    label: `map-${kind}${opts.retryNote ? "-retry" : ""}`,
    system: MAPPING_SYSTEM_PROMPT,
    content: [
      { type: "text", text: `Tipo de documento: ${KIND_LABEL[kind]}.\n\n${sample}` },
      { type: "text", text: opts.retryNote ?? "Devolve o mapeamento das colunas." },
    ],
    schema: SheetMappingSchema,
    maxTokens: 4000,
  });
  return normalizeMapping(raw);
}

// ---------- conversão (100% em código) ----------

const normLabel = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const RE_CARRY = /^(a transportar|transporte|transportado|de transporte|a transp)/;
const RE_OPENING = /^(saldo (inicial|anterior|de abertura|transportado|inic))/;
const RE_CLOSING = /^(saldo (final|atual|actual|disponivel|contabilistico|em \d|a \d))/;
const RE_TOTAL = /^(total|totais|soma)\b/;
const RE_HEADER_LIKE = /^(data|descri|movimento|pagina|extrato|extracto|conta|documento|debito|credito|saldo)\b/;

export interface ConvertedSheet {
  lines: ReadLine[];
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebits: number | null;
  totalCredits: number | null;
  // Débitos/créditos acumulados que alguns razões mostram na linha de saldo inicial.
  openingRowDebits: number | null;
  openingRowCredits: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string[];
  // Movimentos com um valor ou uma data que existe na folha mas não se conseguiu converter.
  conversionProblems: number;
}

const asText = (c: Cell): string | null => (c == null ? null : typeof c === "number" ? String(c) : c);

export function convertSheet(grid: SheetGrid, mapping: SheetMapping, kind: StatementKind): ConvertedSheet {
  const notes: string[] = [];
  const nf = mapping.numberFormat;
  const yearHint = Number((mapping.periodStart ?? mapping.periodEnd ?? "").slice(0, 4)) || undefined;

  const at = (r: number, c: number | null): Cell => (c == null ? null : (grid.rows[r]?.[c] ?? null));

  // Uma só coluna de Débito (ou de Crédito) com valores negativos é, na
  // verdade, uma coluna única com sinal (ex.: "Montante" com "12,40-").
  let { debitCol, creditCol, amountCol } = mapping;
  if (amountCol == null && (debitCol == null) !== (creditCol == null)) {
    const only = debitCol ?? creditCol;
    let negatives = 0;
    for (let r = mapping.firstDataIndex; r < grid.rows.length && negatives === 0; r++) {
      const v = parseAmount(grid.rows[r]?.[only!] ?? null, nf);
      if (v != null && v < 0) negatives++;
    }
    if (negatives > 0) {
      amountCol = only;
      debitCol = null;
      creditCol = null;
    }
  }
  // Células fundidas: data/descrição/referência preenchidas para baixo. Nos
  // valores não se preenche, para não duplicar um montante.
  const withMerge = (r: number, c: number | null): Cell => {
    const v = at(r, c);
    if (v != null || c == null) return v;
    for (const m of grid.merges) {
      if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return grid.rows[m.r1]?.[m.c1] ?? null;
    }
    return null;
  };
  const amountAt = (r: number, c: number | null) => parseAmount(at(r, c), nf);

  const lines: ReadLine[] = [];
  let opening: number | null = null;
  let closing: number | null = null;
  let totalDebits: number | null = null;
  let totalCredits: number | null = null;
  let openingRowDebits: number | null = null;
  let openingRowCredits: number | null = null;
  let filledDates = 0;
  let skippedUnlabeled = 0;
  let conversionProblems = 0;
  let previousDate: string | null = null;

  const headerTexts = new Set<string>();
  if (mapping.headerIndex != null) {
    for (const c of grid.rows[mapping.headerIndex] ?? []) {
      if (typeof c === "string") headerTexts.add(normLabel(c));
    }
  }

  const balanceOf = (r: number): number | null => {
    const debitBalance = amountAt(r, mapping.balanceCol);
    const creditBalance = amountAt(r, mapping.balanceCreditCol);
    if (debitBalance != null) return debitBalance;
    if (creditBalance != null) return -Math.abs(creditBalance);
    return null;
  };

  for (let r = mapping.firstDataIndex; r < grid.rows.length; r++) {
    const row = grid.rows[r] ?? [];
    if (row.every((c) => c == null)) continue;

    const descText = asText(withMerge(r, mapping.descCol));
    const textCells = row.map(asText).filter((t): t is string => t !== null && Number.isNaN(Number(t.replace(",", "."))));
    const labels = [descText, ...textCells].filter((t): t is string => !!t).map(normLabel);
    const date = parseDateCell(withMerge(r, mapping.dateCol), mapping.dateFormat, yearHint);

    if (labels.some((l) => RE_CARRY.test(l))) continue;

    const isOpening = labels.some((l) => RE_OPENING.test(l));
    const isClosing = !isOpening && labels.some((l) => RE_CLOSING.test(l));
    const isTotal = !isOpening && !isClosing && date == null && labels.some((l) => RE_TOTAL.test(l));

    if (isOpening || isClosing) {
      const debit = amountAt(r, debitCol);
      const credit = amountAt(r, creditCol);
      const balance = balanceOf(r);
      const signed = amountAt(r, amountCol);
      let value: number | null = balance ?? signed;
      if (isOpening && debit != null && credit != null) {
        // Razões que mostram os acumulados de débito/crédito na linha de saldo inicial.
        openingRowDebits = Math.abs(debit);
        openingRowCredits = Math.abs(credit);
      } else if (value == null) {
        const only = [debit, credit].filter((v): v is number => v != null);
        if (only.length === 1) value = only[0];
      }
      if (value != null) {
        if (isOpening) opening = value;
        else closing = value;
      }
      continue;
    }
    if (isTotal) {
      const debit = amountAt(r, debitCol);
      const credit = amountAt(r, creditCol);
      if (debit != null) totalDebits = Math.abs(debit);
      if (credit != null) totalCredits = Math.abs(credit);
      continue;
    }

    // Movimento: valor(es) nas colunas mapeadas.
    let debit: number | null = null;
    let credit: number | null = null;
    if (debitCol != null || creditCol != null) {
      const d = amountAt(r, debitCol);
      const c = amountAt(r, creditCol);
      debit = d == null ? null : Math.abs(d);
      credit = c == null ? null : Math.abs(c);
    } else {
      const v = amountAt(r, amountCol);
      if (v != null) {
        // Positivo = entra no banco, negativo = sai (perspetiva da conta bancária).
        const goesIn = v >= 0;
        if (kind === "bank") {
          if (goesIn) credit = v;
          else debit = -v;
        } else if (goesIn) debit = v;
        else credit = -v;
      }
    }
    const hasAmount = debit != null || credit != null;

    // Uma linha com data e com texto numa coluna de valor que não é número: valor por converter.
    if (date != null) {
      for (const c of [debitCol, creditCol, amountCol]) {
        if (c == null) continue;
        const raw = at(r, c);
        if (raw != null && String(raw).trim() !== "" && amountAt(r, c) == null) conversionProblems++;
      }
    }

    if (!hasAmount) {
      // Continuação da descrição (linha só com texto) ou lixo (cabeçalhos repetidos).
      const nonEmpty = row.filter((c) => c != null).length;
      const label = descText ? normLabel(descText) : "";
      if (descText && date == null && nonEmpty <= 2 && lines.length > 0 && !headerTexts.has(label) && !RE_HEADER_LIKE.test(label)) {
        const last = lines[lines.length - 1];
        last.description = `${last.description} ${descText}`.trim();
      }
      continue;
    }

    let lineDate = date;
    if (lineDate == null) {
      // Havia algo na coluna da data, mas não é uma data que se perceba.
      const rawDate = at(r, mapping.dateCol);
      if (rawDate != null && String(rawDate).trim() !== "") conversionProblems++;
      // Sem data e sem descrição: linha de totais sem etiqueta.
      if (!descText || previousDate == null) {
        skippedUnlabeled++;
        continue;
      }
      lineDate = previousDate;
      filledDates++;
    }
    previousDate = lineDate;

    lines.push({
      date: lineDate,
      description: descText ?? "",
      reference: asText(withMerge(r, mapping.refCol)),
      debit,
      credit,
      balanceAfter: balanceOf(r),
      page: r + 1,
      origin: `L${r + 1}`,
    });
  }

  if (filledDates > 0) notes.push(`${filledDates} movimento(s) sem data ficaram com a data da linha anterior.`);
  if (skippedUnlabeled > 0) notes.push(`${skippedUnlabeled} linha(s) só com valores e sem data nem descrição foram ignoradas (totais sem etiqueta).`);

  let openingBalance = opening ?? mapping.openingBalance;
  let closingBalance = closing ?? mapping.closingBalance;
  if (openingBalance == null && lines[0]?.balanceAfter != null) {
    const first = lines[0];
    openingBalance = (Math.round(first.balanceAfter! * 100) - amountInCents(kind, first.debit, first.credit)) / 100;
    notes.push("Saldo inicial calculado a partir do primeiro movimento (a folha não o indica).");
  }
  const last = lines[lines.length - 1];
  if (closingBalance == null && last?.balanceAfter != null) {
    closingBalance = last.balanceAfter;
    notes.push("Saldo final tirado do último movimento (a folha não o indica).");
  }

  const dates = lines.map((l) => l.date).sort();
  return {
    lines,
    openingBalance,
    closingBalance,
    totalDebits,
    totalCredits,
    openingRowDebits,
    openingRowCredits,
    periodStart: mapping.periodStart ?? dates[0] ?? null,
    periodEnd: mapping.periodEnd ?? dates[dates.length - 1] ?? null,
    notes,
    conversionProblems,
  };
}
