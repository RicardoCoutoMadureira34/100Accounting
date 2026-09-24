import { KIND_LABEL, type StatementKind } from "./errors";

// Tudo aqui é aritmética em cêntimos (inteiros): a IA só lê, nunca decide
// sinais nem faz contas.

export interface ReadLine {
  date: string;
  description: string;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  balanceAfter: number | null;
  page: number;
  // Página (p2) ou linha da folha (L15) de onde veio o movimento.
  origin?: string;
}

export interface StatementData {
  openingBalance: number | null;
  closingBalance: number | null;
  documentTotalDebits: number | null;
  documentTotalCredits: number | null;
  // Alguns razões mostram, na própria linha de "Saldo inicial", os débitos e
  // créditos acumulados até ao período; o "Total" do documento inclui-os.
  openingRowDebits?: number | null;
  openingRowCredits?: number | null;
  lines: ReadLine[];
}

export interface SignedLine extends ReadLine {
  index: number;
  // Perspetiva da conta bancária: positivo entra, negativo sai (em cêntimos).
  amountCents: number;
}

export interface Verification {
  lines: SignedLine[];
  performedChecks: number;
  ok: boolean;
  failures: string[];
  corrections: string[];
  // Equação saldo inicial + soma = saldo final (em euros), quando verificável.
  equation: { computed: number; closing: number; diff: number } | null;
}

export const toCents = (n: number): number => Math.round(n * 100);
export const fromCents = (c: number): number => c / 100;

export function formatEuros(cents: number): string {
  return `${(cents / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Extrato bancário: entra = crédito, sai = débito.
// Extrato contabilístico (conta 12): entra = débito, sai = crédito.
export function amountInCents(kind: StatementKind, debit: number | null, credit: number | null): number {
  const d = debit == null ? 0 : toCents(Math.abs(debit));
  const c = credit == null ? 0 : toCents(Math.abs(credit));
  return kind === "bank" ? c - d : d - c;
}

// fixSigns: corrige o sinal de um movimento quando contradiz a variação do
// saldo (só na leitura). No ecrã de confirmação não se corrige nada em silêncio,
// porque o utilizador pode ter editado os valores.
export function verifyStatement(
  kind: StatementKind,
  data: StatementData,
  options: { fixSigns?: boolean } = {}
): Verification {
  const fixSigns = options.fixSigns ?? true;
  const lines: SignedLine[] = data.lines.map((l, index) => ({
    ...l,
    index,
    amountCents: amountInCents(kind, l.debit, l.credit),
  }));
  const failures: string[] = [];
  const corrections: string[] = [];

  // 1) Saldo linha a linha (só quando o documento tem a coluna de saldo).
  let prev: number | null = data.openingBalance == null ? null : toCents(data.openingBalance);
  let runningChecked = false;
  let runningMismatches = 0;
  let firstMismatch: string | null = null;
  for (const line of lines) {
    if (line.balanceAfter != null) {
      const balance = toCents(line.balanceAfter);
      if (prev != null) {
        runningChecked = true;
        const delta = balance - prev;
        if (delta !== line.amountCents) {
          if (fixSigns && line.amountCents !== 0 && delta === -line.amountCents) {
            const oldDebit = line.debit;
            line.debit = line.credit;
            line.credit = oldDebit;
            line.amountCents = -line.amountCents;
            corrections.push(
              `Sinal corrigido no movimento de ${line.date} "${line.description}" (${formatEuros(Math.abs(line.amountCents))}): contradizia a variação do saldo.`
            );
          } else {
            runningMismatches++;
            firstMismatch ??= `${line.date} "${line.description}": o saldo varia ${formatEuros(delta)} mas o movimento é ${formatEuros(line.amountCents)}`;
          }
        }
      }
      prev = balance;
    } else if (prev != null) {
      prev += line.amountCents;
    }
  }

  let performed = 0;

  // 2) Saldo inicial + soma dos movimentos = saldo final.
  let equation: Verification["equation"] = null;
  const sum = lines.reduce((s, l) => s + l.amountCents, 0);
  if (data.openingBalance != null && data.closingBalance != null) {
    performed++;
    const computed = toCents(data.openingBalance) + sum;
    const closing = toCents(data.closingBalance);
    const diff = closing - computed;
    equation = { computed: fromCents(computed), closing: fromCents(closing), diff: fromCents(diff) };
    if (diff !== 0) {
      failures.push(
        `a soma dá ${formatEuros(computed)}, o saldo final é ${formatEuros(closing)} (${diff > 0 ? "faltam" : "sobram"} ${formatEuros(Math.abs(diff))})`
      );
    }
  }

  // 3) Totais de débitos/créditos que o próprio documento mostra.
  const sumDebits = lines.reduce((s, l) => s + (l.debit == null ? 0 : toCents(Math.abs(l.debit))), 0);
  const sumCredits = lines.reduce((s, l) => s + (l.credit == null ? 0 : toCents(Math.abs(l.credit))), 0);
  if (data.documentTotalDebits != null) {
    performed++;
    const expected = sumDebits + toCents(Math.abs(data.openingRowDebits ?? 0));
    const shown = toCents(data.documentTotalDebits);
    if (shown !== expected) {
      failures.push(`os débitos somam ${formatEuros(expected)} mas o documento indica ${formatEuros(shown)}`);
    }
  }
  if (data.documentTotalCredits != null) {
    performed++;
    const expected = sumCredits + toCents(Math.abs(data.openingRowCredits ?? 0));
    const shown = toCents(data.documentTotalCredits);
    if (shown !== expected) {
      failures.push(`os créditos somam ${formatEuros(expected)} mas o documento indica ${formatEuros(shown)}`);
    }
  }

  if (runningChecked) {
    performed++;
    if (runningMismatches > 0) {
      failures.push(
        `o saldo linha a linha não bate certo em ${runningMismatches} movimento(s) (ex.: ${firstMismatch})`
      );
    }
  }

  return { lines, performedChecks: performed, ok: performed > 0 && failures.length === 0, failures, corrections, equation };
}

// Aviso para o utilizador quando a leitura continua sem bater certo.
export function unverifiedWarning(kind: StatementKind, v: Verification): string {
  const label = KIND_LABEL[kind];
  if (v.performedChecks === 0) {
    return `Não foi possível verificar a leitura do ${label}: o documento não indica saldos nem totais. Confirma os movimentos.`;
  }
  if (v.equation && v.equation.diff !== 0) {
    const d = v.equation.diff;
    return `A leitura do ${label} não foi verificada: a soma dá ${formatEuros(toCents(v.equation.computed))}, o saldo final é ${formatEuros(toCents(v.equation.closing))} (${d > 0 ? "faltam" : "sobram"} ${formatEuros(Math.abs(toCents(d)))}). Confirma os movimentos deste extrato.`;
  }
  return `A leitura do ${label} não foi verificada: ${v.failures.join("; ")}. Confirma os movimentos deste extrato.`;
}

// Quanto falha a leitura (para escolher a melhor entre tentativas).
export function verificationGap(v: Verification): number {
  if (v.equation) return Math.abs(v.equation.diff);
  return v.failures.length;
}
