import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewReconciliationForm from "./new-reconciliation-form";

export default async function NewReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ bank_account_id?: string }>;
}) {
  const { bank_account_id: bankAccountId } = await searchParams;
  if (!bankAccountId) notFound();

  const supabase = await createClient();
  const { data: bankAccount } = await supabase
    .from("bank_accounts")
    .select("id, bank_name, client_id, clients(name)")
    .eq("id", bankAccountId)
    .single();

  if (!bankAccount) notFound();
  const clientName = (bankAccount.clients as unknown as { name: string } | null)?.name ?? "";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/clients/${bankAccount.client_id}`} className="text-xs font-medium text-foreground/50 hover:text-foreground">
        ← {clientName}
      </Link>
      <h1 className="mt-2 text-xl font-bold text-brand-700">Nova conciliação</h1>
      <p className="mt-1 text-sm text-foreground/60">
        {clientName} · {bankAccount.bank_name}
      </p>

      <NewReconciliationForm bankAccountId={bankAccount.id} />
    </div>
  );
}
