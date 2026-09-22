"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { analyzeReconciliation } from "@/lib/reconciliation/analyze";
import type { Database } from "@/lib/supabase/database.types";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"];

export type ActionState = { error: string | null };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createReconciliation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const bankFile = formData.get("bank_file") as File | null;
  const accountingFile = formData.get("accounting_file") as File | null;

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
    status: "processing",
    bank_statement_path: bankPath,
    accounting_statement_path: accountingPath,
    created_by: user.id,
  });

  if (insertError) {
    return { error: "Não foi possível criar a conciliação." };
  }

  let report: Awaited<ReturnType<typeof analyzeReconciliation>>;
  try {
    const [bankBuf, acctBuf] = await Promise.all([bankFile.arrayBuffer(), accountingFile.arrayBuffer()]);
    report = await analyzeReconciliation(
      Buffer.from(bankBuf).toString("base64"),
      Buffer.from(acctBuf).toString("base64")
    );
  } catch {
    await supabase.from("reconciliations").update({ status: "failed" }).eq("id", reconciliationId);
    return { error: "Não foi possível analisar um dos PDFs. Confirma que são extratos legíveis e tenta novamente." };
  }

  if (!report.documentsReadable && report.reconciled.length === 0 && report.probableMatches.length === 0) {
    await supabase
      .from("reconciliations")
      .update({ status: "failed", issues: report.issues })
      .eq("id", reconciliationId);
    return {
      error:
        report.issues[0] ??
        "Não foi possível ler um dos documentos. Confirma que são extratos bancário/contabilístico legíveis.",
    };
  }

  const transactions: TransactionInsert[] = [];
  const matches: MatchInsert[] = [];

  function txRow(source: "bank" | "accounting", t: { date: string; description: string; amount: number }): string {
    const id = crypto.randomUUID();
    transactions.push({
      id,
      reconciliation_id: reconciliationId,
      source,
      transaction_date: t.date,
      description: t.description,
      amount: round2(t.amount),
    });
    return id;
  }

  for (const t of report.reconciled) {
    const bankId = txRow("bank", t);
    const acctId = txRow("accounting", t);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankId,
      accounting_transaction_id: acctId,
      match_type: "exact",
      confidence: 100,
      status: "confirmed",
    });
  }

  for (const p of report.probableMatches) {
    const bankId = txRow("bank", p.bank);
    const acctId = txRow("accounting", p.accounting);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankId,
      accounting_transaction_id: acctId,
      match_type: "probable",
      // salvaguarda: normaliza caso o modelo devolva 0-1 em vez de 0-100
      confidence: round2(p.confidence > 0 && p.confidence <= 1 ? p.confidence * 100 : p.confidence),
      note: p.reason,
      status: "pending",
    });
  }

  for (const b of report.bankOnly) {
    const bankId = txRow("bank", b);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: bankId,
      accounting_transaction_id: null,
      match_type: "unmatched_bank",
      category: b.category,
      note: b.observation,
      status: "pending",
    });
  }

  for (const a of report.accountingOnly) {
    const acctId = txRow("accounting", a);
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: null,
      accounting_transaction_id: acctId,
      match_type: "unmatched_accounting",
      category: a.category,
      note: a.observation,
      status: "pending",
    });
  }

  const { error: txError } = transactions.length ? await supabase.from("transactions").insert(transactions) : { error: null };
  const { error: matchError } = txError || !matches.length ? { error: txError } : await supabase.from("matches").insert(matches);

  await supabase
    .from("reconciliations")
    .update({
      status: txError || matchError ? "failed" : "completed",
      bank_balance: report.bankBalance,
      accounting_balance: report.accountingBalance,
      difference: report.difference,
      closes: report.closes,
      summary: report.summary,
      issues: report.issues,
      next_steps: report.nextSteps,
    })
    .eq("id", reconciliationId);

  revalidatePath("/reconciliacao");
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

export async function deleteReconciliation(reconciliationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: recon } = await supabase
    .from("reconciliations")
    .select("bank_statement_path, accounting_statement_path")
    .eq("id", reconciliationId)
    .single();

  if (recon) {
    const paths = [recon.bank_statement_path, recon.accounting_statement_path].filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from("statements").remove(paths);
  }

  await supabase.from("reconciliations").delete().eq("id", reconciliationId);
  revalidatePath("/reconciliacao");
}
