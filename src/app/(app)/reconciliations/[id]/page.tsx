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
      "id, status, bank_balance, accounting_balance, difference, closes, summary, issues, next_steps, created_at"
    )
    .eq("id", id)
    .single();

  if (!reconciliation) notFound();

  const { data: matches } = await supabase
    .from("matches")
    .select(
      `id, match_type, confidence, category, note, status,
       bank_transaction:transactions!matches_bank_transaction_id_fkey(id, transaction_date, description, amount),
       accounting_transaction:transactions!matches_accounting_transaction_id_fkey(id, transaction_date, description, amount)`
    )
    .eq("reconciliation_id", id)
    .order("created_at", { ascending: true });

  return (
    <div>
      <Link href="/reconciliacao" className="text-xs font-medium text-foreground/50 hover:text-foreground">
        ← Conciliações
      </Link>
      <ResultsView
        reconciliationId={reconciliation.id}
        createdAt={reconciliation.created_at}
        status={reconciliation.status}
        bankBalance={reconciliation.bank_balance}
        accountingBalance={reconciliation.accounting_balance}
        difference={reconciliation.difference}
        closes={reconciliation.closes}
        summary={reconciliation.summary}
        issues={(reconciliation.issues as string[] | null) ?? []}
        nextSteps={(reconciliation.next_steps as string[] | null) ?? []}
        matches={(matches ?? []) as unknown as MatchRow[]}
      />
    </div>
  );
}
