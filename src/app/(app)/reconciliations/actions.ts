"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractStatementTransactions } from "@/lib/reconciliation/extract-pdf";
import { matchStatements, type ExtractedTx } from "@/lib/reconciliation/match";
import type { Database } from "@/lib/supabase/database.types";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"];

export type ActionState = { error: string | null };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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

  let bankStatement: { transactions: ExtractedTx[]; closingBalance: number | null };
  let acctStatement: { transactions: ExtractedTx[]; closingBalance: number | null };
  try {
    const [bankBuf, acctBuf] = await Promise.all([bankFile.arrayBuffer(), accountingFile.arrayBuffer()]);
    [bankStatement, acctStatement] = await Promise.all([
      extractStatementTransactions(Buffer.from(bankBuf).toString("base64"), "bank"),
      extractStatementTransactions(Buffer.from(acctBuf).toString("base64"), "accounting"),
    ]);
  } catch {
    await supabase.from("reconciliations").update({ status: "failed" }).eq("id", reconciliationId);
    return { error: "Não foi possível ler um dos PDFs. Confirma que são extratos legíveis e tenta novamente." };
  }

  const bankTx = bankStatement.transactions;
  const acctTx = acctStatement.transactions;
  const matchResults = matchStatements(bankTx, acctTx);

  const bankTxIds = bankTx.map(() => crypto.randomUUID());
  const acctTxIds = acctTx.map(() => crypto.randomUUID());

  const transactions: TransactionInsert[] = [
    ...bankTx.map((t, i) => ({
      id: bankTxIds[i],
      reconciliation_id: reconciliationId,
      source: "bank" as const,
      transaction_date: t.date,
      description: t.description,
      amount: round2(t.amount),
    })),
    ...acctTx.map((t, i) => ({
      id: acctTxIds[i],
      reconciliation_id: reconciliationId,
      source: "accounting" as const,
      transaction_date: t.date,
      description: t.description,
      amount: round2(t.amount),
    })),
  ];

  const matches: MatchInsert[] = matchResults.map((m) => ({
    id: crypto.randomUUID(),
    reconciliation_id: reconciliationId,
    bank_transaction_id: m.bankIndex != null ? bankTxIds[m.bankIndex] : null,
    accounting_transaction_id: m.accountingIndex != null ? acctTxIds[m.accountingIndex] : null,
    match_type: m.matchType,
    confidence: m.confidence,
    status: m.matchType === "exact" ? "confirmed" : "pending",
  }));

  const bankBalance = round2(bankStatement.closingBalance ?? bankTx.reduce((sum, t) => sum + t.amount, 0));
  const accountingBalance = round2(acctStatement.closingBalance ?? acctTx.reduce((sum, t) => sum + t.amount, 0));

  const { error: txError } = transactions.length ? await supabase.from("transactions").insert(transactions) : { error: null };
  const { error: matchError } = txError || !matches.length ? { error: txError } : await supabase.from("matches").insert(matches);

  await supabase
    .from("reconciliations")
    .update({
      status: txError || matchError ? "failed" : "completed",
      bank_balance: bankBalance,
      accounting_balance: accountingBalance,
      difference: round2(bankBalance - accountingBalance),
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
