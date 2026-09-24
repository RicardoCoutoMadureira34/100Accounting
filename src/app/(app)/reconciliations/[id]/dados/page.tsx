import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FlowSteps } from "@/components/flow-steps";
import { KIND_LABEL } from "@/lib/reconciliation/errors";
import { fetchAllLines, reviewFromRows, type StatementDocRow } from "@/lib/reconciliation/flow";
import { describeProblem } from "@/lib/reconciliation/review";
import ReviewView from "./review-view";
import type { DocView, LineView, Source } from "./types";

// A Server Action "Reconciliar" corre a partir desta página (matching + texto
// do relatório): tempo máximo alargado.
export const maxDuration = 120;

// Uma leitura "a decorrer" há mais de 4 minutos perdeu-se (o pedido morreu).
const STALE_READING_MS = 4 * 60 * 1000;

async function resetStaleReadings(db: Awaited<ReturnType<typeof createClient>>, docs: StatementDocRow[]) {
  const now = Date.now();
  for (const d of docs) {
    if (d.read_status === "reading" && now - new Date(d.updated_at).getTime() > STALE_READING_MS) {
      await db.from("statement_documents").update({ read_status: "pending" }).eq("id", d.id);
      d.read_status = "pending";
    }
  }
}

export default async function DadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: reconciliation } = await supabase.from("reconciliations").select("id, status").eq("id", id).maybeSingle();
  if (!reconciliation) notFound();

  const { data: docRows } = await supabase.from("statement_documents").select("*").eq("reconciliation_id", id);
  const docs: StatementDocRow[] = docRows ?? [];

  if (docs.length === 0) {
    return (
      <div>
        <Link href="/reconciliacao" className="text-xs font-medium text-foreground/50 hover:text-foreground">
          ← Conciliações
        </Link>
        <div className="mt-4 rounded-xl border border-black/10 bg-white px-6 py-10 text-center text-sm text-foreground/60">
          Esta conciliação foi criada antes do passo de preparação de dados e não tem dados guardados.
          <div className="mt-3">
            <Link href={`/reconciliations/${id}`} className="font-semibold text-accent-600 hover:underline">
              Ver o relatório
            </Link>
          </div>
        </div>
      </div>
    );
  }

  await resetStaleReadings(supabase, docs);

  const anyReady = docs.some((d) => d.read_status === "ready");
  const lines = anyReady ? await fetchAllLines(supabase, id) : [];

  const view = (source: Source): DocView | null => {
    const doc = docs.find((d) => d.source === source);
    if (!doc) return null;
    const docLines = lines.filter((l) => l.source === source);
    const review = reviewFromRows(source, doc, docLines);
    const lineViews: LineView[] = docLines.map((l, i) => {
      const amount = Number(l.amount);
      const calculated = review.computedBalanceCents[i];
      return {
        id: l.id,
        position: l.position,
        date: l.date,
        description: l.description,
        reference: l.reference,
        entrada: amount > 0 ? amount : null,
        saida: amount < 0 ? -amount : null,
        saldo: l.balance_after == null ? null : Number(l.balance_after),
        calculado: calculated == null ? null : calculated / 100,
        edited: l.edited,
        origin: l.origin,
      };
    });
    return {
      source,
      label: KIND_LABEL[source],
      fileName: doc.file_name,
      format: doc.file_format as DocView["format"],
      readStatus: doc.read_status as DocView["readStatus"],
      readError: doc.read_error,
      sourceName: doc.source_name,
      openingBalance: doc.opening_balance == null ? null : Number(doc.opening_balance),
      closingBalance: doc.closing_balance == null ? null : Number(doc.closing_balance),
      lines: lineViews,
      ok: doc.read_status === "ready" && review.ok,
      verifiable: review.verifiable,
      problem: doc.read_status === "ready" && !review.ok ? describeProblem(review) : null,
      firstBadIndex: review.firstBadIndex,
      totalIn: review.totalInCents / 100,
      totalOut: review.totalOutCents / 100,
      hasBalanceColumn: review.hasBalanceColumn,
      differenceCents: review.differenceCents,
      issues: Array.isArray(doc.issues) ? (doc.issues as unknown[]).filter((i): i is string => typeof i === "string") : [],
    };
  };

  const views = [view("bank"), view("accounting")].filter((v): v is DocView => v !== null);
  const resultReady = reconciliation.status === "completed" || reconciliation.status === "failed";

  return (
    <div>
      <Link href="/reconciliacao" className="text-xs font-medium text-foreground/50 hover:text-foreground">
        ← Conciliações
      </Link>
      <div className="mt-2">
        <FlowSteps current={2} hrefs={{ 1: "/reconciliacao", ...(resultReady ? { 3: `/reconciliations/${id}` } : {}) }} />
        <h1 className="text-xl font-bold text-brand-700">Confirmar leitura</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Confirma que os movimentos e os saldos lidos de cada extrato estão certos. Podes corrigir, apagar ou acrescentar
          linhas antes de reconciliar.
        </p>
      </div>
      <ReviewView reconciliationId={id} docs={views} />
    </div>
  );
}
