"use client";

import { useMemo, useState, useTransition } from "react";
import { updateMatchStatus } from "../actions";
import { StatusBadge } from "@/components/status-badge";
import { deriveLists, type MatchRow, type Tx, type UnmatchedRow } from "@/lib/reconciliation/results";

export type { MatchRow };

// Categorias fixas para movimentos sem correspondência (ver
// UNMATCHED_CATEGORIES em src/lib/reconciliation/narrative.ts): rótulos
// para o ecrã e o Excel. "outra_sem_categoria" cobre matches antigos gravados
// antes desta coluna existir e pares prováveis rejeitados (category === null).
const CATEGORY_LABELS: Record<string, string> = {
  cheque_em_transito: "Cheque em trânsito",
  deposito_em_transito: "Depósito em trânsito",
  debito_nao_registado: "Débito ainda não registado",
  comissao_juro_bancario: "Comissão / juro bancário",
  erro_transcricao: "Possível erro de transcrição",
  duplicado: "Possível duplicado",
  outro: "Outro",
  outra_sem_categoria: "Sem categoria",
};
const categoryLabel = (c: string | null) => CATEGORY_LABELS[c ?? "outra_sem_categoria"] ?? CATEGORY_LABELS.outra_sem_categoria;

const euro = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);

const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

type Tab = "reconciled" | "probable" | "bankonly" | "acctonly";

export default function ResultsView({
  reconciliationId,
  createdAt,
  status,
  bankBalance,
  accountingBalance,
  difference,
  closes,
  summary,
  issues,
  nextSteps,
  matches,
}: {
  reconciliationId: string;
  createdAt: string;
  status: string;
  bankBalance: number | null;
  accountingBalance: number | null;
  difference: number | null;
  closes: boolean | null;
  summary: string | null;
  issues: string[];
  nextSteps: string[];
  matches: MatchRow[];
}) {
  const [tab, setTab] = useState<Tab>("reconciled");
  const [pending, startTransition] = useTransition();
  const [actioning, setActioning] = useState<string | null>(null);
  // Cópia local editável: a Server Action persiste na base de dados, mas o
  // ecrã tem de refletir a mudança de imediato sem esperar por uma navegação.
  const [localMatches, setLocalMatches] = useState(matches);

  // As listas são derivadas das linhas de matches: um par provável rejeitado
  // volta a "Só no Banco" / "Só na Contabilidade"; os grupos um-para-vários
  // aparecem num único cartão.
  const { reconciled, probable, bankOnly, acctOnly } = useMemo(() => deriveLists(localMatches), [localMatches]);

  // Soma bruta dos valores sem correspondência de cada lado, distinta da
  // "Diferença por explicar" (um lado pode cancelar o outro). Isto mostra
  // quanto dinheiro está mesmo pendente de revisão.
  const bankOnlyTotal = bankOnly.reduce((s, t) => s + t.amount, 0);
  const acctOnlyTotal = acctOnly.reduce((s, t) => s + t.amount, 0);

  function act(matchId: string, next: "confirmed" | "rejected") {
    setActioning(matchId);
    startTransition(async () => {
      await updateMatchStatus(matchId, next, reconciliationId);
      setLocalMatches((prev) => {
        const groupId = prev.find((m) => m.id === matchId)?.group_id ?? null;
        return prev.map((m) => (m.id === matchId || (groupId && m.group_id === groupId) ? { ...m, status: next } : m));
      });
      setActioning(null);
    });
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    type Cell = string | number;

    const summaryRows: Cell[][] = [
      ["Relatório de Conciliação Bancária"],
      [new Date(createdAt).toLocaleString("pt-PT")],
      [],
      [summary ?? ""],
      [],
      ["Saldo do Banco (EUR)", bankBalance ?? 0],
      ["Saldo da Contabilidade (EUR)", accountingBalance ?? 0],
      ["Diferença por explicar (EUR)", difference ?? 0],
      ["Reconciliação fecha?", closes ? "Sim" : "Não"],
      [],
      ["Reconciliados", reconciled.length],
      ["Prováveis por confirmar", probable.length],
      ["Só no Banco", bankOnly.length, "Total (EUR)", bankOnlyTotal],
      ["Só na Contabilidade", acctOnly.length, "Total (EUR)", acctOnlyTotal],
      ["Valor sem correspondência (EUR)", Math.abs(bankOnlyTotal) + Math.abs(acctOnlyTotal)],
      [],
      ["Próximos passos"],
      ...nextSteps.map((s, i): Cell[] => [`${i + 1}. ${s}`]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumo");

    const recRows: Cell[][] = [
      ["Data", "Descrição", "Valor (EUR)", "Estado", "Data contabilidade", "Descrição contabilidade", "Valor contabilidade (EUR)"],
    ];
    reconciled.forEach(({ tx, other }) => {
      recRows.push([
        dmy(tx.transaction_date),
        tx.description,
        tx.amount,
        "100% match",
        other ? dmy(other.transaction_date) : "",
        other?.description ?? "",
        other ? other.amount : "",
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recRows), "Reconciliados");

    const probRows: Cell[][] = [
      ["Data Banco", "Descrição Banco", "Valor Banco", "Data Contabilidade", "Descrição Contabilidade", "Valor Contabilidade", "Confiança (%)", "Observação"],
    ];
    // Grupos um-para-vários: uma linha por movimento, com o lado único repetido.
    probable.forEach((card) => {
      const rows = Math.max(card.bank.length, card.accounting.length);
      for (let i = 0; i < rows; i++) {
        const b = card.bank.length === 1 ? card.bank[0] : card.bank[i];
        const a = card.accounting.length === 1 ? card.accounting[0] : card.accounting[i];
        probRows.push([
          b ? dmy(b.transaction_date) : "",
          b?.description ?? "",
          b ? b.amount : "",
          a ? dmy(a.transaction_date) : "",
          a?.description ?? "",
          a ? a.amount : "",
          card.confidence ?? "",
          card.note ?? "",
        ]);
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(probRows), "Provaveis");

    const unmatchedSheet = (rows: UnmatchedRow[], total: number): Cell[][] => [
      ["Data", "Descrição", "Valor (EUR)", "Categoria", "Observação"],
      ...rows.map((t): Cell[] => [dmy(t.transaction_date), t.description, t.amount, categoryLabel(t.category), t.note ?? ""]),
      [],
      ["", "", "Total", total, ""],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(unmatchedSheet(bankOnly, bankOnlyTotal)), "So no Banco");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(unmatchedSheet(acctOnly, acctOnlyTotal)), "So na Contabilidade");

    XLSX.writeFile(wb, `Match_${createdAt.slice(0, 10)}.xlsx`);
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-brand-700">Relatório de conciliação</h1>
          <p className="mt-1 text-sm text-foreground/60">
            {new Date(createdAt).toLocaleString("pt-PT", { dateStyle: "long", timeStyle: "short" })} · <StatusBadge status={status} />
          </p>
        </div>
        <button
          onClick={exportExcel}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
        >
          Exportar para Excel
        </button>
      </div>

      {issues.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Avisos sobre os documentos</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((i, idx) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <div className="mt-5 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-foreground/40">Resumo da reconciliação</p>
            {closes != null && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${closes ? "bg-accent-50 text-accent-600" : "bg-amber-100 text-amber-700"}`}
              >
                {closes ? "Fecha" : "Não fecha"}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">{summary}</p>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Saldo do Banco" value={euro(bankBalance)} />
        <StatTile label="Saldo da Contabilidade" value={euro(accountingBalance)} />
        <StatTile label="Diferença por explicar" value={euro(difference)} danger />
        <StatTile
          label="Valor sem correspondência"
          value={euro(Math.abs(bankOnlyTotal) + Math.abs(acctOnlyTotal))}
          danger={bankOnly.length + acctOnly.length > 0}
        />
      </div>

      <div className="mt-8 flex gap-1 border-b border-black/10 text-sm">
        <TabButton active={tab === "reconciled"} onClick={() => setTab("reconciled")} label="Reconciliado" count={reconciled.length} />
        <TabButton active={tab === "probable"} onClick={() => setTab("probable")} label="Prováveis a confirmar" count={probable.length} />
        <TabButton active={tab === "bankonly"} onClick={() => setTab("bankonly")} label="Só no Banco" count={bankOnly.length} />
        <TabButton active={tab === "acctonly"} onClick={() => setTab("acctonly")} label="Só na Contabilidade" count={acctOnly.length} />
      </div>

      <div className="mt-5">
        {tab === "reconciled" && (
          <SimpleTable
            rows={reconciled.map(({ tx }) => ({ ...tx, note: null }))}
            badge={<span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-[11px] font-bold text-accent-600">100% match</span>}
          />
        )}
        {tab === "bankonly" && (
          <GroupedUnmatchedTable
            rows={bankOnly}
            total={bankOnlyTotal}
          />
        )}
        {tab === "acctonly" && (
          <GroupedUnmatchedTable
            rows={acctOnly}
            total={acctOnlyTotal}
          />
        )}
        {tab === "probable" &&
          (probable.length === 0 ? (
            <p className="rounded-xl border border-black/10 bg-white px-6 py-10 text-center text-sm text-foreground/40">
              Todos os pares prováveis foram revistos.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {probable.map((m) => (
                <div key={m.matchId} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
                  <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                    <div className="flex flex-col gap-2">
                      {m.bank.map((t, i) => (
                        <PairSide key={t.id} label={i === 0 ? "Banco" : ""} tx={t} />
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      {m.accounting.map((t, i) => (
                        <PairSide key={t.id} label={i === 0 ? "Contabilidade" : ""} tx={t} />
                      ))}
                    </div>
                    <div className="text-center">
                      <div
                        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full font-mono text-xs font-bold ${
                          (m.confidence ?? 0) >= 90
                            ? "bg-accent-50 text-accent-600"
                            : (m.confidence ?? 0) >= 80
                              ? "bg-amber-100 text-amber-700"
                              : "bg-danger-50 text-danger-600"
                        }`}
                      >
                        {m.confidence}%
                      </div>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-foreground/40">Confiança</p>
                    </div>
                    <div className="flex gap-2 sm:flex-col">
                      <button
                        disabled={pending && actioning === m.matchId}
                        onClick={() => act(m.matchId, "confirmed")}
                        className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-600 transition hover:bg-accent-500 hover:text-white disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                      <button
                        disabled={pending && actioning === m.matchId}
                        onClick={() => act(m.matchId, "rejected")}
                        className="rounded-lg bg-danger-50 px-3 py-1.5 text-xs font-semibold text-danger-600 transition hover:bg-danger-600 hover:text-white disabled:opacity-50"
                      >
                        Rejeitar
                      </button>
                    </div>
                  </div>
                  {m.note && (
                    <p className="mt-3 border-t border-black/5 pt-3 text-xs text-foreground/60">
                      <span className="font-semibold text-foreground/75">Porquê: </span>
                      {m.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}
      </div>

      {nextSteps.length > 0 && (
        <div className="mt-10 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-brand-700">Conclusão e próximos passos</h2>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-foreground/80">
            {nextSteps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-50 font-mono text-[11px] font-bold text-brand-700">
                  {i + 1}
                </span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-foreground/55">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-bold ${danger ? "text-danger-600" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
        active ? "border-accent-500 text-accent-600" : "border-transparent text-foreground/50 hover:text-foreground"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] ${active ? "bg-accent-50 text-accent-600" : "bg-black/5 text-foreground/50"}`}>
        {count}
      </span>
    </button>
  );
}

function SimpleTable({ rows, badge }: { rows: (Tx & { note?: string | null })[]; badge: React.ReactNode }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)), [rows]);
  if (sorted.length === 0) {
    return <p className="rounded-xl border border-black/10 bg-white px-6 py-10 text-center text-sm text-foreground/40">Sem movimentos nesta categoria.</p>;
  }
  const hasNotes = sorted.some((t) => t.note);
  return (
    <div className="max-h-[520px] overflow-auto rounded-xl border border-black/10 bg-white">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Data</th>
            <th className="px-4 py-2.5 font-semibold">Descrição</th>
            <th className="px-4 py-2.5 text-right font-semibold">Valor</th>
            <th className="px-4 py-2.5 font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="border-t border-black/5 hover:bg-black/[0.015] align-top">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground/60">{dmy(t.transaction_date)}</td>
              <td className="px-4 py-2.5">
                {t.description}
                {hasNotes && t.note && <p className="mt-1 text-xs text-foreground/50">{t.note}</p>}
              </td>
              <td className={`px-4 py-2.5 text-right font-mono ${t.amount < 0 ? "text-foreground" : "text-accent-600"}`}>
                {t.amount > 0 ? "+" : ""}
                {euro(t.amount)}
              </td>
              <td className="px-4 py-2.5">{badge}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Movimentos sem correspondência, agrupados pela categoria devolvida pelo
// Claude (ver CATEGORY_LABELS acima), cada grupo com o seu subtotal — para o
// contabilista perceber de imediato qual é a causa mais comum e quanto
// dinheiro está em cada uma, além do total geral da secção.
function GroupedUnmatchedTable({ rows, total }: { rows: UnmatchedRow[]; total: number }) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, UnmatchedRow[]>();
    for (const row of rows) {
      const key = row.category ?? "outra_sem_categoria";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(row);
    }
    return [...byCategory.entries()]
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
        subtotal: items.reduce((s, t) => s + t.amount, 0),
      }))
      .sort((a, b) => Math.abs(b.subtotal) - Math.abs(a.subtotal));
  }, [rows]);

  if (rows.length === 0) {
    return <p className="rounded-xl border border-black/10 bg-white px-6 py-10 text-center text-sm text-foreground/40">Sem movimentos nesta secção.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
        <span className="font-semibold text-amber-800">
          {rows.length} {rows.length === 1 ? "movimento" : "movimentos"} sem correspondência
        </span>
        <span className="font-mono font-bold text-amber-800">Total: {euro(total)}</span>
      </div>

      {groups.map((g) => (
        <div key={g.category} className="overflow-hidden rounded-xl border border-black/10 bg-white">
          <div className="flex items-center justify-between bg-black/[0.02] px-4 py-2 text-xs">
            <span className="font-bold uppercase tracking-wide text-foreground/60">
              {categoryLabel(g.category)} <span className="font-normal normal-case text-foreground/40">({g.items.length})</span>
            </span>
            <span className="font-mono font-semibold text-foreground/70">{euro(g.subtotal)}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {g.items.map((t) => (
                <tr key={t.id} className="border-t border-black/5 align-top hover:bg-black/[0.015]">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground/60">{dmy(t.transaction_date)}</td>
                  <td className="px-4 py-2.5">
                    {t.description}
                    {t.note && <p className="mt-1 text-xs text-foreground/50">{t.note}</p>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono ${t.amount < 0 ? "text-foreground" : "text-accent-600"}`}>
                    {t.amount > 0 ? "+" : ""}
                    {euro(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function PairSide({ label, tx }: { label: string; tx: Tx | null }) {
  return (
    <div>
      {label && <p className="text-[10px] font-bold uppercase tracking-wide text-foreground/40">{label}</p>}
      <p className={`${label ? "mt-1 " : ""}text-sm font-semibold text-foreground`}>{tx?.description ?? "—"}</p>
      <p className="mt-0.5 flex gap-3 text-xs text-foreground/55">
        <span>{tx ? dmy(tx.transaction_date) : ""}</span>
        <span className="font-mono font-semibold text-foreground">{tx ? euro(tx.amount) : ""}</span>
      </p>
    </div>
  );
}
