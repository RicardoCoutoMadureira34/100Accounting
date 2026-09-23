import type { ModelClient } from "./anthropic";
import { ALLOW_SCANNED_PDFS } from "./config";
import { UserFacingError, scannedMessage } from "./errors";
import { detectHints } from "./hints";
import { matchMovements, type MTx } from "./matching";
import { writeNarrative, type UnmatchedCategory } from "./narrative";
import { prepareDocument, readStatement, type StatementOutcome } from "./read-statement";
import { fromCents, formatEuros, toCents, type SignedLine } from "./verify";

// Pipeline: 1) ler cada PDF com uma chamada própria (só leitura), 2) verificar
// a aritmética em código, 3) emparelhar de forma determinística, 4) pedir ao
// modelo só o texto do relatório a partir das listas já calculadas.

export interface ResultTx {
  date: string;
  description: string;
  amount: number; // perspetiva da conta bancária (+ entra, - sai)
  reference: string | null;
  page: number | null;
}

export interface ReconciliationResult {
  issues: string[];
  extractionVerified: boolean;
  bankOpeningBalance: number | null;
  bankClosingBalance: number | null;
  accountingOpeningBalance: number | null;
  accountingClosingBalance: number | null;
  exact: { bank: ResultTx; accounting: ResultTx; confidence: number }[];
  probable: { bank: ResultTx[]; accounting: ResultTx[]; confidence: number; reason: string }[];
  unmatchedBank: (ResultTx & { category: UnmatchedCategory; observation: string })[];
  unmatchedAccounting: (ResultTx & { category: UnmatchedCategory; observation: string })[];
  // difference = diferença do período que os movimentos pendentes NÃO explicam.
  difference: number | null;
  closes: boolean;
  summary: string;
  nextSteps: string[];
}

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

interface Movement extends MTx {
  page: number | null;
}

function toMovements(outcome: StatementOutcome, label: string, issues: string[]): Movement[] {
  const read = outcome.read;
  const valid = outcome.verification.lines
    .map((l) => normalizeDate(l.date))
    .find((d): d is string => d !== null);
  const fallback = normalizeDate(read.periodEnd) ?? normalizeDate(read.periodStart) ?? valid;
  if (!fallback) throw new UserFacingError(`Não foi possível ler as datas do ${label}.`);

  const movements: Movement[] = [];
  let badDates = 0;
  outcome.verification.lines.forEach((line: SignedLine) => {
    let date = normalizeDate(line.date);
    if (!date) {
      badDates++;
      date = fallback;
    }
    movements.push({
      id: line.index,
      date,
      description: line.description.trim(),
      reference: line.reference?.trim() || null,
      cents: line.amountCents,
      page: Number.isFinite(line.page) ? line.page : null,
    });
  });
  if (badDates > 0) issues.push(`No ${label}, ${badDates} movimento(s) tinham uma data ilegível e ficaram com a data do período.`);
  return movements;
}

export async function analyzeReconciliation(
  bankPdf: Uint8Array,
  accountingPdf: Uint8Array,
  opts: { client?: ModelClient } = {}
): Promise<ReconciliationResult> {
  // 1) Extração local do texto (sem API). Digitalizações são recusadas já aqui.
  const [bankDoc, acctDoc] = await Promise.all([prepareDocument("bank", bankPdf), prepareDocument("accounting", accountingPdf)]);
  const scanned = [bankDoc, acctDoc].filter((d) => d.scanned);
  if (scanned.length > 0 && !ALLOW_SCANNED_PDFS) {
    throw new UserFacingError(scanned.map((d) => scannedMessage(d.kind)).join(" "));
  }

  // 2) Uma chamada por documento, em paralelo, só para ler.
  const [bank, acct] = await Promise.all([readStatement(bankDoc, opts), readStatement(acctDoc, opts)]);

  const issues: string[] = [...bank.issues, ...acct.issues];
  const bankMoves = toMovements(bank, "extrato bancário", issues);
  const acctMoves = toMovements(acct, "extrato da contabilidade", issues);
  const pageOf = new Map<string, number | null>();
  bankMoves.forEach((m) => pageOf.set(`b${m.id}`, m.page));
  acctMoves.forEach((m) => pageOf.set(`a${m.id}`, m.page));

  // 3) Emparelhamento determinístico.
  const matching = matchMovements(bankMoves, acctMoves);

  // 4) Saldos e "fecha".
  const bOpen = bank.read.openingBalance;
  const bClose = bank.read.closingBalance;
  const aOpen = acct.read.openingBalance;
  const aClose = acct.read.closingBalance;
  const periodDiffCents =
    bOpen != null && bClose != null && aOpen != null && aClose != null
      ? toCents(bClose) - toCents(bOpen) - (toCents(aClose) - toCents(aOpen))
      : null;

  const sum = (xs: MTx[]) => xs.reduce((s, x) => s + x.cents, 0);
  const explainedCents =
    sum(matching.unmatchedBank) -
    sum(matching.unmatchedAcct) +
    matching.probable.reduce((s, p) => s + sum(p.bank) - sum(p.acct), 0);
  const remainingCents = periodDiffCents == null ? null : periodDiffCents - explainedCents;
  const closes = remainingCents != null && Math.abs(remainingCents) < 1;

  if (bOpen != null && aOpen != null && toCents(bOpen) !== toCents(aOpen)) {
    issues.push(
      `Os saldos iniciais diferem ${formatEuros(Math.abs(toCents(bOpen) - toCents(aOpen)))}, o que vem de meses anteriores.`
    );
  }
  if (periodDiffCents == null) {
    issues.push("Não foi possível calcular a diferença do período: falta o saldo inicial ou o saldo final num dos extratos.");
  }

  // 5) Indicações calculadas em código (duplicados, movimentos de meses
  // anteriores) e texto do relatório (falha sem impedir a gravação).
  const hints = detectHints({ matching, bankOpening: bOpen, acctOpening: aOpen });
  const narrative = await writeNarrative(
    {
      hints,
      unmatchedBank: matching.unmatchedBank,
      unmatchedAcct: matching.unmatchedAcct,
      probable: matching.probable,
      exactCount: matching.exact.length,
      bankOpening: bOpen,
      bankClosing: bClose,
      acctOpening: aOpen,
      acctClosing: aClose,
      periodDiffCents,
      explainedCents,
      differenceCents: remainingCents,
      closes,
      warnings: issues,
    },
    opts
  );

  const tx = (side: "b" | "a", m: MTx): ResultTx => ({
    date: m.date,
    description: m.description,
    amount: fromCents(m.cents),
    reference: m.reference,
    page: pageOf.get(`${side}${m.id}`) ?? null,
  });

  return {
    issues,
    extractionVerified: bank.verified && acct.verified,
    bankOpeningBalance: bOpen,
    bankClosingBalance: bClose,
    accountingOpeningBalance: aOpen,
    accountingClosingBalance: aClose,
    exact: matching.exact.map((e) => ({ bank: tx("b", e.bank), accounting: tx("a", e.acct), confidence: e.confidence })),
    probable: matching.probable.map((p) => ({
      bank: p.bank.map((m) => tx("b", m)),
      accounting: p.acct.map((m) => tx("a", m)),
      confidence: p.confidence,
      reason: p.reason,
    })),
    unmatchedBank: matching.unmatchedBank.map((m) => ({
      ...tx("b", m),
      category: narrative.unmatchedBank.get(m.id)?.category ?? "outro",
      observation: narrative.unmatchedBank.get(m.id)?.observation ?? "",
    })),
    unmatchedAccounting: matching.unmatchedAcct.map((m) => ({
      ...tx("a", m),
      category: narrative.unmatchedAccounting.get(m.id)?.category ?? "outro",
      observation: narrative.unmatchedAccounting.get(m.id)?.observation ?? "",
    })),
    difference: remainingCents == null ? null : fromCents(remainingCents),
    closes,
    summary: narrative.summary,
    nextSteps: narrative.nextSteps,
  };
}
