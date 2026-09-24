"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { detectFormat, type FileFormat } from "@/lib/reconciliation/file-format";

export type ActionState = { error: string | null };

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

// Extensão guardada no armazenamento (a leitura usa o formato detetado).
function storageExtension(name: string, format: FileFormat): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (format === "pdf") return "pdf";
  if (format === "csv") return "csv";
  return ext === "xls" ? "xls" : "xlsx";
}

// PASSO 1: carregar os dois ficheiros (PDF, Excel ou CSV). Só guarda os
// ficheiros e cria a conciliação em "review"; a leitura corre no passo 2, um
// pedido por documento e em paralelo (as Server Actions correm em série).
export async function createReconciliation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const bankFile = formData.get("bank_file") as File | null;
  const accountingFile = formData.get("accounting_file") as File | null;

  if (!bankFile || bankFile.size === 0 || !accountingFile || accountingFile.size === 0) {
    return { error: "Carrega os dois ficheiros: o extrato bancário e o extrato da contabilidade." };
  }

  const detect = async (file: File) =>
    detectFormat({ name: file.name, bytes: new Uint8Array(await file.slice(0, 8).arrayBuffer()) });
  const [bankFormat, accountingFormat] = await Promise.all([detect(bankFile), detect(accountingFile)]);
  if (!bankFormat || !accountingFormat) {
    const which = !bankFormat ? "O extrato bancário" : "O extrato da contabilidade";
    return { error: `${which} tem um formato não suportado. Usa PDF, Excel (.xlsx, .xls) ou CSV.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const reconciliationId = crypto.randomUUID();
  const basePath = `${user.id}/${reconciliationId}`;
  const bankExt = storageExtension(bankFile.name, bankFormat);
  const accountingExt = storageExtension(accountingFile.name, accountingFormat);
  const bankPath = `${basePath}/extrato-bancario.${bankExt}`;
  const accountingPath = `${basePath}/extrato-contabilidade.${accountingExt}`;

  const [bankUpload, accountingUpload] = await Promise.all([
    supabase.storage.from("statements").upload(bankPath, bankFile, { contentType: CONTENT_TYPES[bankExt] }),
    supabase.storage.from("statements").upload(accountingPath, accountingFile, { contentType: CONTENT_TYPES[accountingExt] }),
  ]);
  if (bankUpload.error || accountingUpload.error) {
    return { error: "Não foi possível carregar os ficheiros. Tenta novamente." };
  }

  const { error: insertError } = await supabase.from("reconciliations").insert({
    id: reconciliationId,
    status: "review",
    bank_statement_path: bankPath,
    accounting_statement_path: accountingPath,
    created_by: user.id,
  });
  if (insertError) {
    return { error: "Não foi possível criar a conciliação." };
  }

  const { error: docsError } = await supabase.from("statement_documents").insert([
    { reconciliation_id: reconciliationId, source: "bank", file_name: bankFile.name, file_format: bankFormat },
    { reconciliation_id: reconciliationId, source: "accounting", file_name: accountingFile.name, file_format: accountingFormat },
  ]);
  if (docsError) {
    console.error("[reconciliation] statement_documents:", docsError.message);
    await supabase.from("reconciliations").delete().eq("id", reconciliationId);
    return { error: "Não foi possível preparar a conciliação. Tenta novamente." };
  }

  revalidatePath("/reconciliacao");
  redirect(`/reconciliations/${reconciliationId}/dados`);
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
