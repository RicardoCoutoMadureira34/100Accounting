import ExcelJS from "exceljs";
import { categoryLabel, type ProbableGroup, type UnmatchedRow } from "./results";

// Ficheiro "Pendentes (Excel)" para a contabilista lançar/regularizar: só os
// movimentos sem correspondência, mais um mapa de reconciliação com fórmulas.
// Sem textos gerados pela IA — só dados reais dos extratos, categoria e ação.
// A lógica está separada do componente (results-view.tsx) para poder ser
// testada sem browser.

const round2 = (n: number): number => Math.round(n * 100) / 100;

const dmy = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const isoToDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// Texto fixo gerado em código (hints.ts, nunca pelo modelo) para os
// movimentos que já explicam a diferença de saldos iniciais: é o único sinal
// fiável de que um movimento é "de um mês anterior" (a categoria continua a
// ser a que o modelo escolheu, p.ex. "cheque_em_transito").
const PRIOR_PERIOD_MARK = "saldos iniciais";
export function isPriorPeriod(note: string | null): boolean {
  return !!note && note.includes(PRIOR_PERIOD_MARK);
}

const BANK_ACTIONS: Record<string, string> = {
  comissao_juro_bancario: "Lançar na contabilidade",
  debito_nao_registado: "Lançar na contabilidade",
  erro_transcricao: "Lançar na contabilidade",
  outro: "Lançar na contabilidade",
  outra_sem_categoria: "Lançar na contabilidade",
  duplicado: "Lançar na contabilidade",
  cheque_em_transito: "Lançar na contabilidade",
  deposito_em_transito: "Lançar na contabilidade",
};
const ACCT_ACTIONS: Record<string, string> = {
  cheque_em_transito: "Aguardar — em trânsito (não lançar)",
  deposito_em_transito: "Aguardar — em trânsito (não lançar)",
  duplicado: "Anular lançamento duplicado",
  erro_transcricao: "Verificar lançamento",
  outro: "Verificar lançamento",
  outra_sem_categoria: "Verificar lançamento",
  comissao_juro_bancario: "Verificar lançamento",
  debito_nao_registado: "Verificar lançamento",
};

// Movimento de mês anterior: nada a fazer, já foi lançado antes. Senão, a
// ação vem da categoria (o modelo escolhe-a; nunca escreve a ação).
export function actionFor(side: "bank" | "acct", category: string | null, note: string | null): string {
  if (isPriorPeriod(note)) return "Nenhuma — já lançado em mês anterior";
  const cat = category ?? "outra_sem_categoria";
  return side === "bank" ? (BANK_ACTIONS[cat] ?? "Lançar na contabilidade") : (ACCT_ACTIONS[cat] ?? "Verificar lançamento");
}

const BANK_ACTION_ORDER = ["Lançar na contabilidade", "Nenhuma — já lançado em mês anterior"];
const ACCT_ACTION_ORDER = ["Aguardar — em trânsito (não lançar)", "Anular lançamento duplicado", "Verificar lançamento", "Nenhuma — já lançado em mês anterior"];

// Saldo final banco − movimentos só no banco (líquido) + movimentos só na
// contabilidade (líquido) − diferenças de valor em pares prováveis −
// diferença de saldos iniciais = deve dar o saldo final da contabilidade.
export interface MapaInput {
  bankClose: number | null;
  acctClose: number | null;
  bankOpen: number | null;
  acctOpen: number | null;
  bankOnly: UnmatchedRow[];
  acctOnly: UnmatchedRow[];
  probable: ProbableGroup[];
}

export interface MapaResult {
  bankClose: number;
  acctClose: number;
  liquidBank: number;
  liquidAcct: number;
  diffValor: number;
  diffOpening: number;
  calculated: number;
  explain: number;
}

export function computeMapa(input: MapaInput): MapaResult {
  const bankClose = round2(input.bankClose ?? 0);
  const acctClose = round2(input.acctClose ?? 0);
  const liquidBank = round2(input.bankOnly.reduce((s, t) => s + t.amount, 0));
  const liquidAcct = round2(input.acctOnly.reduce((s, t) => s + t.amount, 0));
  const diffValor = round2(
    input.probable.reduce((s, g) => s + g.bank.reduce((x, t) => x + t.amount, 0) - g.accounting.reduce((x, t) => x + t.amount, 0), 0)
  );
  const diffOpening = round2((input.bankOpen ?? 0) - (input.acctOpen ?? 0));
  const calculated = round2(bankClose - liquidBank + liquidAcct - diffValor - diffOpening);
  const explain = round2(calculated - acctClose);
  return { bankClose, acctClose, liquidBank, liquidAcct, diffValor, diffOpening, calculated, explain };
}

// ---------- estilos ----------

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFCBD5E1" } };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const CURRENCY_FMT = "#,##0.00";
const DATE_FMT = "dd/mm/yyyy";

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
  });
}

interface SheetRow {
  date: string;
  reference: string | null;
  description: string;
  category: string;
  action: string;
  debit: number | null;
  credit: number | null;
}

function groupByAction(rows: SheetRow[], order: string[]): { action: string; rows: SheetRow[] }[] {
  const map = new Map<string, SheetRow[]>();
  for (const r of rows) {
    if (!map.has(r.action)) map.set(r.action, []);
    map.get(r.action)!.push(r);
  }
  const known = order.filter((a) => map.has(a)).map((a) => ({ action: a, rows: map.get(a)! }));
  const rest = [...map.keys()]
    .filter((a) => !order.includes(a))
    .map((a) => ({ action: a, rows: map.get(a)! }));
  return [...known, ...rest];
}

interface SheetEntry {
  action: string;
  date: string;
  description: string;
  category: string;
  debit: number | null;
  credit: number | null;
}

interface SheetResult {
  sheetName: string;
  debitCell: string; // "'Só no Banco'!E7"
  creditCell: string;
  entries: SheetEntry[];
}

// Uma folha (Só no Banco / Só na Contabilidade): agrupada por ação, com
// subtotal por grupo (fórmula) e total geral (soma dos subtotais).
function buildUnmatchedSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: SheetRow[],
  order: string[],
  includeReference: boolean
): SheetResult {
  const sheet = wb.addWorksheet(name);
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const headers = includeReference
    ? ["Data", "N.º documento", "Descrição do lançamento", "Categoria", "Ação", "Débito (conta 12)", "Crédito (conta 12)"]
    : ["Data", "Descrição do extrato", "Categoria", "Ação", "Débito (conta 12)", "Crédito (conta 12)"];
  const widths = includeReference ? [12, 16, 42, 24, 30, 14, 14] : [12, 44, 24, 30, 14, 14];
  sheet.columns = headers.map((header, i) => ({ header, width: widths[i] }));
  styleHeaderRow(sheet.getRow(1));

  const labelCol = includeReference ? 3 : 2;
  const debitCol = includeReference ? 6 : 5;
  const creditCol = debitCol + 1;
  const debitLetter = sheet.getColumn(debitCol).letter;
  const creditLetter = sheet.getColumn(creditCol).letter;

  const groups = groupByAction(rows, order);
  const entries: SheetEntry[] = [];
  const subtotalRows: number[] = [];
  let r = 1;

  for (const g of groups) {
    const startRow = r + 1;
    for (const row of g.rows) {
      r++;
      const excelRow = sheet.getRow(r);
      let col = 1;
      excelRow.getCell(col).value = isoToDate(row.date);
      excelRow.getCell(col).numFmt = DATE_FMT;
      col++;
      if (includeReference) {
        excelRow.getCell(col).value = row.reference ?? "";
        col++;
      }
      excelRow.getCell(col).value = row.description;
      col++;
      excelRow.getCell(col).value = row.category;
      col++;
      excelRow.getCell(col).value = row.action;
      col++;
      excelRow.getCell(debitCol).value = row.debit;
      excelRow.getCell(creditCol).value = row.credit;
      excelRow.eachCell((cell, colNumber) => {
        cell.border = BORDER;
        if (colNumber === debitCol || colNumber === creditCol) cell.numFmt = CURRENCY_FMT;
      });
      entries.push({ action: row.action, date: row.date, description: row.description, category: row.category, debit: row.debit, credit: row.credit });
    }
    const endRow = r;
    r++;
    const subRow = sheet.getRow(r);
    subRow.getCell(labelCol).value = `Subtotal: ${g.action}`;
    if (endRow >= startRow) {
      subRow.getCell(debitCol).value = { formula: `SUM(${debitLetter}${startRow}:${debitLetter}${endRow})` };
      subRow.getCell(creditCol).value = { formula: `SUM(${creditLetter}${startRow}:${creditLetter}${endRow})` };
    }
    subRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, italic: true };
      cell.border = BORDER;
      if (colNumber === debitCol || colNumber === creditCol) cell.numFmt = CURRENCY_FMT;
    });
    subtotalRows.push(r);
  }

  if (rows.length === 0) {
    r = 2;
    sheet.getRow(r).getCell(labelCol).value = "Sem movimentos nesta secção.";
  }

  r++;
  const totalRow = sheet.getRow(r);
  totalRow.getCell(labelCol).value = "Total geral";
  totalRow.getCell(debitCol).value = subtotalRows.length === 0 ? 0 : { formula: subtotalRows.map((rr) => `${debitLetter}${rr}`).join("+") };
  totalRow.getCell(creditCol).value = subtotalRows.length === 0 ? 0 : { formula: subtotalRows.map((rr) => `${creditLetter}${rr}`).join("+") };
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    cell.border = { ...BORDER, top: { style: "double", color: { argb: "FF334155" } } };
    if (colNumber === debitCol || colNumber === creditCol) cell.numFmt = CURRENCY_FMT;
  });

  return { sheetName: name, debitCell: `'${name}'!${debitLetter}${r}`, creditCell: `'${name}'!${creditLetter}${r}`, entries };
}

export interface PendentesInput {
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  bankBalance: number | null;
  accountingBalance: number | null;
  bankOpeningBalance: number | null;
  accountingOpeningBalance: number | null;
  bankOnly: UnmatchedRow[];
  acctOnly: UnmatchedRow[];
  // grupos prováveis pendentes ou confirmados (os rejeitados já contam para
  // bankOnly/acctOnly): só entram no mapa quando há diferença de valor.
  probable: ProbableGroup[];
}

export function pendentesFilename(input: PendentesInput): string {
  const ref = input.periodEnd ?? input.periodStart ?? input.createdAt;
  return `Pendentes_Reconciliacao_${ref.slice(0, 7)}.xlsx`;
}

export function buildPendentesWorkbook(input: PendentesInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Match";

  const bankRows: SheetRow[] = input.bankOnly.map((t) => {
    const c = round2(t.amount);
    return {
      date: t.transaction_date,
      reference: t.reference,
      description: t.description,
      category: categoryLabel(t.category),
      action: actionFor("bank", t.category, t.note),
      debit: c > 0 ? c : null,
      credit: c < 0 ? -c : null,
    };
  });
  const acctRows: SheetRow[] = input.acctOnly.map((t) => {
    const c = round2(t.amount);
    return {
      date: t.transaction_date,
      reference: t.reference,
      description: t.description,
      category: categoryLabel(t.category),
      action: actionFor("acct", t.category, t.note),
      debit: c > 0 ? c : null,
      credit: c < 0 ? -c : null,
    };
  });

  const bankSheet = buildUnmatchedSheet(wb, "Só no Banco", bankRows, BANK_ACTION_ORDER, false);
  const acctSheet = buildUnmatchedSheet(wb, "Só na Contabilidade", acctRows, ACCT_ACTION_ORDER, true);

  buildMapaSheet(wb, input, bankSheet, acctSheet);

  return wb;
}

function buildMapaSheet(wb: ExcelJS.Workbook, input: PendentesInput, bank: SheetResult, acct: SheetResult) {
  const sheet = wb.addWorksheet("Mapa de reconciliação");
  sheet.columns = [{ width: 48 }, { width: 16 }];

  let r = 1;
  sheet.getCell(`A${r}`).value = "Mapa de reconciliação";
  sheet.getCell(`A${r}`).font = { bold: true, size: 13 };
  r += 2;

  if (input.periodStart && input.periodEnd) {
    sheet.getCell(`A${r}`).value = "Período";
    sheet.getCell(`B${r}`).value = `${dmy(input.periodStart)} a ${dmy(input.periodEnd)}`;
    r += 2;
  }

  const bankClose = round2(input.bankBalance ?? 0);
  const acctClose = round2(input.accountingBalance ?? 0);
  const diffValor = computeMapa({
    bankClose: input.bankBalance,
    acctClose: input.accountingBalance,
    bankOpen: input.bankOpeningBalance,
    acctOpen: input.accountingOpeningBalance,
    bankOnly: input.bankOnly,
    acctOnly: input.acctOnly,
    probable: input.probable,
  }).diffValor;
  const diffOpening = round2((input.bankOpeningBalance ?? 0) - (input.accountingOpeningBalance ?? 0));

  const line = (label: string, value: number | { formula: string }, bold = false) => {
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`B${r}`).value = value;
    sheet.getCell(`B${r}`).numFmt = CURRENCY_FMT;
    if (bold) {
      sheet.getCell(`A${r}`).font = { bold: true };
      sheet.getCell(`B${r}`).font = { bold: true };
    }
    const row = r;
    r++;
    return row;
  };

  const rFinal = line("Saldo final do extrato bancário", bankClose);
  const rLiquidBank = line("(−) Movimentos só no banco (líquido)", { formula: `${bank.debitCell}-${bank.creditCell}` });
  const rLiquidAcct = line("(+) Movimentos só na contabilidade (líquido)", { formula: `${acct.debitCell}-${acct.creditCell}` });
  const rDiffValor = line("(−) Diferenças de valor em movimentos correspondentes", diffValor);
  const rDiffOpening = line("(−) Diferença de saldos iniciais (meses anteriores)", diffOpening);
  const rCalculated = line(
    "= Saldo contabilístico calculado",
    { formula: `B${rFinal}-B${rLiquidBank}+B${rLiquidAcct}-B${rDiffValor}-B${rDiffOpening}` },
    true
  );
  r++;
  const rReal = line("Saldo contabilístico (extrato da contabilidade)", acctClose);
  line("Diferença por explicar", { formula: `B${rCalculated}-B${rReal}` }, true);
  r += 2;

  sheet.getCell(`A${r}`).value = "Lançamentos a efetuar";
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const colHeaderRow = sheet.getRow(r);
  ["Data", "Descrição", "Categoria", "Débito (conta 12)", "Crédito (conta 12)"].forEach((h, i) => {
    colHeaderRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(colHeaderRow);
  r++;

  const toDo = [
    ...bank.entries.filter((e) => e.action === "Lançar na contabilidade"),
    ...acct.entries.filter((e) => e.action === "Anular lançamento duplicado"),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const startRow = r;
  for (const e of toDo) {
    const row = sheet.getRow(r);
    row.getCell(1).value = isoToDate(e.date);
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).value = e.description;
    row.getCell(3).value = e.category;
    row.getCell(4).value = e.debit;
    row.getCell(5).value = e.credit;
    row.eachCell((cell, colNumber) => {
      cell.border = BORDER;
      if (colNumber === 4 || colNumber === 5) cell.numFmt = CURRENCY_FMT;
    });
    r++;
  }
  if (toDo.length === 0) {
    sheet.getCell(`A${r}`).value = "Sem lançamentos a efetuar.";
    r++;
  }
  const endRow = r - 1;
  const totalRow = sheet.getRow(r);
  totalRow.getCell(2).value = "Total";
  if (toDo.length > 0) {
    totalRow.getCell(4).value = { formula: `SUM(D${startRow}:D${endRow})` };
    totalRow.getCell(5).value = { formula: `SUM(E${startRow}:E${endRow})` };
  } else {
    totalRow.getCell(4).value = 0;
    totalRow.getCell(5).value = 0;
  }
  totalRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    cell.border = { ...BORDER, top: { style: "double", color: { argb: "FF334155" } } };
    if (colNumber === 4 || colNumber === 5) cell.numFmt = CURRENCY_FMT;
  });
}
