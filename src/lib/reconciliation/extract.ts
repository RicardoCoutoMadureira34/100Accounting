import type { ModelClient } from "./anthropic";
import { ALLOW_SCANNED_PDFS } from "./config";
import { KIND_LABEL, UserFacingError, scannedMessage, type StatementKind } from "./errors";
import { prepareDocument, readStatement, type PreparedDocument } from "./read-statement";
import {
  SAMPLE_ROWS_LARGE,
  convertSheet,
  mapSheetWithModel,
  readSpreadsheet,
  type ConvertedSheet,
  type InputFile,
} from "./spreadsheet";
import { unverifiedWarning, verificationGap, verifyStatement, type StatementData, type Verification } from "./verify";

// Passo 2 do fluxo: transformar qualquer ficheiro (PDF, Excel, CSV) na tabela
// padrão de um documento (linhas + saldos), já verificada.

import { detectFormat, type FileFormat } from "./file-format";

export { detectFormat };
export type { FileFormat, InputFile };

export interface ExtractedLine {
  position: number; // ordem no documento (com intervalos de 1000)
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  // valor com sinal, perspetiva da conta bancária, em cêntimos
  amountCents: number;
  balanceAfter: number | null;
  origin: string | null; // p2 (página) ou L15 (linha da folha)
}

export interface ExtractedStatement {
  kind: StatementKind;
  format: FileFormat;
  fileName: string;
  sourceName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebits: number | null;
  totalCredits: number | null;
  openingRowDebits: number | null;
  openingRowCredits: number | null;
  lines: ExtractedLine[];
  verified: boolean;
  retried: boolean;
  verification: Verification;
  // Avisos da leitura (sem o aviso de "não verificada", que se recalcula ao vivo).
  readIssues: string[];
  // valores/datas que não se conseguiram converter (0 = conversão limpa)
  conversionProblems: number;
  // readIssues + aviso de leitura não verificada.
  issues: string[];
}

export const POSITION_STEP = 1000;

// Aceita YYYY-MM-DD (e DD-MM-YYYY / DD/MM/YYYY por segurança). null se inválida.
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------- preparação (sem API) e leitura (com API) ----------

export type PreparedInput =
  | { kind: StatementKind; fileName: string; format: "pdf"; doc: PreparedDocument }
  | { kind: StatementKind; fileName: string; format: "xlsx" | "csv"; file: InputFile };

export async function prepareInput(kind: StatementKind, file: InputFile): Promise<PreparedInput> {
  const format = detectFormat(file);
  if (!format) throw new UserFacingError(`O ${KIND_LABEL[kind]} tem um formato não suportado. Usa PDF, Excel (.xlsx, .xls) ou CSV.`);
  if (format === "pdf") {
    return { kind, fileName: file.name, format, doc: await prepareDocument(kind, file.bytes) };
  }
  return { kind, fileName: file.name, format, file };
}

// Digitalizações (PDF sem texto) recusam-se antes de gastar tokens.
export function scannedMessages(inputs: PreparedInput[]): string[] {
  if (ALLOW_SCANNED_PDFS) return [];
  return inputs.filter((i) => i.format === "pdf" && i.doc.scanned).map((i) => scannedMessage(i.kind));
}

function finalizeLines(
  kind: StatementKind,
  lines: Verification["lines"],
  fallbackDate: string | null,
  label: string,
  issues: string[]
): { lines: ExtractedLine[]; badDates: number } {
  const valid = lines.map((l) => normalizeDate(l.date)).find((d): d is string => d !== null);
  const fallback = fallbackDate ?? valid ?? null;
  if (!fallback) throw new UserFacingError(`Não foi possível ler as datas do ${label}.`);
  let badDates = 0;
  const out = lines.map((l, i): ExtractedLine => {
    let date = normalizeDate(l.date);
    if (!date) {
      badDates++;
      date = fallback;
    }
    return {
      position: (i + 1) * POSITION_STEP,
      date,
      description: l.description.trim(),
      reference: l.reference?.trim() || null,
      debit: l.debit,
      credit: l.credit,
      amountCents: l.amountCents,
      balanceAfter: l.balanceAfter,
      origin: l.origin ?? (Number.isFinite(l.page) && l.page > 0 ? `p${l.page}` : null),
    };
  });
  if (badDates > 0) issues.push(`No ${label}, ${badDates} movimento(s) tinham uma data ilegível e ficaram com a data do período.`);
  return { lines: out, badDates };
}

async function readPdfInput(input: Extract<PreparedInput, { format: "pdf" }>, opts: { client?: ModelClient }): Promise<ExtractedStatement> {
  const outcome = await readStatement(input.doc, opts);
  const { read } = outcome;
  const label = KIND_LABEL[input.kind];
  const readIssues = [...outcome.readIssues];
  const { lines, badDates } = finalizeLines(
    input.kind,
    outcome.verification.lines,
    normalizeDate(read.periodEnd) ?? normalizeDate(read.periodStart),
    label,
    readIssues
  );
  const issues = outcome.verified ? readIssues : [...readIssues, unverifiedWarning(input.kind, outcome.verification)];
  return {
    kind: input.kind,
    format: "pdf",
    fileName: input.fileName,
    sourceName: read.sourceName?.trim() || null,
    periodStart: normalizeDate(read.periodStart),
    periodEnd: normalizeDate(read.periodEnd),
    openingBalance: read.openingBalance,
    closingBalance: read.closingBalance,
    totalDebits: read.documentTotalDebits,
    totalCredits: read.documentTotalCredits,
    openingRowDebits: read.openingRowDebits,
    openingRowCredits: read.openingRowCredits,
    lines,
    conversionProblems: badDates,
    verified: outcome.verified,
    retried: outcome.retried,
    verification: outcome.verification,
    readIssues,
    issues,
  };
}

const sheetData = (c: ConvertedSheet): StatementData => ({
  openingBalance: c.openingBalance,
  closingBalance: c.closingBalance,
  documentTotalDebits: c.totalDebits,
  documentTotalCredits: c.totalCredits,
  openingRowDebits: c.openingRowDebits,
  openingRowCredits: c.openingRowCredits,
  lines: c.lines,
});

async function readSheetInput(
  input: Extract<PreparedInput, { format: "xlsx" | "csv" }>,
  opts: { client?: ModelClient }
): Promise<ExtractedStatement> {
  const { kind } = input;
  const label = KIND_LABEL[kind];
  const grid = readSpreadsheet(input.file);

  // 1) O modelo vê só as primeiras linhas e diz como a folha está organizada.
  let mapping = await mapSheetWithModel(grid, kind, { client: opts.client });
  let converted = convertSheet(grid, mapping, kind);
  if (converted.lines.length === 0) {
    // Cabeçalhos/lixo a mais no topo: tenta com uma amostra maior.
    mapping = await mapSheetWithModel(grid, kind, { client: opts.client, sampleRows: SAMPLE_ROWS_LARGE });
    converted = convertSheet(grid, mapping, kind);
  }
  if (converted.lines.length === 0) {
    throw new UserFacingError(`Não foram encontrados movimentos no ${label}. Confirma que o ficheiro é um extrato.`);
  }

  // 2) O código converte TODAS as linhas; verifica-se e, se falhar, repete-se uma vez.
  let verification = verifyStatement(kind, sheetData(converted));
  let retried = false;
  if (!verification.ok && verification.performedChecks > 0) {
    retried = true;
    const note =
      `ATENÇÃO: com o mapeamento anterior a leitura não bate certo: ${verification.failures.join("; ")}. ` +
      `Revê o mapeamento (colunas de Débito/Crédito ou montante com sinal, formato dos números e das datas, primeira linha de movimentos) e devolve-o corrigido.`;
    try {
      const mapping2 = await mapSheetWithModel(grid, kind, { client: opts.client, retryNote: note });
      const converted2 = convertSheet(grid, mapping2, kind);
      if (converted2.lines.length > 0) {
        const v2 = verifyStatement(kind, sheetData(converted2));
        if (v2.ok || verificationGap(v2) < verificationGap(verification)) {
          mapping = mapping2;
          converted = converted2;
          verification = v2;
        }
      }
    } catch (e) {
      console.error(`[reconciliation] retry do mapeamento falhou (${kind}):`, e);
    }
  }

  const readIssues: string[] = [
    ...mapping.issues.map((i) => `${label[0].toUpperCase()}${label.slice(1)}: ${i}`),
    ...converted.notes,
    ...verification.corrections,
  ];
  const { lines, badDates } = finalizeLines(kind, verification.lines, converted.periodEnd ?? converted.periodStart, label, readIssues);
  const issues = verification.ok ? readIssues : [...readIssues, unverifiedWarning(kind, verification)];

  return {
    kind,
    format: input.format,
    fileName: input.fileName,
    sourceName: mapping.sourceName,
    periodStart: converted.periodStart,
    periodEnd: converted.periodEnd,
    openingBalance: converted.openingBalance,
    closingBalance: converted.closingBalance,
    totalDebits: converted.totalDebits,
    totalCredits: converted.totalCredits,
    openingRowDebits: converted.openingRowDebits,
    openingRowCredits: converted.openingRowCredits,
    lines,
    conversionProblems: converted.conversionProblems + badDates,
    verified: verification.ok,
    retried,
    verification,
    readIssues,
    issues,
  };
}

export async function readPrepared(input: PreparedInput, opts: { client?: ModelClient } = {}): Promise<ExtractedStatement> {
  if (input.format === "pdf") {
    if (input.doc.scanned && !ALLOW_SCANNED_PDFS) throw new UserFacingError(scannedMessage(input.kind));
    return readPdfInput(input, opts);
  }
  return readSheetInput(input, opts);
}

export async function extractStatement(kind: StatementKind, file: InputFile, opts: { client?: ModelClient } = {}): Promise<ExtractedStatement> {
  return readPrepared(await prepareInput(kind, file), opts);
}
