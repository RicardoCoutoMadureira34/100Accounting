import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import NewBankAccountForm from "./new-bank-account-form";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, nif, created_at")
    .eq("id", clientId)
    .single();

  if (!client) notFound();

  const { data: bankAccounts } = await supabase
    .from("bank_accounts")
    .select("id, bank_name, iban, reconciliations(id, period_start, period_end, status, difference, created_at)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/dashboard" className="text-xs font-medium text-foreground/50 hover:text-foreground">
          ← Clientes
        </Link>
        <h1 className="mt-2 text-xl font-bold text-brand-700">{client.name}</h1>
        <p className="mt-1 text-sm text-foreground/60">{client.nif ? `NIF ${client.nif}` : "Sem NIF registado"}</p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-700">Contas bancárias</h2>
        </div>

        {(bankAccounts ?? []).map((ba) => {
          type Recon = { id: string; period_start: string; period_end: string; status: string; difference: number | null; created_at: string };
          const reconciliations = ((ba.reconciliations as unknown as Recon[]) ?? []).sort(
            (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
          );
          return (
            <div key={ba.id} className="rounded-xl border border-black/10 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
                <div>
                  <p className="font-semibold text-foreground">{ba.bank_name}</p>
                  {ba.iban && <p className="font-mono text-xs text-foreground/50">{ba.iban}</p>}
                </div>
                <Link
                  href={`/reconciliations/new?bank_account_id=${ba.id}`}
                  className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-600"
                >
                  + Nova conciliação
                </Link>
              </div>
              {reconciliations.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-foreground/40">Ainda sem conciliações nesta conta.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {reconciliations.map((r) => (
                      <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.015]">
                        <td className="px-4 py-2.5">
                          <Link href={`/reconciliations/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                            {r.period_start} — {r.period_end}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground/70">
                          {r.difference != null
                            ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(r.difference)
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        <NewBankAccountForm clientId={client.id} />
      </div>
    </div>
  );
}
