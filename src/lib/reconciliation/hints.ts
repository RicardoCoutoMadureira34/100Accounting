import { DUPLICATE_DATE_WINDOW_DAYS, DUPLICATE_MIN_SIMILARITY, PRIOR_PERIOD_MAX_GROUP } from "./config";
import { dayDistance, descriptionsAlike, type MatchingResult, type MTx } from "./matching";
import { formatEuros } from "./verify";

// Indicações calculadas em código (nunca pelo modelo) sobre os movimentos sem
// correspondência. São passadas ao modelo como obrigatórias e o texto (e a
// categoria, no caso dos duplicados) é imposto no resultado final.

export interface Hint {
  kind: "duplicate" | "prior_period";
  // null = manter a categoria escolhida pelo modelo.
  category: "duplicado" | null;
  observation: string;
}

export interface Hints {
  bank: Map<number, Hint>;
  acct: Map<number, Hint>;
}

const money = (cents: number) => formatEuros(Math.abs(cents));

function reconciledSide(matching: MatchingResult, side: "bank" | "acct"): MTx[] {
  return [
    ...matching.exact.map((e) => e[side]),
    ...matching.probable.flatMap((p) => p[side]),
  ];
}

// 1) Duplicados: sem correspondência, mas igual (valor, data ±3 dias,
// descrição) a outro movimento DO MESMO LADO que já foi reconciliado.
function isDuplicateOf(u: MTx, reconciled: MTx[]): boolean {
  return reconciled.some(
    (m) =>
      m.id !== u.id &&
      m.cents === u.cents &&
      dayDistance(m.date, u.date) <= DUPLICATE_DATE_WINDOW_DAYS &&
      descriptionsAlike(m, u, DUPLICATE_MIN_SIMILARITY)
  );
}

// 2) Movimentos de meses anteriores: um movimento (ou um conjunto de até 3)
// sem correspondência cuja soma explica, ao cêntimo, a diferença de saldos
// iniciais.
function findSubsetSummingTo(items: MTx[], target: number): MTx[] | null {
  const sorted = [...items].sort((a, b) => a.id - b.id);
  const maxSize = sorted.length > 80 ? Math.min(2, PRIOR_PERIOD_MAX_GROUP) : PRIOR_PERIOD_MAX_GROUP;
  const chosen: MTx[] = [];
  const search = (start: number, size: number, sum: number): boolean => {
    if (chosen.length === size) return sum === target;
    for (let i = start; i < sorted.length; i++) {
      chosen.push(sorted[i]);
      if (search(i + 1, size, sum + sorted[i].cents)) return true;
      chosen.pop();
    }
    return false;
  };
  for (let size = 1; size <= maxSize; size++) {
    chosen.length = 0;
    if (search(0, size, 0)) return [...chosen];
  }
  return null;
}

export function detectHints(args: {
  matching: MatchingResult;
  bankOpening: number | null;
  acctOpening: number | null;
}): Hints {
  const { matching } = args;
  const hints: Hints = { bank: new Map(), acct: new Map() };

  const reconciledBank = reconciledSide(matching, "bank");
  const reconciledAcct = reconciledSide(matching, "acct");

  for (const u of matching.unmatchedBank) {
    if (isDuplicateOf(u, reconciledBank)) {
      hints.bank.set(u.id, {
        kind: "duplicate",
        category: "duplicado",
        observation: `Possível movimento em duplicado de ${u.description} de ${money(u.cents)}. A contabilidade só tem um lançamento; verificar com o banco se o movimento foi cobrado duas vezes.`,
      });
    }
  }
  for (const u of matching.unmatchedAcct) {
    if (isDuplicateOf(u, reconciledAcct)) {
      hints.acct.set(u.id, {
        kind: "duplicate",
        category: "duplicado",
        observation: `Possível lançamento em duplicado de ${u.description} de ${money(u.cents)}. O banco só tem um movimento; verificar e anular o lançamento repetido.`,
      });
    }
  }

  if (args.bankOpening != null && args.acctOpening != null) {
    const openingDiff = Math.round(args.bankOpening * 100) - Math.round(args.acctOpening * 100);
    if (openingDiff !== 0) {
      const x = money(openingDiff);
      const describe = (t: MTx) => `${t.description} de ${money(t.cents)}`;

      // Só no banco: já lançado na contabilidade antes, só agora no banco.
      const bankCandidates = matching.unmatchedBank.filter((u) => !hints.bank.has(u.id));
      const bankSet = findSubsetSummingTo(bankCandidates, -openingDiff);
      if (bankSet) {
        for (const m of bankSet) {
          const others = bankSet.filter((o) => o.id !== m.id);
          hints.bank.set(m.id, {
            kind: "prior_period",
            category: null,
            observation:
              others.length === 0
                ? `Movimento já lançado na contabilidade num mês anterior e só agora apareceu no banco. Explica a diferença de saldos iniciais de ${x}. Não é preciso lançar de novo.`
                : `Movimento já lançado na contabilidade num mês anterior e só agora apareceu no banco. Em conjunto com ${others.map(describe).join(" e ")} explica a diferença de saldos iniciais de ${x}. Não é preciso lançar de novo.`,
          });
        }
      }

      // Só na contabilidade: já no banco antes, só agora lançado.
      const acctCandidates = matching.unmatchedAcct.filter((u) => !hints.acct.has(u.id));
      const acctSet = findSubsetSummingTo(acctCandidates, openingDiff);
      if (acctSet) {
        for (const m of acctSet) {
          const others = acctSet.filter((o) => o.id !== m.id);
          hints.acct.set(m.id, {
            kind: "prior_period",
            category: null,
            observation:
              others.length === 0
                ? `Movimento já registado no banco num mês anterior e só agora lançado na contabilidade. Explica a diferença de saldos iniciais de ${x}. Não é preciso lançar de novo.`
                : `Movimento já registado no banco num mês anterior e só agora lançado na contabilidade. Em conjunto com ${others.map(describe).join(" e ")} explica a diferença de saldos iniciais de ${x}. Não é preciso lançar de novo.`,
          });
        }
      }
    }
  }

  return hints;
}
