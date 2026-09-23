import { extractTextItems, getDocumentProxy } from "unpdf";
import { MIN_EXTRACTED_CHARS } from "./config";

export interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function median(values: number[], fallback: number): number {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return fallback;
  return v[Math.floor(v.length / 2)];
}

function pageMetrics(words: PositionedText[]) {
  const charWidth = Math.min(
    12,
    Math.max(2, median(words.map((w) => (w.str.length > 0 ? w.width / w.str.length : 0)), 5))
  );
  const rowTolerance = Math.max(1.5, 0.4 * median(words.map((w) => w.height), 10));
  return { charWidth, rowTolerance };
}

// Agrupa fragmentos por linha: y decrescente (o topo da página tem y maior).
function groupRows(words: PositionedText[], rowTolerance: number): PositionedText[][] {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedText[][] = [];
  let rowY = Number.NaN;
  for (const w of sorted) {
    if (rows.length > 0 && Math.abs(w.y - rowY) <= rowTolerance) {
      rows[rows.length - 1].push(w);
    } else {
      rows.push([w]);
      rowY = w.y;
    }
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

// ---------- colunas numéricas ----------
//
// Os valores das tabelas vêm alinhados à DIREITA e os cabeçalhos raramente
// coincidem com essa margem, por isso só com espaços é ambíguo saber se um
// número está em Débito ou em Crédito. Em vez de deixar o modelo adivinhar,
// deteta-se cada coluna numérica pela margem direita comum dos valores e dá-se
// -lhe o nome do cabeçalho; cada valor sai etiquetado, ex.: "17 000,00 [Crédito]".

export interface NumericColumn {
  right: number;
  label: string | null;
}

const AMOUNT = /^[-+(]?\d[\d .]*[,.]\d{1,2}[-)]?$/;
const HEADER_START = /^(debito|credito|montante|valor|saldo|sald\b|sald\.|movimento)/;
const RIGHT_EDGE_TOLERANCE = 3.5;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const isAmount = (w: PositionedText) => AMOUNT.test(w.str.trim());

export function detectNumericColumns(items: PositionedText[], previous: NumericColumn[] = []): NumericColumn[] {
  const words = items.filter((i) => i.str.trim() !== "");
  const { charWidth, rowTolerance } = pageMetrics(words);

  // 1) margens direitas comuns dos valores (pelo menos 2 valores por coluna)
  const rights = words.filter(isAmount).map((w) => w.x + w.width).sort((a, b) => a - b);
  const clusters: { sum: number; n: number }[] = [];
  for (const r of rights) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(r - last.sum / last.n) <= Math.max(RIGHT_EDGE_TOLERANCE, 0.6 * charWidth)) {
      last.sum += r;
      last.n++;
    } else {
      clusters.push({ sum: r, n: 1 });
    }
  }
  const columns: NumericColumn[] = clusters.filter((c) => c.n >= 2).map((c) => ({ right: c.sum / c.n, label: null }));
  if (columns.length === 0) return [];

  // 2) cabeçalho: a linha mais acima com palavras de coluna numérica
  let headers: PositionedText[] = [];
  for (const row of groupRows(words, rowTolerance)) {
    const phrases: PositionedText[] = [];
    for (const w of row) {
      const last = phrases[phrases.length - 1];
      if (last && w.x - (last.x + last.width) < 1.5 * charWidth) {
        phrases[phrases.length - 1] = {
          ...last,
          str: `${last.str} ${w.str}`,
          width: w.x + w.width - last.x,
        };
      } else {
        phrases.push({ ...w });
      }
    }
    const found = phrases.filter((p) => HEADER_START.test(normalize(p.str)));
    if (found.length >= (columns.length === 1 ? 1 : 2)) {
      headers = found;
      break;
    }
  }

  if (headers.length > 0) {
    if (headers.length === columns.length) {
      headers.forEach((h, i) => (columns[i].label = h.str.trim()));
    } else {
      const pairs: { h: PositionedText; c: NumericColumn; d: number }[] = [];
      for (const h of headers) for (const c of columns) pairs.push({ h, c, d: Math.abs(c.right - (h.x + h.width)) });
      pairs.sort((a, b) => a.d - b.d);
      const usedH = new Set<PositionedText>();
      for (const { h, c, d } of pairs) {
        if (usedH.has(h) || c.label !== null || d > 8 * charWidth) continue;
        usedH.add(h);
        c.label = h.str.trim();
      }
    }
  } else {
    // Páginas de continuação sem cabeçalho: reaproveita as colunas anteriores.
    for (const c of columns) {
      const match = previous.find((p) => p.label && Math.abs(p.right - c.right) <= 6);
      if (match) c.label = match.label;
    }
  }
  return columns;
}

// Reconstrói o texto de UMA página como uma "grelha" monoespaçada: as linhas
// da tabela ficam juntas (mesmo y) e cada fragmento é colocado na coluna que
// corresponde à sua posição x. Os valores das colunas numéricas detetadas
// levam a etiqueta da coluna.
export function layoutPageText(items: PositionedText[], columns: NumericColumn[] = []): string {
  const words = items.filter((i) => i.str.trim() !== "");
  if (words.length === 0) return "";

  const { charWidth, rowTolerance } = pageMetrics(words);
  const minX = Math.min(...words.map((w) => w.x));

  const labelFor = (w: PositionedText): string | null => {
    if (columns.length === 0 || !isAmount(w)) return null;
    const right = w.x + w.width;
    const col = columns.find((c) => c.label && Math.abs(c.right - right) <= Math.max(RIGHT_EDGE_TOLERANCE, 0.6 * charWidth));
    return col?.label ?? null;
  };

  const lines: string[] = [];
  for (const row of groupRows(words, rowTolerance)) {
    let line = "";
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const w of row) {
      const targetCol = Math.round((w.x - minX) / charWidth);
      const gap = w.x - prevEnd;
      if (line.length > 0 && gap >= 0.25 * charWidth && line.length >= targetCol) {
        line += " ";
      }
      if (line.length < targetCol) line += " ".repeat(targetCol - line.length);
      const label = labelFor(w);
      line += label ? `${w.str} [${label}]` : w.str;
      prevEnd = w.x + w.width;
    }
    const trimmed = line.trimEnd();
    if (trimmed) lines.push(trimmed);
  }
  return lines.join("\n");
}

export interface ExtractedPdf {
  pages: string[];
  // Texto completo com marcadores "=== Página N ===" (é isto que vai ao modelo).
  text: string;
  // Sem camada de texto suficiente: o PDF é uma digitalização.
  scanned: boolean;
}

export function assemblePages(pages: string[]): ExtractedPdf {
  const useful = pages.join("").replace(/\s/g, "").length;
  const text = pages.map((p, i) => `=== Página ${i + 1} ===\n${p}`).join("\n\n");
  return { pages, text, scanned: useful < MIN_EXTRACTED_CHARS };
}

export async function extractPdfText(pdf: Uint8Array): Promise<ExtractedPdf> {
  // O pdf.js pode transferir/desligar o buffer recebido, por isso passa-se uma cópia.
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { items } = await extractTextItems(doc);
  let columns: NumericColumn[] = [];
  const pages = items.map((pageItems) => {
    const detected = detectNumericColumns(pageItems, columns);
    if (detected.length > 0) columns = detected;
    return layoutPageText(pageItems, detected);
  });
  return assemblePages(pages);
}
