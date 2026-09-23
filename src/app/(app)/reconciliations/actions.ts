"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { analyzeReconciliation, type ResultTx } from "@/lib/reconciliation/analyze";
import { UserFacingError } from "@/lib/reconciliation/errors";
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

  let result: Awaited<ReturnType<typeof analyzeReconciliation>>;
  try {
    const [bankBuf, acctBuf] = await Promise.all([bankFile.arrayBuffer(), accountingFile.arrayBuffer()]);
    result = await analyzeReconciliation(new Uint8Array(bankBuf), new Uint8Array(acctBuf));
  } catch (e) {
    await supabase.from("reconciliations").update({ status: "failed" }).eq("id", reconciliationId);
    if (e instanceof UserFacingError) return { error: e.message };
    console.error("[reconciliation] falha na análise:", e);
    return { error: "Não foi possível analisar um dos PDFs. Confirma que são extratos legíveis e tenta novamente." };
  }

  const transactions: TransactionInsert[] = [];
  const matches: MatchInsert[] = [];

  function txRow(source: "bank" | "accounting", t: ResultTx): string {
    const id = crypto.randomUUID();
    transactions.push({
      id,
      reconciliation_id: reconciliationId,
      source,
      transaction_date: t.date,
      description: t.description,
      amount: round2(t.amount),
      raw_data: { reference: t.reference, page: t.page },
    });
    return id;
  }

  // Reconciliados: grava-se o movimento real de cada lado (data, descrição e
  // valor do banco e do lançamento contabilístico), não o mesmo dos dois lados.
  for (const e of result.exact) {
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: txRow("bank", e.bank),
      accounting_transaction_id: txRow("accounting", e.accounting),
      match_type: "exact",
      confidence: round2(e.confidence),
      status: "confirmed",
    });
  }

  // Prováveis: os um-para-vários ficam ligados por group_id (uma linha de
  // match por cada movimento do lado com várias linhas).
  for (const p of result.probable) {
    const bankIds = p.bank.map((t) => txRow("bank", t));
    const acctIds = p.accounting.map((t) => txRow("accounting", t));
    const groupId = bankIds.length > 1 || acctIds.length > 1 ? crypto.randomUUID() : null;
    const pairs: [string, string][] =
      bankIds.length > 1 ? bankIds.map((b) => [b, acctIds[0]]) : acctIds.map((a) => [bankIds[0], a]);
    for (const [bankId, acctId] of pairs) {
      matches.push({
        id: crypto.randomUUID(),
        reconciliation_id: reconciliationId,
        bank_transaction_id: bankId,
        accounting_transaction_id: acctId,
        match_type: "probable",
        confidence: round2(p.confidence),
        note: p.reason,
        status: "pending",
        group_id: groupId,
      });
    }
  }

  for (const b of result.unmatchedBank) {
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: txRow("bank", b),
      accounting_transaction_id: null,
      match_type: "unmatched_bank",
      category: b.category,
      note: b.observation,
      status: "pending",
    });
  }

  for (const a of result.unmatchedAccounting) {
    matches.push({
      id: crypto.randomUUID(),
      reconciliation_id: reconciliationId,
      bank_transaction_id: null,
      accounting_transaction_id: txRow("accounting", a),
      match_type: "unmatched_accounting",
      category: a.category,
      note: a.observation,
      status: "pending",
    });
  }

  const { error: txError } = transactions.length ? await supabase.from("transactions").insert(transactions) : { error: null };
  const { error: matchError } = txError || !matches.length ? { error: txError } : await supabase.from("matches").insert(matches);

  const { error: updateError } = await supabase
    .from("reconciliations")
    .update({
      status: txError || matchError ? "failed" : "completed",
      bank_balance: result.bankClosingBalance,
      accounting_balance: result.accountingClosingBalance,
      bank_opening_balance: result.bankOpeningBalance,
      accounting_opening_balance: result.accountingOpeningBalance,
      extraction_verified: result.extractionVerified,
      difference: result.difference,
      closes: result.closes,
      summary: result.summary,
      issues: result.issues,
      next_steps: result.nextSteps,
    })
    .eq("id", reconciliationId);

  if (updateError) {
    console.error("[reconciliation] não foi possível gravar o resultado:", updateError);
    await supabase.from("reconciliations").update({ status: "failed" }).eq("id", reconciliationId);
    return { error: "Não foi possível guardar o resultado da conciliação. Tenta novamente." };
  }

  revalidatePath("/reconciliacao");
  redirect(`/reconciliations/${reconciliationId}`);
}

export async function updateMatchStatus(matchId: string, status: "confirmed" | "rejected", reconciliationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Confirmar/rejeitar um par provável um-para-vários aplica-se ao grupo todo.
  const { data: match } = await supabase.from("matches").select("group_id").eq("id", matchId).single();

  const patch = { status, reviewed_by: user.id, reviewed_at: new Date().toISOString() };
  const query = supabase.from("matches").update(patch);
  await (match?.group_id ? query.eq("group_id", match.group_id) : query.eq("id", matchId));

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
