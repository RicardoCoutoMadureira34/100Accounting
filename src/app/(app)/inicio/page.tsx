import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";

function euro(n: number | null) {
  return n == null
    ? "—"
    : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
}

export default async function InicioPage() {
  const supabase = await createClient();

  const { data: reconciliations } = await supabase
    .from("reconciliations")
    .select("id, status, bank_balance, accounting_balance, difference, closes, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const total = reconciliations?.length ?? 0;
  const completed = reconciliations?.filter((r) => r.status === "completed").length ?? 0;
  const fecham = reconciliations?.filter((r) => r.closes === true).length ?? 0;
  const emCurso = reconciliations?.filter((r) => ["pending", "processing", "review"].includes(r.status)).length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand-700">
            Reconciliação Bancária
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            Cruza os extratos do banco e da contabilidade e exporta o relatório.
          </p>
        </div>
        <Link
          href="/reconciliacao"
          className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-accent-600"
        >
          <PlusIcon />
          Nova conciliação
        </Link>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={total} />
        <StatCard label="Concluídas" value={completed} accent />
        <StatCard label="Fecham" value={fecham} />
        <StatCard label="Em curso" value={emCurso} />
      </div>

      {/* Tabela de conciliações recentes */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-foreground/40">
          Conciliações recentes
        </h2>
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2.5 font-semibold">Data</th>
                <th className="px-4 py-2.5 font-semibold">Resumo</th>
                <th className="px-4 py-2.5 font-semibold">Saldo banco</th>
                <th className="px-4 py-2.5 font-semibold">Diferença</th>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {!reconciliations || reconciliations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center text-sm text-foreground/40">
                    Ainda não tens conciliações.{" "}
                    <Link href="/reconciliacao" className="font-semibold text-accent-500 hover:underline">
                      Cria a primeira →
                    </Link>
                  </td>
                </tr>
              ) : (
                reconciliations.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.015]">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground/50">
                      {new Date(r.created_at).toLocaleDateString("pt-PT")}
                    </td>
                    <td className="max-w-xs px-4 py-2.5">
                      <Link
                        href={`/reconciliations/${r.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {r.summary
                          ? r.summary.slice(0, 80) + (r.summary.length > 80 ? "…" : "")
                          : "Ver relatório"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground/60">
                      {euro(r.bank_balance)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <span className={r.difference === 0 ? "font-semibold text-accent-500" : ""}>
                        {euro(r.difference)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.closes === true ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-500">
                          <CheckIcon />
                          Sim
                        </span>
                      ) : r.closes === false ? (
                        <span className="text-xs text-foreground/40">Não</span>
                      ) : (
                        <span className="text-xs text-foreground/30">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="mt-3 text-right">
            <Link href="/reconciliacao" className="text-xs font-semibold text-accent-500 hover:underline">
              Nova conciliação →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{label}</p>
      <p
        className={`mt-1 font-display text-3xl font-extrabold ${
          accent ? "text-accent-500" : "text-brand-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}
