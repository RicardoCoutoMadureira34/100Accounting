import {
  DATE_TOLERANCE_DAYS,
  MAX_GROUP_CANDIDATES,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  MONTH_END_MIN_LINES,
  MONTH_END_MIN_SHARE,
  NEAR_DATE_WINDOW_DAYS,
  NEAR_VALUE_CENTS,
} from "./config";
import { formatEuros } from "./verify";

// Emparelhamento 100% determinístico: mesmas entradas, mesmas saídas. Cada
// movimento é usado no máximo uma vez. Valores em cêntimos, perspetiva da
// conta bancária (positivo entra, negativo sai).

export interface MTx {
  id: number; // posição no documento (ordem de leitura)
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  cents: number;
}

export interface ExactMatch {
  bank: MTx;
  acct: MTx;
  confidence: number;
}

export interface ProbableMatch {
  bank: MTx[];
  acct: MTx[];
  confidence: number;
  reason: string;
  kind: "date" | "group" | "near" | "transposed";
}

export interface MatchingResult {
  exact: ExactMatch[];
  probable: ProbableMatch[];
  unmatchedBank: MTx[];
  unmatchedAcct: MTx[];
}

// ---------- datas ----------

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

export function dayNumber(date: string): number {
  const [y, m, d] = parts(date);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function dayDistance(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

export function isLastDayOfMonth(date: string): boolean {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}

function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

// ---------- semelhança de descrições ----------

function tokens(text: string): Set<string> {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(normalized.split(" ").filter((t) => t.length >= 3));
}

export function descriptionSimilarity(a: MTx, b: MTx): number {
  if (a.reference && b.reference && a.reference.trim() === b.reference.trim()) return 1;
  const ta = tokens(a.description);
  const tb = tokens(b.description);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

function normalizedText(text: string): string {
  return [...tokens(text)].join(" ");
}

// Descrições iguais ou muito semelhantes (para detetar duplicados).
export function descriptionsAlike(a: MTx, b: MTx, minSimilarity: number): boolean {
  const na = a.description.trim().toLowerCase();
  const nb = b.description.trim().toLowerCase();
  if (na === nb) return true;
  const ta = normalizedText(a.description);
  const tb = normalizedText(b.description);
  if (ta !== "" && ta === tb) return true;
  return descriptionSimilarity(a, b) >= minSimilarity;
}

// ---------- confiança (0 a 100) ----------

export type ValueKind = "exact" | "group" | "near" | "transposed";

export function confidenceScore(kind: ValueKind, dayDist: number, similarity: number, monthEndAccepted: boolean): number {
  const base = { exact: 70, group: 55, transposed: 50, near: 45 }[kind];
  const date = monthEndAccepted ? 15 : Math.max(0, 20 * (1 - dayDist / 30));
  const desc = 10 * Math.max(0, Math.min(1, similarity));
  return Math.max(0, Math.min(100, Math.round(base + date + desc)));
}

// A contabilidade "usa data de fim de mês" quando a maioria dos lançamentos
// está datada no último dia do mês.
export function usesMonthEndDates(acct: MTx[]): boolean {
  if (acct.length < MONTH_END_MIN_LINES) return false;
  const atEnd = acct.filter((a) => isLastDayOfMonth(a.date)).length;
  return atEnd / acct.length >= MONTH_END_MIN_SHARE;
}

// ---------- algoritmo ----------

const NODE_BUDGET = 400_000;

function byId(a: MTx, b: MTx): number {
  return a.id - b.id;
}

function isTransposition(a: number, b: number): boolean {
  const x = String(Math.abs(a));
  const y = String(Math.abs(b));
  if (x.length !== y.length || x === y) return false;
  const diff: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff.push(i);
  return diff.length === 2 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]];
}

export function matchMovements(bankIn: MTx[], acctIn: MTx[]): MatchingResult {
  const bank = [...bankIn].sort(byId);
  const acct = [...acctIn].sort(byId);
  const monthEnd = usesMonthEndDates(acct);
  const usedBank = new Set<number>();
  const usedAcct = new Set<number>();
  const exact: ExactMatch[] = [];
  const probable: ProbableMatch[] = [];

  // 1) Mesmo valor e sinal: o valor é o critério principal. Com vários do
  // mesmo valor emparelha-se pela ordem em que aparecem em cada documento.
  const queues = new Map<number, MTx[]>();
  for (const a of acct) {
    const q = queues.get(a.cents);
    if (q) q.push(a);
    else queues.set(a.cents, [a]);
  }
  for (const b of bank) {
    const a = queues.get(b.cents)?.shift();
    if (!a) continue;
    usedBank.add(b.id);
    usedAcct.add(a.id);
    const dist = dayDistance(b.date, a.date);
    const monthEndAccepted = monthEnd && isLastDayOfMonth(a.date) && sameMonth(a.date, b.date);
    const sim = descriptionSimilarity(b, a);
    const confidence = confidenceScore("exact", dist, sim, monthEndAccepted && dist > DATE_TOLERANCE_DAYS);
    if (dist <= DATE_TOLERANCE_DAYS || monthEndAccepted) {
      exact.push({ bank: b, acct: a, confidence });
    } else {
      probable.push({
        bank: [b],
        acct: [a],
        confidence,
        kind: "date",
        reason: `Mesmo valor (${formatEuros(Math.abs(b.cents))}) mas as datas distam ${dist} dias (${b.date} no banco, ${a.date} na contabilidade).`,
      });
    }
  }

  // 2) Um-para-vários sobre o que sobrou (nos dois sentidos).
  const restBank = () => bank.filter((b) => !usedBank.has(b.id));
  const restAcct = () => acct.filter((a) => !usedAcct.has(a.id));

  const findGroups = (targets: MTx[], pool: () => MTx[], targetIsAcct: boolean) => {
    for (const target of targets) {
      const used = targetIsAcct ? usedAcct : usedBank;
      if (used.has(target.id) || target.cents === 0) continue;
      const poolUsed = targetIsAcct ? usedBank : usedAcct;
      const candidates = pool().filter(
        (c) =>
          !poolUsed.has(c.id) &&
          c.cents !== 0 &&
          Math.sign(c.cents) === Math.sign(target.cents) &&
          Math.abs(c.cents) < Math.abs(target.cents)
      );
      if (candidates.length < MIN_GROUP_SIZE) continue;
      const group = bestSubset(target, candidates);
      if (!group) continue;

      used.add(target.id);
      for (const g of group) poolUsed.add(g.id);
      const avgDist = group.reduce((s, g) => s + dayDistance(g.date, target.date), 0) / group.length;
      const avgSim = group.reduce((s, g) => s + descriptionSimilarity(g, target), 0) / group.length;
      const monthEndAccepted = targetIsAcct && monthEnd && isLastDayOfMonth(target.date);
      const amounts = group.map((g) => formatEuros(Math.abs(g.cents))).join(" + ");
      const reason = targetIsAcct
        ? `Lançamento de ${formatEuros(Math.abs(target.cents))} na contabilidade igual à soma de ${group.length} movimentos do banco (${amounts}).`
        : `Movimento de ${formatEuros(Math.abs(target.cents))} no banco igual à soma de ${group.length} lançamentos da contabilidade (${amounts}).`;
      probable.push({
        bank: targetIsAcct ? group : [target],
        acct: targetIsAcct ? [target] : group,
        confidence: confidenceScore("group", avgDist, avgSim, monthEndAccepted),
        kind: "group",
        reason,
      });
    }
  };
  findGroups(restAcct(), restBank, true);
  findGroups(restBank(), restAcct, false);

  // 3) Valor quase igual (até 1 €) ou dígitos trocados.
  type Pair = { b: MTx; a: MTx; kind: "near" | "transposed"; confidence: number; reason: string };
  const pairs: Pair[] = [];
  for (const b of restBank()) {
    for (const a of restAcct()) {
      if (b.cents === 0 || a.cents === 0 || Math.sign(b.cents) !== Math.sign(a.cents)) continue;
      const diff = Math.abs(b.cents - a.cents);
      if (diff === 0) continue;
      const kind = diff <= NEAR_VALUE_CENTS ? "near" : isTransposition(b.cents, a.cents) ? "transposed" : null;
      if (!kind) continue;
      const dist = dayDistance(b.date, a.date);
      const monthEndAccepted = monthEnd && isLastDayOfMonth(a.date) && sameMonth(a.date, b.date);
      if (dist > NEAR_DATE_WINDOW_DAYS && !monthEndAccepted) continue;
      const sim = descriptionSimilarity(b, a);
      pairs.push({
        b,
        a,
        kind,
        confidence: confidenceScore(kind, dist, sim, monthEndAccepted),
        reason:
          kind === "near"
            ? `Valor quase igual: ${formatEuros(Math.abs(b.cents))} no banco e ${formatEuros(Math.abs(a.cents))} na contabilidade (diferença de ${formatEuros(diff)}).`
            : `Possível erro de digitação (dígitos trocados): ${formatEuros(Math.abs(b.cents))} no banco e ${formatEuros(Math.abs(a.cents))} na contabilidade.`,
      });
    }
  }
  pairs.sort((x, y) => y.confidence - x.confidence || x.b.id - y.b.id || x.a.id - y.a.id);
  for (const p of pairs) {
    if (usedBank.has(p.b.id) || usedAcct.has(p.a.id)) continue;
    usedBank.add(p.b.id);
    usedAcct.add(p.a.id);
    probable.push({ bank: [p.b], acct: [p.a], confidence: p.confidence, kind: p.kind, reason: p.reason });
  }

  exact.sort((x, y) => x.bank.id - y.bank.id);
  probable.sort((x, y) => Math.min(...x.bank.map((t) => t.id)) - Math.min(...y.bank.map((t) => t.id)));
  return { exact, probable, unmatchedBank: restBank(), unmatchedAcct: restAcct() };
}

// Melhor subconjunto (2 a 5 movimentos) cuja soma é exatamente o valor do
// alvo. Entre soluções, prefere descrições semelhantes, depois datas próximas.
function bestSubset(target: MTx, all: MTx[]): MTx[] | null {
  const goal = Math.abs(target.cents);
  const ranked = [...all]
    .map((c) => ({ c, sim: descriptionSimilarity(c, target), dist: dayDistance(c.date, target.date) }))
    .sort((x, y) => y.sim - x.sim || x.dist - y.dist || x.c.id - y.c.id)
    .slice(0, MAX_GROUP_CANDIDATES)
    .map((r) => r.c)
    .sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents) || x.id - y.id);

  const suffix = new Array<number>(ranked.length + 1).fill(0);
  for (let i = ranked.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + Math.abs(ranked[i].cents);

  const state: { best: MTx[] | null; key: [number, number, number] | null } = { best: null, key: null };
  let nodes = 0;
  const chosen: MTx[] = [];

  const better = (k: [number, number, number]) => {
    const b = state.key;
    return b === null || k[0] > b[0] || (k[0] === b[0] && (k[1] < b[1] || (k[1] === b[1] && k[2] < b[2])));
  };

  const dfs = (start: number, sum: number) => {
    if (nodes++ > NODE_BUDGET) return;
    if (chosen.length >= MIN_GROUP_SIZE && sum === goal) {
      const avgSim = chosen.reduce((s, c) => s + descriptionSimilarity(c, target), 0) / chosen.length;
      const avgDist = chosen.reduce((s, c) => s + dayDistance(c.date, target.date), 0) / chosen.length;
      const key: [number, number, number] = [avgSim, avgDist, chosen.reduce((s, c) => s + c.id, 0)];
      if (better(key)) {
        state.best = [...chosen];
        state.key = key;
      }
      return;
    }
    if (chosen.length >= MAX_GROUP_SIZE) return;
    for (let i = start; i < ranked.length; i++) {
      if (sum + suffix[i] < goal) break;
      const v = Math.abs(ranked[i].cents);
      if (sum + v > goal) continue;
      chosen.push(ranked[i]);
      dfs(i + 1, sum + v);
      chosen.pop();
    }
  };
  dfs(0, 0);

  return state.best ? state.best.sort(byId) : null;
}
