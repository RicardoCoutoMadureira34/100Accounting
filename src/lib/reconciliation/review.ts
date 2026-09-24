import type { StatementKind } from "./errors";
import { amountInCents, formatEuros, toCents, verifyStatement, type ReadLine, type StatementData, type Verification } from "./verify";

// Ecrã "Confirmar leitura": verifica as linhas guardadas SEM corrigir nada em
// silêncio e aponta a primeira linha onde o saldo corrido deixa de bater.

export interface ReviewDoc {
  openingBalance: number | null;
  closingBalance: number | null;
  totalDebits: number | null;
  totalCredits: number | null;
  openingRowDebits: number | null;
  openingRowCredits: number | null;
}

export interface ReviewLineInput {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balanceAfter: number | null;
}

export interface Review {
  count: number;
  ok: boolean;
  // false se o documento não tem saldos nem totais para comparar
  verifiable: boolean;
  // saldo final - (saldo inicial + soma), em cêntimos; null se não há como calcular
  differenceCents: number | null;
  failures: string[];
  // índice (na lista de linhas) da primeira linha em que o saldo indicado deixa de bater
  firstBadIndex: number | null;
  // saldo inicial + movimentos acumulados até cada linha (null sem saldo inicial)
  computedBalanceCents: (number | null)[];
  totalInCents: number;
  totalOutCents: number;
  amountCents: number[];
  hasBalanceColumn: boolean;
  // Resultado bruto da verificação (para compor avisos com unverifiedWarning).
  verification: Verification;
}

export function reviewStatement(kind: StatementKind, doc: ReviewDoc, lines: ReviewLineInput[]): Review {
  const readLines: ReadLine[] = lines.map((l) => ({
    date: l.date,
    description: l.description,
    reference: null,
    debit: l.debit,
    credit: l.credit,
    balanceAfter: l.balanceAfter,
    page: 0,
  }));
  const data: StatementData = {
    openingBalance: doc.openingBalance,
    closingBalance: doc.closingBalance,
    documentTotalDebits: doc.totalDebits,
    documentTotalCredits: doc.totalCredits,
    openingRowDebits: doc.openingRowDebits,
    openingRowCredits: doc.openingRowCredits,
    lines: readLines,
  };
  const v = verifyStatement(kind, data, { fixSigns: false });
  const amountCents = v.lines.map((l) => l.amountCents);

  // Saldo calculado = saldo inicial + soma acumulada. Sem saldo inicial tenta-se
  // deduzi-lo a partir da primeira linha que indica saldo.
  let base: number | null = doc.openingBalance == null ? null : toCents(doc.openingBalance);
  if (base == null) {
    let cumulative = 0;
    for (let i = 0; i < lines.length; i++) {
      cumulative += amountCents[i];
      const b = lines[i].balanceAfter;
      if (b != null) {
        base = toCents(b) - cumulative;
        break;
      }
    }
  }

  const computed: (number | null)[] = [];
  let running = base;
  let firstBad: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    running = running == null ? null : running + amountCents[i];
    computed.push(running);
    const b = lines[i].balanceAfter;
    if (firstBad == null && b != null && running != null && toCents(b) !== running) firstBad = i;
  }

  let totalIn = 0;
  let totalOut = 0;
  for (const c of amountCents) {
    if (c > 0) totalIn += c;
    else totalOut += -c;
  }

  return {
    count: lines.length,
    ok: v.ok && firstBad == null,
    verifiable: v.performedChecks > 0,
    differenceCents: v.equation ? toCents(v.equation.diff) : null,
    failures: v.failures,
    firstBadIndex: firstBad,
    computedBalanceCents: computed,
    totalInCents: totalIn,
    totalOutCents: totalOut,
    amountCents,
    hasBalanceColumn: lines.some((l) => l.balanceAfter != null),
    verification: v,
  };
}

// Frase para o indicador ⚠️.
export function describeProblem(review: Review): string {
  if (review.differenceCents != null && review.differenceCents !== 0) {
    return `A leitura não bate certo por ${formatEuros(Math.abs(review.differenceCents))}`;
  }
  if (!review.verifiable) {
    return "Não foi possível confirmar a leitura automaticamente. Confere os movimentos.";
  }
  return `A leitura não bate certo (${review.failures[0] ?? "o saldo linha a linha falha"})`;
}

// Entrada/saída (perspetiva da conta bancária) -> colunas Débito/Crédito do documento.
export function columnsFromInOut(
  kind: StatementKind,
  entrada: number | null,
  saida: number | null
): { debit: number | null; credit: number | null; amountCents: number } {
  const inn = entrada == null ? null : Math.abs(entrada);
  const out = saida == null ? null : Math.abs(saida);
  const debit = kind === "bank" ? out : inn;
  const credit = kind === "bank" ? inn : out;
  return { debit, credit, amountCents: amountInCents(kind, debit, credit) };
}

// ---------- passo 2 automático ----------
// O passo 2 só aparece quando é preciso o utilizador olhar para os dados.

export type StepTwoReason = "mismatch" | "unverifiable" | "conversion" | "empty";

export interface StepTwoDecision {
  skip: boolean;
  reason: StepTwoReason | null;
}

export function decideStepTwo(args: {
  format: "pdf" | "xlsx" | "csv";
  review: Review;
  conversionProblems: number;
  lineCount: number;
}): StepTwoDecision {
  const { format, review, conversionProblems, lineCount } = args;
  if (lineCount === 0) return { skip: false, reason: "empty" };
  if (conversionProblems > 0) return { skip: false, reason: "conversion" };
  // Saldos que não batem (ou linha a linha que falha): o utilizador tem de ver.
  if (review.verifiable && !review.ok) return { skip: false, reason: "mismatch" };
  if (!review.verifiable) {
    // Sem saldos para verificar: numa folha a conversão é feita pelo código e
    // basta não ter falhado; num PDF a leitura é do modelo, por isso confere-se.
    return format === "pdf" ? { skip: false, reason: "unverifiable" } : { skip: true, reason: null };
  }
  return { skip: true, reason: null };
}
