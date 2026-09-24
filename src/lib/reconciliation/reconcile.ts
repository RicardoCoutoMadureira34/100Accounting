import type { ModelClient } from "./anthropic";
import { detectHints } from "./hints";
import { matchMovements, type MTx } from "./matching";
import { writeNarrative, type UnmatchedCategory } from "./narrative";
import { fromCents, formatEuros, toCents } from "./verify";

// Passo 3: emparelhar as linhas já confirmadas de cada documento e escrever o
// relatório. Não sabe de onde vieram as linhas (PDF, Excel ou base de dados).

export interface ReconcileLine {
  // ordem no documento; serve de identificador (só tem de ser único e crescente)
  position: number;
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  cents: number; // valor com sinal, perspetiva da conta bancária
  origin: string | null;
}

export interface ReconcileInput {
  openingBalance: number | null;
  closingBalance: number | null;
  // a leitura passou nas verificações aritméticas
  verified: boolean;
  // avisos deste documento (leitura + verificação)
  issues: string[];
  lines: ReconcileLine[];
}

export interface ResultTx {
  date: string;
  description: string;
  amount: number; // perspetiva da conta bancária (+ entra, - sai)
  reference: string | null;
  origin: string | null;
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

export async function reconcileStatements(
  bank: ReconcileInput,
  acct: ReconcileInput,
  opts: { client?: ModelClient } = {}
): Promise<ReconciliationResult> {
  const issues: string[] = [...bank.issues, ...acct.issues];

  const toMTx = (l: ReconcileLine): MTx => ({
    id: l.position,
    date: l.date,
    description: l.description,
    reference: l.reference,
    cents: l.cents,
  });
  const originOf = new Map<string, string | null>();
  bank.lines.forEach((l) => originOf.set(`b${l.position}`, l.origin));
  acct.lines.forEach((l) => originOf.set(`a${l.position}`, l.origin));

  // 1) Emparelhamento determinístico.
  const matching = matchMovements(bank.lines.map(toMTx), acct.lines.map(toMTx));

  // 2) Saldos e "fecha".
  const bOpen = bank.openingBalance;
  const bClose = bank.closingBalance;
  const aOpen = acct.openingBalance;
  const aClose = acct.closingBalance;
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

  // 3) Indicações calculadas em código (duplicados, movimentos de meses
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
    origin: originOf.get(`${side}${m.id}`) ?? null,
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
