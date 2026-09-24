import type { NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readAndStoreDocument } from "@/lib/reconciliation/flow";
import type { Db } from "@/lib/reconciliation/persist";

// PASSO 2: lê UM documento (PDF, Excel ou CSV) e guarda a tabela padrão. O
// browser chama esta rota uma vez por documento, em paralelo (as Server
// Actions correm em série, por isso a leitura não pode ser uma). A leitura
// pode incluir várias chamadas ao modelo (blocos de páginas, repetição):
// tempo máximo alargado (ver route segment config maxDuration).
export const maxDuration = 300;

export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string; source: string }> }) {
  const { id, source } = await ctx.params;
  if (source !== "bank" && source !== "accounting") {
    return Response.json({ ok: false, error: "Documento inválido." }, { status: 400 });
  }

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sessão expirada. Entra novamente." }, { status: 401 });

  // O RLS só deixa ver conciliações do próprio utilizador.
  const { data: reconciliation } = await db.from("reconciliations").select("id").eq("id", id).maybeSingle();
  if (!reconciliation) return Response.json({ ok: false, error: "Conciliação não encontrada." }, { status: 404 });

  // Registo interno da leitura (extraction_logs): se a chave de serviço não
  // estiver configurada, lê-se na mesma, sem registo.
  let admin: Db | null = null;
  try {
    admin = await createServiceRoleClient();
  } catch {
    admin = null;
  }

  const result = await readAndStoreDocument({ db, admin, reconciliationId: id, source });
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
