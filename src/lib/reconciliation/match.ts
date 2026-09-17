// Conciliação bancária: cruza os movimentos extraídos do extrato bancário
// com os da contabilidade e classifica cada um como correspondência exata,
// provável (para o contabilista confirmar), ou sem correspondência.

export interface ExtractedTx {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
}

export type MatchType = "exact" | "probable" | "unmatched_bank" | "unmatched_accounting";

export interface MatchResult {
  bankIndex: number | null;
  accountingIndex: number | null;
  matchType: MatchType;
  confidence: number | null; // 0-100, só para "probable"
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / 86_400_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pontuação de confiança (0-100) para um par candidato que não é match exato.
 * Combina proximidade de valor (60%) e proximidade de data (40%). Devolve
 * null se o par estiver claramente fora de alcance (não é sequer "provável").
 */
function candidateConfidence(bank: ExtractedTx, acct: ExtractedTx): number | null {
  const amountDiff = Math.abs(round2(bank.amount) - round2(acct.amount));
  const amountTolerance = Math.max(2, Math.abs(bank.amount) * 0.08);
  if (amountDiff > amountTolerance) return null;

  const dayDiff = daysBetween(bank.date, acct.date);
  if (dayDiff > 10) return null;

  const amountScore = Math.max(0, 100 - (amountDiff / amountTolerance) * 100);
  const dateScore = Math.max(0, 100 - dayDiff * 12);
  const confidence = amountScore * 0.6 + dateScore * 0.4;
  return Math.round(confidence * 100) / 100;
}

export function matchStatements(bankTx: ExtractedTx[], acctTx: ExtractedTx[]): MatchResult[] {
  const bankUsed = new Set<number>();
  const acctUsed = new Set<number>();
  const results: MatchResult[] = [];

  // 1) Correspondência exata: mesmo valor (ao cêntimo) e mesma data.
  for (let bi = 0; bi < bankTx.length; bi++) {
    for (let ai = 0; ai < acctTx.length; ai++) {
      if (acctUsed.has(ai)) continue;
      if (round2(bankTx[bi].amount) === round2(acctTx[ai].amount) && bankTx[bi].date === acctTx[ai].date) {
        results.push({ bankIndex: bi, accountingIndex: ai, matchType: "exact", confidence: 100 });
        bankUsed.add(bi);
        acctUsed.add(ai);
        break;
      }
    }
  }

  // 2) Correspondências prováveis: melhor par restante por confiança, guloso.
  const candidates: { bi: number; ai: number; confidence: number }[] = [];
  for (let bi = 0; bi < bankTx.length; bi++) {
    if (bankUsed.has(bi)) continue;
    for (let ai = 0; ai < acctTx.length; ai++) {
      if (acctUsed.has(ai)) continue;
      const confidence = candidateConfidence(bankTx[bi], acctTx[ai]);
      if (confidence != null) candidates.push({ bi, ai, confidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  for (const c of candidates) {
    if (bankUsed.has(c.bi) || acctUsed.has(c.ai)) continue;
    results.push({ bankIndex: c.bi, accountingIndex: c.ai, matchType: "probable", confidence: c.confidence });
    bankUsed.add(c.bi);
    acctUsed.add(c.ai);
  }

  // 3) Sobras: sem correspondência de cada lado.
  for (let bi = 0; bi < bankTx.length; bi++) {
    if (!bankUsed.has(bi)) results.push({ bankIndex: bi, accountingIndex: null, matchType: "unmatched_bank", confidence: null });
  }
  for (let ai = 0; ai < acctTx.length; ai++) {
    if (!acctUsed.has(ai)) results.push({ bankIndex: null, accountingIndex: ai, matchType: "unmatched_accounting", confidence: null });
  }

  return results;
}
