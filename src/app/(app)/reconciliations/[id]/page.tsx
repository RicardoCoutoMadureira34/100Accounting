import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FlowSteps } from "@/components/flow-steps";
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

  // Ainda no passo 2 (dados por confirmar): o resultado ainda não existe.
  if (reconciliation.status === "review" || reconciliation.status === "pending") {
    redirect(`/reconciliations/${id}/dados`);
  }

  // Conciliações antigas (anteriores ao passo 2) não têm dados guardados.
  const { count: documentCount } = await supabase
    .from("statement_documents")
    .select("id", { count: "exact", head: true })
    .eq("reconciliation_id", id);
  const hasData = (documentCount ?? 0) > 0;

  const { data: matches } = await supabase
    .from("matches")
    .select(
      `id, match_type, confidence, category, group_id, note, status,
       bank_transaction:transactions!matches_bank_transaction_id_fkey(id, transaction_date, description, amount),
       accounting_transaction:transactions!matches_accounting_transaction_id_fkey(id, transaction_date, description, amount)`
    )
    .eq("reconciliation_id", id)
    .order("created_at", { ascending: true });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/reconciliacao" className="text-xs font-medium text-foreground/50 hover:text-foreground">
          ← Conciliações
        </Link>
        {hasData && (
          <Link href={`/reconciliations/${id}/dados`} className="text-xs font-semibold text-accent-600 hover:underline">
            Ver dados lidos
          </Link>
        )}
      </div>
      <div className="mt-2">
        <FlowSteps current={3} hrefs={{ 1: "/reconciliacao", ...(hasData ? { 2: `/reconciliations/${id}/dados` } : {}) }} />
      </div>
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
