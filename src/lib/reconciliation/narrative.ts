import { z } from "zod";
import { callStructured, type ModelClient } from "./anthropic";
import type { Hint, Hints } from "./hints";
import type { MTx, ProbableMatch } from "./matching";
import { formatEuros } from "./verify";

// Categorias fechadas para movimentos sem correspondência (ver CATEGORY_LABELS
// em results-view.tsx). Qualquer valor desconhecido passa a "outro".
export const UNMATCHED_CATEGORIES = [
  "cheque_em_transito",
  "deposito_em_transito",
  "debito_nao_registado",
  "comissao_juro_bancario",
  "erro_transcricao",
  "duplicado",
  "outro",
] as const;
export type UnmatchedCategory = (typeof UNMATCHED_CATEGORIES)[number];

export function normalizeCategory(value: string | undefined): UnmatchedCategory {
  return (UNMATCHED_CATEGORIES as readonly string[]).includes(value ?? "") ? (value as UnmatchedCategory) : "outro";
}

const NarrativeSchema = z.object({
  unmatchedBank: z.array(z.object({ id: z.number(), category: z.string(), observation: z.string() })),
  unmatchedAccounting: z.array(z.object({ id: z.number(), category: z.string(), observation: z.string() })),
  summary: z.string().describe("Resumo executivo de 2 a 4 frases"),
  nextSteps: z.array(z.string()).describe("Passos recomendados por ordem de prioridade"),
});

const NARRATIVE_SYSTEM_PROMPT = `És um contabilista sénior a explicar o resultado de uma reconciliação bancária a um colega. Já recebes tudo calculado: NÃO refaças contas nem emparelhamentos, usa exatamente os valores fornecidos.

Faz o seguinte, em português de Portugal, num tom profissional, claro e direto, sem jargão desnecessário:
1. Para cada movimento sem correspondência (lista "unmatchedBank" e "unmatchedAccounting", identificados pelo campo id) devolve uma categoria fixa e uma observação curta com a causa mais provável. Categorias: cheque_em_transito (cheque emitido ainda não compensado), deposito_em_transito (depósito ou transferência a caminho, ainda não visível no outro extrato), debito_nao_registado (débito ou pagamento que o banco processou e a contabilidade ainda não lançou), comissao_juro_bancario (comissão, imposto de selo ou juro bancário por lançar), erro_transcricao (valor ou data registados de forma diferente), duplicado (movimento que parece lançado mais de uma vez), outro (nenhuma das anteriores). Usa "outro" só quando nenhuma se aplicar. Devolve um item por cada id recebido.
2. Escreve um resumo executivo de 2 a 4 frases: saldos, diferença do período, se a reconciliação fecha e o que falta resolver.
3. Lista os próximos passos por ordem de prioridade (3 a 6 itens).

REGRAS OBRIGATÓRIAS para o resumo e os próximos passos
- Nunca menciones identificadores internos. O campo "id" serve só para associares a categoria e a observação ao movimento certo. No resumo e nos próximos passos identifica cada movimento pela data, pela descrição e pelo valor.
- Não digas que o saldo ou a diferença é zero, nem que está tudo contabilizado, reconciliado ou resolvido, quando houver movimentos sem correspondência ou pares prováveis por confirmar (ver pending). Diz antes quantos movimentos e pares ficam por resolver.
- "closes" refere-se só ao período (aos movimentos), não aos saldos finais. Os saldos finais só ficam iguais se os saldos iniciais forem iguais. Se openingBalancesDiffer for true, refere a diferença dos saldos iniciais (openingDifference) e nunca digas que o banco e a contabilidade vão ficar com o mesmo saldo final: explica que essa diferença vem de meses anteriores e que os saldos finais continuam a diferir por esse valor, mesmo que o período feche.

- Alguns movimentos sem correspondência trazem o campo "mandatory", calculado a partir dos dados e OBRIGATÓRIO: usa exatamente a observação indicada (e a categoria, quando indicada; sem categoria indicada escolhe a mais adequada) e respeita-o no resumo e nos próximos passos. Se kind for "duplicate", trata o movimento como um possível duplicado a verificar e anular, nunca como pendente ou por compensar. Se kind for "prior_period", trata-o como um movimento de um mês anterior que explica a diferença de saldos iniciais e que não é preciso lançar de novo, nunca como um erro nem como algo por lançar.
- Um movimento que consta do extrato bancário já foi processado pelo banco: nunca digas que não foi compensado, que está em trânsito ou que ainda não saiu do banco. Do mesmo modo, um movimento que consta da contabilidade já está lançado: não digas que falta lançá-lo.

Não uses travessões nas frases. Não inventes movimentos nem valores.`;

export interface NarrativeInput {
  unmatchedBank: MTx[];
  unmatchedAcct: MTx[];
  probable: ProbableMatch[];
  exactCount: number;
  bankOpening: number | null;
  bankClosing: number | null;
  acctOpening: number | null;
  acctClosing: number | null;
  periodDiffCents: number | null;
  explainedCents: number;
  differenceCents: number | null;
  closes: boolean;
  warnings: string[];
  hints?: Hints;
}

export interface Narrative {
  unmatchedBank: Map<number, { category: UnmatchedCategory; observation: string }>;
  unmatchedAccounting: Map<number, { category: UnmatchedCategory; observation: string }>;
  summary: string;
  nextSteps: string[];
}

const euro = (n: number | null) => (n == null ? "desconhecido" : formatEuros(Math.round(n * 100)));
const euroC = (c: number | null) => (c == null ? "desconhecido" : formatEuros(c));

const openingDiffCents = (i: NarrativeInput): number | null =>
  i.bankOpening == null || i.acctOpening == null ? null : Math.round(i.bankOpening * 100) - Math.round(i.acctOpening * 100);
const openingDiffers = (i: NarrativeInput): boolean => {
  const d = openingDiffCents(i);
  return d != null && d !== 0;
};

function fallbackNarrative(input: NarrativeInput): Narrative {
  const pending = input.unmatchedBank.length + input.unmatchedAcct.length;
  const summary =
    `Saldo final do banco ${euro(input.bankClosing)} e da contabilidade ${euro(input.acctClosing)}. ` +
    `Foram reconciliados ${input.exactCount} movimentos, ${input.probable.length} pares aguardam confirmação e ${pending} movimentos ficaram sem correspondência. ` +
    (input.closes
      ? "As diferenças do período ficam explicadas pelos movimentos por reconciliar."
      : `A reconciliação não fecha: falta explicar ${euroC(input.differenceCents)}.`) +
    (openingDiffers(input)
      ? ` Os saldos iniciais diferem ${euroC(Math.abs(openingDiffCents(input) ?? 0))} (vem de meses anteriores), por isso os saldos finais continuam a diferir.`
      : "");
  const duplicates = [...(input.hints?.bank.values() ?? []), ...(input.hints?.acct.values() ?? [])].filter((h) => h.kind === "duplicate").length;
  const priorPeriod = [...(input.hints?.bank.values() ?? []), ...(input.hints?.acct.values() ?? [])].filter((h) => h.kind === "prior_period").length;
  const extra =
    (duplicates > 0 ? ` ${duplicates} movimento(s) parecem lançados em duplicado e devem ser verificados.` : "") +
    (priorPeriod > 0 ? ` ${priorPeriod} movimento(s) vêm de um mês anterior e explicam a diferença de saldos iniciais.` : "");
  const nextSteps = [
    "Rever os movimentos sem correspondência nos dois extratos.",
    "Confirmar ou rejeitar os pares prováveis.",
    ...(input.closes ? [] : ["Verificar os saldos iniciais e se todos os movimentos de ambos os extratos foram lidos."]),
  ];
  return { unmatchedBank: new Map(), unmatchedAccounting: new Map(), summary: summary + extra, nextSteps };
}

// As indicações calculadas em código prevalecem sobre o que o modelo escrever:
// o texto é sempre o das indicações e, nos duplicados, a categoria também.
function applyHints(narrative: Narrative, input: NarrativeInput): Narrative {
  const hints = input.hints;
  if (!hints) return narrative;
  const merge = (
    target: Narrative["unmatchedBank"],
    side: Map<number, Hint>
  ) => {
    for (const [id, hint] of side) {
      const current = target.get(id);
      target.set(id, {
        category: hint.category ?? current?.category ?? "outro",
        observation: hint.observation,
      });
    }
  };
  merge(narrative.unmatchedBank, hints.bank);
  merge(narrative.unmatchedAccounting, hints.acct);
  return narrative;
}

// Pequena chamada só com as listas já calculadas (sem os PDFs). Se falhar,
// a reconciliação é gravada na mesma, com categoria "outro".
export async function writeNarrative(input: NarrativeInput, opts: { client?: ModelClient } = {}): Promise<Narrative> {
  const fallback = fallbackNarrative(input);
  // Só os movimentos sem correspondência levam "id" (para associar a categoria);
  // nos pares prováveis não há ids, para o modelo não os repetir no texto.
  const hints = input.hints ?? { bank: new Map(), acct: new Map() };
  const withHint = (side: "bank" | "acct") => (t: MTx) => {
    const h = hints[side].get(t.id);
    return {
      id: t.id,
      date: t.date,
      description: t.description,
      amount: euroC(t.cents),
      ...(h ? { mandatory: { kind: h.kind, category: h.category, observation: h.observation } } : {}),
    };
  };
  const txNoId = (t: MTx) => ({ date: t.date, description: t.description, amount: euroC(t.cents) });
  const openingDiff = openingDiffCents(input);
  const finalDiff =
    input.bankClosing == null || input.acctClosing == null
      ? null
      : Math.round(input.bankClosing * 100) - Math.round(input.acctClosing * 100);
  const payload = {
    balances: {
      bankOpening: euro(input.bankOpening),
      bankClosing: euro(input.bankClosing),
      accountingOpening: euro(input.acctOpening),
      accountingClosing: euro(input.acctClosing),
    },
    periodDifference: euroC(input.periodDiffCents),
    explainedByPendingMovements: euroC(input.explainedCents),
    remainingDifference: euroC(input.differenceCents),
    closes: input.closes,
    openingBalancesDiffer: openingDiffers(input),
    openingDifference: euroC(openingDiff == null ? null : Math.abs(openingDiff)),
    higherOpeningBalanceIn: openingDiff == null || openingDiff === 0 ? null : openingDiff > 0 ? "banco" : "contabilidade",
    finalBalancesDifference: euroC(finalDiff),
    pending: {
      unmatchedBank: input.unmatchedBank.length,
      unmatchedAccounting: input.unmatchedAcct.length,
      probablePairs: input.probable.length,
    },
    matchedExactCount: input.exactCount,
    probablePairs: input.probable.map((p) => ({
      bank: p.bank.map(txNoId),
      accounting: p.acct.map(txNoId),
      confidence: p.confidence,
      reason: p.reason,
    })),
    unmatchedBank: input.unmatchedBank.map(withHint("bank")),
    unmatchedAccounting: input.unmatchedAcct.map(withHint("acct")),
    warnings: input.warnings,
  };

  try {
    const out = await callStructured({
      client: opts.client,
      label: "narrative",
      system: NARRATIVE_SYSTEM_PROMPT,
      content: [{ type: "text", text: JSON.stringify(payload, null, 1) }],
      schema: NarrativeSchema,
      maxTokens: 16000,
    });
    const toMap = (rows: { id: number; category: string; observation: string }[]) =>
      new Map(rows.map((r) => [r.id, { category: normalizeCategory(r.category), observation: r.observation }]));
    return applyHints(
      {
        unmatchedBank: toMap(out.unmatchedBank),
        unmatchedAccounting: toMap(out.unmatchedAccounting),
        summary: out.summary.trim() || fallback.summary,
        nextSteps: out.nextSteps.length > 0 ? out.nextSteps : fallback.nextSteps,
      },
      input
    );
  } catch (e) {
    console.error("[reconciliation] texto do relatório falhou, a usar o valor por omissão:", e);
    return applyHints(fallback, input);
  }
}
