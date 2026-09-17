"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateStubDataset } from "@/lib/reconciliation/stub-seed";

export type ActionState = { error: string | null };

export async function createReconciliation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const bankAccountId = String(formData.get("bank_account_id") ?? "");
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  const bankFile = formData.get("bank_file") as File | null;
  const accountingFile = formData.get("accounting_file") as File | null;

  if (!bankAccountId || !periodStart || !periodEnd) {
    return { error: "Preenche o período da conciliação." };
  }
  if (!bankFile || bankFile.size === 0 || !accountingFile || accountingFile.size === 0) {
    return { error: "Carrega os dois ficheiros PDF." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const reconciliationId = crypto.randomUUID();
  const basePath = `${user.id}/${reconciliationId}`;
  const bankPath = `${basePath}/extrato-bancario.pdf`;
  const accountingPath = `${basePath}/extrato-contabilidade.pdf`;

  const [bankUpload, accountingUpload] = await Promise.all([
    supabase.storage.from("statements").upload(bankPath, bankFile, { contentType: "application/pdf" }),
    supabase.storage.from("statements").upload(accountingPath, accountingFile, { contentType: "application/pdf" }),
  ]);

  if (bankUpload.error || accountingUpload.error) {
    return { error: "Não foi possível carregar os ficheiros. Tenta novamente." };
  }

  const { error: insertError } = await supabase.from("reconciliations").insert({
    id: reconciliationId,
    bank_account_id: bankAccountId,
    period_start: periodStart,
    period_end: periodEnd,
    status: "processing",
    bank_statement_path: bankPath,
    accounting_statement_path: accountingPath,
    created_by: user.id,
  });

  if (insertError) {
    return { error: "Não foi possível criar a conciliação." };
  }

  // TEMPORÁRIO: dados gerados, não extraídos dos PDFs — ver stub-seed.ts.
  const dataset = generateStubDataset({ reconciliationId, periodStart, periodEnd });

  const { error: txError } = await supabase.from("transactions").insert(dataset.transactions);
  const { error: matchError } = txError ? { error: txError } : await supabase.from("matches").insert(dataset.matches);

  await supabase
    .from("reconciliations")
    .update({
      status: txError || matchError ? "failed" : "completed",
      bank_balance: dataset.bankBalance,
      accounting_balance: dataset.accountingBalance,
      difference: dataset.difference,
    })
    .eq("id", reconciliationId);

  revalidatePath("/dashboard");
  redirect(`/reconciliations/${reconciliationId}`);
}

export async function updateMatchStatus(matchId: string, status: "confirmed" | "rejected", reconciliationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("matches")
    .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", matchId);

  revalidatePath(`/reconciliations/${reconciliationId}`);
}
