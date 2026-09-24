"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { POSITION_STEP } from "@/lib/reconciliation/extract";
import { checkStepTwo, reconcileStoredLines } from "@/lib/reconciliation/flow";
import type { Db } from "@/lib/reconciliation/persist";
import { columnsFromInOut } from "@/lib/reconciliation/review";
import type { StatementKind } from "@/lib/reconciliation/errors";
import { normalizeDate } from "@/lib/reconciliation/extract";

export type EditResult = { error?: string };

export interface LineInput {
  date: string;
  description: string;
  reference: string | null;
  entrada: number | null;
  saida: number | null;
  saldo: number | null;
}

async function requireUser() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return { db, user };
}

function validate(input: LineInput): { error?: string; date?: string } {
  const date = normalizeDate(input.date);
  if (!date) return { error: "A data não é válida (usa AAAA-MM-DD ou DD/MM/AAAA)." };
  if (input.entrada != null && input.saida != null && input.entrada !== 0 && input.saida !== 0) {
    return { error: "Preenche só a entrada ou só a saída." };
  }
  if (input.entrada == null && input.saida == null) return { error: "Indica o valor da entrada ou da saída." };
  return { date };
}

// Depois de mexer nos dados, o resultado antigo deixa de valer: volta a "review".
async function markForReview(db: Db, reconciliationId: string) {
  await db.from("reconciliations").update({ status: "review" }).eq("id", reconciliationId).in("status", ["completed", "failed"]);
  revalidatePath(`/reconciliations/${reconciliationId}/dados`);
  revalidatePath(`/reconciliations/${reconciliationId}`);
}

export async function updateLine(reconciliationId: string, lineId: string, input: LineInput): Promise<EditResult> {
  const { db, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const checked = validate(input);
  if (checked.error) return { error: checked.error };

  const { data: line } = await db.from("statement_lines").select("source").eq("id", lineId).eq("reconciliation_id", reconciliationId).maybeSingle();
  if (!line) return { error: "Linha não encontrada." };

  const cols = columnsFromInOut(line.source as StatementKind, input.entrada, input.saida);
  const { error } = await db
    .from("statement_lines")
    .update({
      date: checked.date!,
      description: input.description.trim(),
      reference: input.reference?.trim() || null,
      debit: cols.debit,
      credit: cols.credit,
      amount: cols.amountCents / 100,
      balance_after: input.saldo,
      edited: true,
    })
    .eq("id", lineId);
  if (error) return { error: "Não foi possível guardar a linha." };

  await markForReview(db, reconciliationId);
  return {};
}

export async function deleteLine(reconciliationId: string, lineId: string): Promise<EditResult> {
  const { db, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const { data: line } = await db.from("statement_lines").select("source").eq("id", lineId).eq("reconciliation_id", reconciliationId).maybeSingle();
  if (!line) return { error: "Linha não encontrada." };

  const { error } = await db.from("statement_lines").delete().eq("id", lineId);
  if (error) return { error: "Não foi possível apagar a linha." };

  // Conta as linhas apagadas para o registo de qualidade da leitura.
  const { data: doc } = await db
    .from("statement_documents")
    .select("id, lines_deleted")
    .eq("reconciliation_id", reconciliationId)
    .eq("source", line.source)
    .maybeSingle();
  if (doc) await db.from("statement_documents").update({ lines_deleted: doc.lines_deleted + 1 }).eq("id", doc.id);

  await markForReview(db, reconciliationId);
  return {};
}

// Acrescenta uma linha depois da posição indicada (0 = no início).
export async function insertLine(reconciliationId: string, source: StatementKind, afterPosition: number, input: LineInput): Promise<EditResult> {
  const { db, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const checked = validate(input);
  if (checked.error) return { error: checked.error };

  const { data: existing } = await db
    .from("statement_lines")
    .select("position")
    .eq("reconciliation_id", reconciliationId)
    .eq("source", source)
    .order("position", { ascending: true });
  const positions = (existing ?? []).map((r) => r.position);

  // As posições têm intervalos (1000, 2000, ...): a nova linha fica a meio. Se
  // já não houver espaço, renumeram-se todas.
  const next = positions.find((p) => p > afterPosition);
  let position = next == null ? afterPosition + POSITION_STEP : Math.floor((afterPosition + next) / 2);
  if (next != null && (position <= afterPosition || position >= next)) {
    const { data: rows } = await db
      .from("statement_lines")
      .select("id, position")
      .eq("reconciliation_id", reconciliationId)
      .eq("source", source)
      .order("position", { ascending: true });
    const renumbered = (rows ?? []).map((r, i) => ({ id: r.id, position: (i + 1) * POSITION_STEP * 10 }));
    for (const r of renumbered) await db.from("statement_lines").update({ position: r.position }).eq("id", r.id);
    const anchorIndex = (rows ?? []).filter((r) => r.position <= afterPosition).length;
    position = anchorIndex * POSITION_STEP * 10 + POSITION_STEP * 5;
  }

  const cols = columnsFromInOut(source, input.entrada, input.saida);
  const { error } = await db.from("statement_lines").insert({
    reconciliation_id: reconciliationId,
    source,
    position,
    date: checked.date!,
    description: input.description.trim(),
    reference: input.reference?.trim() || null,
    debit: cols.debit,
    credit: cols.credit,
    amount: cols.amountCents / 100,
    balance_after: input.saldo,
    origin: "manual",
    edited: true,
  });
  if (error) return { error: "Não foi possível acrescentar a linha." };

  await markForReview(db, reconciliationId);
  return {};
}

// Depois da leitura dos dois documentos: o passo 2 pode ser saltado?
export async function checkStepTwoAction(reconciliationId: string): Promise<{ error?: string; skip?: boolean }> {
  const { db, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  let admin: Db | null = null;
  try {
    admin = await createServiceRoleClient();
  } catch {
    admin = null;
  }
  try {
    const result = await checkStepTwo({ db, admin, reconciliationId });
    return result.ok ? { skip: result.skip } : { error: result.error };
  } catch (e) {
    console.error("[reconciliation] verificar passo 2 falhou:", e);
    // Na dúvida mostra-se o passo 2.
    return { skip: false };
  }
}

// PASSO 3: reconciliar a partir das linhas guardadas (já confirmadas).
export async function reconcile(reconciliationId: string): Promise<EditResult> {
  const { db, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  let admin: Db | null = null;
  try {
    admin = await createServiceRoleClient();
  } catch {
    admin = null;
  }

  const result = await reconcileStoredLines({ db, admin, reconciliationId });
  if (!result.ok) return { error: result.error };

  revalidatePath("/reconciliacao");
  redirect(`/reconciliations/${reconciliationId}`);
}
