"use client";

import { useMemo, useState, useTransition } from "react";
import { updateMatchStatus } from "../actions";
import { StatusBadge } from "@/components/status-badge";

interface Tx {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
}

export interface MatchRow {
  id: string;
  match_type: "exact" | "probable" | "unmatched_bank" | "unmatched_accounting";
  confidence: number | null;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  bank_transaction: Tx | null;
  accounting_transaction: Tx | null;
}

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

  const reconciled = localMatches.filter((m) => m.match_type === "exact" || (m.match_type === "probable" && m.status === "confirmed"));
  const probable = localMatches.filter((m) => m.match_type === "probable" && m.status === "pending");
  const bankOnly = localMatches.filter((m) => m.match_type === "unmatched_bank");
  const acctOnly = localMatches.filter((m) => m.match_type === "unmatched_accounting");

  function act(matchId: string, next: "confirmed" | "rejected") {
    setActioning(matchId);
    startTransition(async () => {
      await updateMatchStatus(matchId, next, reconciliationId);
      setLocalMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: next } : m)));
      setActioning(null);
    });
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const summaryRows = [
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
      ["Prováveis — por confirmar", probable.length],
      ["Só no Banco", bankOnly.length],
      ["Só na Contabilidade", acctOnly.length],
      [],
      ["Próximos passos"],
      ...nextSteps.map((s, i) => [`${i + 1}. ${s}`]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumo");

    const recRows = [["Data", "Descrição", "Valor (EUR)", "Estado"]];
    reconciled.forEach((m) => {
      const t = m.bank_transaction ?? m.accounting_transaction;
      if (t) recRows.push([dmy(t.transaction_date), t.description, String(t.amount), "100% match"]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recRows), "Reconciliados");

    const probRows = [
      ["Data Banco", "Descrição Banco", "Valor Banco", "Data Contabilidade", "Descrição Contabilidade", "Valor Contabilidade", "Confiança (%)", "Observação"],
    ];
    localMatches
      .filter((m) => m.match_type === "probable")
      .forEach((m) => {
        probRows.push([
          m.bank_transaction ? dmy(m.bank_transaction.transaction_date) : "",
          m.bank_transaction?.description ?? "",
          String(m.bank_transaction?.amount ?? ""),
          m.accounting_transaction ? dmy(m.accounting_transaction.transaction_date) : "",
          m.accounting_transaction?.description ?? "",
          String(m.accounting_transaction?.amount ?? ""),
          String(m.confidence ?? ""),
          m.note ?? "",
        ]);
      });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(probRows), "Provaveis");

    const bankRows = [["Data", "Descrição", "Valor (EUR)", "Observação"]];
    bankOnly.forEach((m) => {
      if (m.bank_transaction) bankRows.push([dmy(m.bank_transaction.transaction_date), m.bank_transaction.description, String(m.bank_transaction.amount), m.note ?? ""]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bankRows), "So no Banco");

    const acctRows = [["Data", "Descrição", "Valor (EUR)", "Observação"]];
    acctOnly.forEach((m) => {
      if (m.accounting_transaction) acctRows.push([dmy(m.accounting_transaction.transaction_date), m.accounting_transaction.description, String(m.accounting_transaction.amount), m.note ?? ""]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(acctRows), "So na Contabilidade");

    XLSX.writeFile(wb, `Concilia_${createdAt.slice(0, 10)}.xlsx`);
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

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Saldo do Banco" value={euro(bankBalance)} />
        <StatTile label="Saldo da Contabilidade" value={euro(accountingBalance)} />
        <StatTile label="Diferença por explicar" value={euro(difference)} danger />
      </div>

      <div className="mt-8 flex gap-1 border-b border-black/10 text-sm">
        <TabButton active={tab === "reconciled"} onClick={() => setTab("reconciled")} label="Reconciliado" count={reconciled.length} />
        <TabButton active={tab === "probable"} onClick={() => setTab("probable")} label="Prováveis — confirmar" count={probable.length} />
        <TabButton active={tab === "bankonly"} onClick={() => setTab("bankonly")} label="Só no Banco" count={bankOnly.length} />
        <TabButton active={tab === "acctonly"} onClick={() => setTab("acctonly")} label="Só na Contabilidade" count={acctOnly.length} />
      </div>

      <div className="mt-5">
        {tab === "reconciled" && (
          <SimpleTable
            rows={reconciled.map((m) => ({ ...(m.bank_transaction ?? m.accounting_transaction!), note: null }))}
            badge={<span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-[11px] font-bold text-accent-600">100% match</span>}
          />
        )}
        {tab === "bankonly" && (
          <SimpleTable
            rows={bankOnly.map((m) => ({ ...m.bank_transaction!, note: m.note })).filter((t) => t.id)}
            badge={<span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">Sem correspondência</span>}
          />
        )}
        {tab === "acctonly" && (
          <SimpleTable
            rows={acctOnly.map((m) => ({ ...m.accounting_transaction!, note: m.note })).filter((t) => t.id)}
            badge={<span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">Sem correspondência</span>}
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
                <div key={m.id} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
                  <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                    <PairSide label="Banco" tx={m.bank_transaction} />
                    <PairSide label="Contabilidade" tx={m.accounting_transaction} />
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
                        disabled={pending && actioning === m.id}
                        onClick={() => act(m.id, "confirmed")}
                        className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-600 transition hover:bg-accent-500 hover:text-white disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                      <button
                        disabled={pending && actioning === m.id}
                        onClick={() => act(m.id, "rejected")}
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

function PairSide({ label, tx }: { label: string; tx: Tx | null }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-foreground/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{tx?.description ?? "—"}</p>
      <p className="mt-0.5 flex gap-3 text-xs text-foreground/55">
        <span>{tx ? dmy(tx.transaction_date) : ""}</span>
        <span className="font-mono font-semibold text-foreground">{tx ? euro(tx.amount) : ""}</span>
      </p>
    </div>
  );
}
