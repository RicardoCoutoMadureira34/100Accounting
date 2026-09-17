import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResultsView, { type MatchRow } from "./results-view";

export default async function ReconciliationResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: reconciliation } = await supabase
    .from("reconciliations")
    .select(
      "id, period_start, period_end, status, bank_balance, accounting_balance, difference, bank_accounts(bank_name, client_id, clients(name))"
    )
    .eq("id", id)
    .single();

  if (!reconciliation) notFound();

  const { data: matches } = await supabase
    .from("matches")
    .select(
      `id, match_type, confidence, status,
       bank_transaction:transactions!matches_bank_transaction_id_fkey(id, transaction_date, description, amount),
       accounting_transaction:transactions!matches_accounting_transaction_id_fkey(id, transaction_date, description, amount)`
    )
    .eq("reconciliation_id", id)
    .order("created_at", { ascending: true });

  const ba = reconciliation.bank_accounts as unknown as {
    bank_name: string;
    client_id: string;
    clients: { name: string };
  } | null;

  return (
    <div>
      <Link href={ba ? `/clients/${ba.client_id}` : "/dashboard"} className="text-xs font-medium text-foreground/50 hover:text-foreground">
        ← {ba?.clients?.name ?? "Cliente"}
      </Link>
      <ResultsView
        reconciliationId={reconciliation.id}
        clientName={ba?.clients?.name ?? "—"}
        bankName={ba?.bank_name ?? "—"}
        periodStart={reconciliation.period_start}
        periodEnd={reconciliation.period_end}
        status={reconciliation.status}
        bankBalance={reconciliation.bank_balance}
        accountingBalance={reconciliation.accounting_balance}
        difference={reconciliation.difference}
        matches={(matches ?? []) as unknown as MatchRow[]}
      />
    </div>
  );
}
