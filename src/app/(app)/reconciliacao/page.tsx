import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import NewReconciliationForm from "./new-reconciliation-form";
import DeleteReconciliationButton from "./delete-button";

function euro(n: number | null) {
  return n == null ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
}

export default async function ReconciliacaoPage() {
  const supabase = await createClient();

  const { data: reconciliations } = await supabase
    .from("reconciliations")
    .select("id, status, bank_balance, accounting_balance, difference, closes, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-xl font-bold text-brand-700">Nova conciliação</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Carrega o extrato bancário e o extrato da contabilidade em PDF — o resto é automático.
        </p>
        <div className="mt-4">
          <NewReconciliationForm />
        </div>
      </div>

      <div>
        <h2 className="text-base font-bold text-brand-700">Conciliações anteriores</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2.5 font-semibold">Data</th>
                <th className="px-4 py-2.5 font-semibold">Resumo</th>
                <th className="px-4 py-2.5 font-semibold">Diferença</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {!reconciliations || reconciliations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-foreground/40">
                    Sem conciliações ainda. Carrega os dois PDFs acima para começar.
                  </td>
                </tr>
              ) : (
                reconciliations.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.015]">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground/60">
                      {new Date(r.created_at).toLocaleDateString("pt-PT")}
                    </td>
                    <td className="max-w-md px-4 py-2.5">
                      <Link href={`/reconciliations/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.summary ? r.summary.slice(0, 90) + (r.summary.length > 90 ? "…" : "") : "Ver relatório"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{euro(r.difference)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <DeleteReconciliationButton id={r.id} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
