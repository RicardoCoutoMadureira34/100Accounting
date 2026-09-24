import type { Database } from "../supabase/database.types";
import type { ModelClient } from "./anthropic";
import { KIND_LABEL, UserFacingError, type StatementKind } from "./errors";
import { extractStatement, type ExtractedStatement } from "./extract";
import { deleteStoredResult, saveReconciliationResult, type Db } from "./persist";
import { reconcileStatements, type ReconcileInput } from "./reconcile";
import { decideStepTwo, reviewStatement, type Review, type ReviewDoc } from "./review";
import { unverifiedWarning } from "./verify";

// Lógica dos passos 2 e 3 sobre a base de dados. As Server Actions e as rotas
// são só a "casca" (autenticação e respostas); tudo o que toca em dados está
// aqui para se poder testar e reutilizar.

export type StatementDocRow = Database["public"]["Tables"]["statement_documents"]["Row"];
export type StatementLineRow = Database["public"]["Tables"]["statement_lines"]["Row"];

export type FlowResult = { ok: true } | { ok: false; error: string };

const STORAGE_BUCKET = "statements";
const PAGE = 1000;

// PostgREST devolve no máximo 1000 linhas por pedido.
export async function fetchAllLines(db: Db, reconciliationId: string, source?: StatementKind): Promise<StatementLineRow[]> {
  const all: StatementLineRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("statement_lines")
      .select("*")
      .eq("reconciliation_id", reconciliationId)
      .order("source", { ascending: true })
      .order("position", { ascending: true })
      .range(from, from + PAGE - 1);
    if (source) q = q.eq("source", source);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export const docToReviewDoc = (d: StatementDocRow): ReviewDoc => ({
  openingBalance: d.opening_balance,
  closingBalance: d.closing_balance,
  totalDebits: d.total_debits,
  totalCredits: d.total_credits,
  openingRowDebits: d.opening_row_debits,
  openingRowCredits: d.opening_row_credits,
});

export function reviewFromRows(kind: StatementKind, doc: StatementDocRow, lines: StatementLineRow[]): Review {
  return reviewStatement(
    kind,
    docToReviewDoc(doc),
    lines.map((l) => ({
      date: l.date,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      balanceAfter: l.balance_after,
    }))
  );
}

// ---------- registo (extraction_logs) ----------
// Sem descrições nem valores individuais; falhar aqui nunca pode partir o fluxo.

interface LogEntry {
  reconciliationId: string;
  source: StatementKind;
  fileFormat: string;
  sourceName: string | null;
  lineCount: number;
  verified: boolean;
  differenceEur: number | null;
  retried: boolean;
}

async function insertExtractionLog(admin: Db | null, e: LogEntry): Promise<void> {
  if (!admin) return;
  try {
    const { error } = await admin.from("extraction_logs").insert({
      reconciliation_id: e.reconciliationId,
      source: e.source,
      file_format: e.fileFormat,
      source_name: e.sourceName,
      line_count: e.lineCount,
      verified: e.verified,
      difference_eur: e.differenceEur,
      retried: e.retried,
    });
    if (error) console.error("[extraction_logs] insert:", error.message);
  } catch (err) {
    console.error("[extraction_logs] insert:", err);
  }
}

async function updateEditedLines(admin: Db | null, reconciliationId: string, source: StatementKind, edited: number): Promise<void> {
  if (!admin) return;
  try {
    const { data } = await admin
      .from("extraction_logs")
      .select("id")
      .eq("reconciliation_id", reconciliationId)
      .eq("source", source)
      .order("created_at", { ascending: false })
      .limit(1);
    const id = data?.[0]?.id;
    if (id) await admin.from("extraction_logs").update({ edited_lines: edited }).eq("id", id);
  } catch (err) {
    console.error("[extraction_logs] update:", err);
  }
}

async function markStepTwo(admin: Db | null, reconciliationId: string, skipped: boolean): Promise<void> {
  if (!admin) return;
  try {
    // Só a leitura mais recente de cada documento (as anteriores já foram decididas).
    for (const source of ["bank", "accounting"] as const) {
      const { data } = await admin
        .from("extraction_logs")
        .select("id")
        .eq("reconciliation_id", reconciliationId)
        .eq("source", source)
        .order("created_at", { ascending: false })
        .limit(1);
      const id = data?.[0]?.id;
      if (id) await admin.from("extraction_logs").update({ step2_skipped: skipped }).eq("id", id);
    }
  } catch (err) {
    console.error("[extraction_logs] step2:", err);
  }
}

// ---------- passo 2 automático: saltar quando a leitura está confirmada ----------

export type StepTwoCheck = { ok: true; skip: boolean } | { ok: false; error: string };

// Depois de os dois documentos serem lidos: o passo 2 é preciso? Regista a decisão.
export async function checkStepTwo(args: { db: Db; admin: Db | null; reconciliationId: string }): Promise<StepTwoCheck> {
  const { db, admin, reconciliationId } = args;
  const { data: docs } = await db.from("statement_documents").select("*").eq("reconciliation_id", reconciliationId);
  const bankDoc = docs?.find((d) => d.source === "bank");
  const acctDoc = docs?.find((d) => d.source === "accounting");
  if (!bankDoc || !acctDoc) return { ok: false, error: "Faltam os dados de um dos extratos." };
  if (bankDoc.read_status !== "ready" || acctDoc.read_status !== "ready") return { ok: true, skip: false };

  const lines = await fetchAllLines(db, reconciliationId);
  let skip = true;
  for (const [kind, doc] of [
    ["bank", bankDoc],
    ["accounting", acctDoc],
  ] as const) {
    const docLines = lines.filter((l) => l.source === kind);
    const decision = decideStepTwo({
      format: doc.file_format as "pdf" | "xlsx" | "csv",
      review: reviewFromRows(kind, doc, docLines),
      conversionProblems: doc.conversion_problems,
      lineCount: docLines.length,
    });
    if (!decision.skip) skip = false;
  }
  await markStepTwo(admin, reconciliationId, skip);
  return { ok: true, skip };
}

// ---------- passo 2: ler um documento e guardar a tabela padrão ----------

function lineRows(reconciliationId: string, source: StatementKind, ex: ExtractedStatement): Database["public"]["Tables"]["statement_lines"]["Insert"][] {
  return ex.lines.map((l) => ({
    reconciliation_id: reconciliationId,
    source,
    position: l.position,
    date: l.date,
    description: l.description,
    reference: l.reference,
    debit: l.debit,
    credit: l.credit,
    amount: l.amountCents / 100,
    balance_after: l.balanceAfter,
    origin: l.origin,
    edited: false,
  }));
}

export async function readAndStoreDocument(args: {
  db: Db;
  admin: Db | null;
  reconciliationId: string;
  source: StatementKind;
  client?: ModelClient;
}): Promise<FlowResult> {
  const { db, admin, reconciliationId, source } = args;
  const label = KIND_LABEL[source];

  const { data: doc } = await db
    .from("statement_documents")
    .select("*")
    .eq("reconciliation_id", reconciliationId)
    .eq("source", source)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Ficheiro não encontrado." };

  const { data: recon } = await db
    .from("reconciliations")
    .select("bank_statement_path, accounting_statement_path")
    .eq("id", reconciliationId)
    .maybeSingle();
  const path = source === "bank" ? recon?.bank_statement_path : recon?.accounting_statement_path;
  if (!path) return { ok: false, error: "Ficheiro não encontrado." };

  await db.from("statement_documents").update({ read_status: "reading", read_error: null }).eq("id", doc.id);

  try {
    const { data: blob, error: downloadError } = await db.storage.from(STORAGE_BUCKET).download(path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "download falhou");
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const ex = await extractStatement(source, { name: doc.file_name, bytes }, { client: args.client });

    // Substitui as linhas anteriores (releitura) pelas novas.
    const del = await db.from("statement_lines").delete().eq("reconciliation_id", reconciliationId).eq("source", source);
    if (del.error) throw new Error(del.error.message);
    const rows = lineRows(reconciliationId, source, ex);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("statement_lines").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    const { error: updateError } = await db
      .from("statement_documents")
      .update({
        read_status: "ready",
        read_error: null,
        source_name: ex.sourceName,
        period_start: ex.periodStart,
        period_end: ex.periodEnd,
        opening_balance: ex.openingBalance,
        closing_balance: ex.closingBalance,
        total_debits: ex.totalDebits,
        total_credits: ex.totalCredits,
        opening_row_debits: ex.openingRowDebits,
        opening_row_credits: ex.openingRowCredits,
        issues: ex.readIssues,
        retried: ex.retried,
        conversion_problems: ex.conversionProblems,
        lines_deleted: 0,
      })
      .eq("id", doc.id);
    if (updateError) throw new Error(updateError.message);

    await insertExtractionLog(admin, {
      reconciliationId,
      source,
      fileFormat: ex.format,
      sourceName: ex.sourceName,
      lineCount: ex.lines.length,
      verified: ex.verified,
      differenceEur: ex.verification.equation ? ex.verification.equation.diff : null,
      retried: ex.retried,
    });
    return { ok: true };
  } catch (e) {
    const message =
      e instanceof UserFacingError ? e.message : `Não foi possível ler o ${label}. Confirma que o ficheiro é um extrato e tenta novamente.`;
    if (!(e instanceof UserFacingError)) console.error(`[reconciliation] leitura do ${label} falhou:`, e);
    await db.from("statement_documents").update({ read_status: "failed", read_error: message }).eq("id", doc.id);
    return { ok: false, error: message };
  }
}

// ---------- passo 3: reconciliar a partir das linhas guardadas ----------

function reconcileInput(kind: StatementKind, doc: StatementDocRow, lines: StatementLineRow[], review: Review): ReconcileInput {
  const issues = Array.isArray(doc.issues) ? (doc.issues as unknown[]).filter((i): i is string => typeof i === "string") : [];
  if (!review.ok) issues.push(unverifiedWarning(kind, review.verification));
  return {
    openingBalance: doc.opening_balance,
    closingBalance: doc.closing_balance,
    verified: review.ok,
    issues,
    lines: lines.map((l) => ({
      position: l.position,
      date: l.date,
      description: l.description,
      reference: l.reference,
      cents: Math.round(Number(l.amount) * 100),
      origin: l.origin,
    })),
  };
}

export async function reconcileStoredLines(args: {
  db: Db;
  admin: Db | null;
  reconciliationId: string;
  client?: ModelClient;
}): Promise<FlowResult> {
  const { db, admin, reconciliationId } = args;

  const { data: docs } = await db.from("statement_documents").select("*").eq("reconciliation_id", reconciliationId);
  const bankDoc = docs?.find((d) => d.source === "bank");
  const acctDoc = docs?.find((d) => d.source === "accounting");
  if (!bankDoc || !acctDoc) return { ok: false, error: "Faltam os dados de um dos extratos." };
  if (bankDoc.read_status !== "ready" || acctDoc.read_status !== "ready") {
    return { ok: false, error: "A leitura dos extratos ainda não terminou." };
  }

  const lines = await fetchAllLines(db, reconciliationId);
  const bankLines = lines.filter((l) => l.source === "bank");
  const acctLines = lines.filter((l) => l.source === "accounting");
  if (bankLines.length === 0 || acctLines.length === 0) {
    return { ok: false, error: "Um dos extratos não tem movimentos." };
  }

  const bankReview = reviewFromRows("bank", bankDoc, bankLines);
  const acctReview = reviewFromRows("accounting", acctDoc, acctLines);

  await db.from("reconciliations").update({ status: "processing" }).eq("id", reconciliationId);

  try {
    const cleaned = await deleteStoredResult(db, reconciliationId);
    if (cleaned) throw new Error(`apagar resultado anterior: ${cleaned.message}`);

    const result = await reconcileStatements(
      reconcileInput("bank", bankDoc, bankLines, bankReview),
      reconcileInput("accounting", acctDoc, acctLines, acctReview),
      { client: args.client }
    );

    const saveError = await saveReconciliationResult(db, reconciliationId, result);

    const { error: updateError } = await db
      .from("reconciliations")
      .update({
        status: saveError ? "failed" : "completed",
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
    if (updateError) throw new Error(updateError.message);
    if (saveError) throw new Error(`gravar resultado: ${saveError.message}`);

    // Para o registo: quantas linhas o utilizador corrigiu (editadas, acrescentadas ou apagadas).
    for (const [source, docRow, docLines] of [
      ["bank", bankDoc, bankLines],
      ["accounting", acctDoc, acctLines],
    ] as const) {
      await updateEditedLines(admin, reconciliationId, source, docLines.filter((l) => l.edited).length + docRow.lines_deleted);
    }
    return { ok: true };
  } catch (e) {
    console.error("[reconciliation] reconciliar falhou:", e);
    // Volta ao passo 2 para o utilizador poder tentar de novo.
    await db.from("reconciliations").update({ status: "review" }).eq("id", reconciliationId);
    return { ok: false, error: "Não foi possível reconciliar. Tenta novamente." };
  }
}
