import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: clients }, { data: reconciliations }] = await Promise.all([
    supabase.from("clients").select("id, name, nif, created_at").order("created_at", { ascending: false }),
    supabase
      .from("reconciliations")
      .select(
        "id, period_start, period_end, status, difference, created_at, bank_accounts(bank_name, clients(id, name))"
      )
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-brand-700">Clientes</h1>
          <p className="mt-1 text-sm text-foreground/60">Gabinetes e empresas que geres no Concilia.</p>
        </div>
        <Link
          href="/clients/new"
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
        >
          + Novo cliente
        </Link>
      </div>

      {!clients || clients.length === 0 ? (
        <EmptyState
          title="Ainda não tens clientes"
          description="Cria o primeiro cliente para poderes carregar extratos e iniciar uma conciliação."
          href="/clients/new"
          cta="Criar cliente"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="rounded-xl border border-black/10 bg-white p-4 shadow-sm transition hover:border-accent-500/50 hover:shadow-md"
            >
              <p className="font-semibold text-foreground">{c.name}</p>
              <p className="mt-1 text-xs text-foreground/50">{c.nif ? `NIF ${c.nif}` : "Sem NIF registado"}</p>
            </Link>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-base font-bold text-brand-700">Conciliações recentes</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2.5 font-semibold">Cliente</th>
                <th className="px-4 py-2.5 font-semibold">Conta</th>
                <th className="px-4 py-2.5 font-semibold">Período</th>
                <th className="px-4 py-2.5 font-semibold">Diferença</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {!reconciliations || reconciliations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-foreground/40">
                    Sem conciliações ainda.
                  </td>
                </tr>
              ) : (
                reconciliations.map((r) => {
                  const ba = r.bank_accounts as unknown as { bank_name: string; clients: { id: string; name: string } } | null;
                  return (
                    <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.015]">
                      <td className="px-4 py-2.5">
                        <Link href={`/reconciliations/${r.id}`} className="font-medium text-brand-700 hover:underline">
                          {ba?.clients?.name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-foreground/70">{ba?.bank_name ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-foreground/60">
                        {r.period_start} — {r.period_end}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {r.difference != null ? euro(r.difference) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function euro(n: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
}

function EmptyState({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-black/15 bg-white px-6 py-10 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-foreground/55">{description}</p>
      <Link
        href={href}
        className="mt-4 inline-block rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
      >
        {cta}
      </Link>
    </div>
  );
}
