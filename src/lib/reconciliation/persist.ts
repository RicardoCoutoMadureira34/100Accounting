import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { ReconciliationResult, ResultTx } from "./reconcile";

export type Db = SupabaseClient<Database>;

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"];

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function insertInChunks<T extends "transactions" | "matches">(
  db: Db,
  table: T,
  rows: Database["public"]["Tables"][T]["Insert"][],
  size = 500
): Promise<{ message: string } | null> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size) as never);
    if (error) return error;
  }
  return null;
}

// Apaga o resultado anterior (matches e transações) de uma conciliação, para
// poder reconciliar de novo depois de corrigir os dados.
export async function deleteStoredResult(db: Db, reconciliationId: string): Promise<{ message: string } | null> {
  const m = await db.from("matches").delete().eq("reconciliation_id", reconciliationId);
  if (m.error) return m.error;
  const t = await db.from("transactions").delete().eq("reconciliation_id", reconciliationId);
  return t.error ?? null;
}

// Grava o resultado como sempre: transações reais de cada lado + matches
// (exatos, prováveis com group_id nos um-para-vários, sem correspondência).
export async function saveReconciliationResult(
  db: Db,
  reconciliationId: string,
  result: ReconciliationResult
): Promise<{ message: string } | null> {
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
      raw_data: { reference: t.reference, origin: t.origin },
    });
    return id;
  }

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

  // Um-para-vários: uma linha de match por cada movimento do lado com várias linhas.
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

  const txError = await insertInChunks(db, "transactions", transactions);
  if (txError) return txError;
  return insertInChunks(db, "matches", matches);
}
