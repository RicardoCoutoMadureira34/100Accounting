import { notFound } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// Registo interno da qualidade da leitura dos extratos. Só o email definido em
// ADMIN_EMAIL entra. Não guarda descrições nem valores de movimentos.
export const dynamic = "force-dynamic";

const FORMAT_LABEL: Record<string, string> = { pdf: "PDF", xlsx: "Excel", csv: "CSV" };

export default async function AdminLogsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!user || !admin || user.email?.toLowerCase() !== admin) notFound();

  const db = await createServiceRoleClient();
  const { data: logs, error } = await db.from("extraction_logs").select("*").order("created_at", { ascending: false }).limit(300);

  const rows = logs ?? [];
  const total = rows.length;
  const verified = rows.filter((r) => r.verified).length;
  const retried = rows.filter((r) => r.retried).length;
  const edited = rows.reduce((s, r) => s + r.edited_lines, 0);
  const pct = (n: number) => (total === 0 ? "-" : `${Math.round((n / total) * 100)}%`);

  return (
    <div>
      <h1 className="text-xl font-bold text-brand-700">Registo de leituras</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Uma linha por documento lido. Sem descrições nem valores de movimentos. Mostra as últimas {rows.length} leituras.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2.5 text-sm font-medium text-danger-600">
          Não foi possível ler o registo: {error.message}
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Tile label="Leituras" value={String(total)} />
        <Tile label="Verificadas" value={pct(verified)} />
        <Tile label="Com repetição" value={pct(retried)} />
        <Tile label="Linhas editadas" value={String(edited)} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2.5 font-semibold">Data</th>
              <th className="px-4 py-2.5 font-semibold">Documento</th>
              <th className="px-4 py-2.5 font-semibold">Formato</th>
              <th className="px-4 py-2.5 font-semibold">Banco / programa</th>
              <th className="px-4 py-2.5 text-right font-semibold">Linhas</th>
              <th className="px-4 py-2.5 font-semibold">Verificação</th>
              <th className="px-4 py-2.5 text-right font-semibold">Diferença</th>
              <th className="px-4 py-2.5 font-semibold">Repetição</th>
              <th className="px-4 py-2.5 font-semibold">Passo 2</th>
              <th className="px-4 py-2.5 text-right font-semibold">Editadas</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-foreground/40">
                  Ainda não há leituras registadas.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-foreground/60">
                    {new Date(r.created_at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-2">{r.source === "bank" ? "Banco" : "Contabilidade"}</td>
                  <td className="px-4 py-2">{FORMAT_LABEL[r.file_format] ?? r.file_format}</td>
                  <td className="px-4 py-2 text-foreground/70">{r.source_name ?? "-"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.line_count}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        r.verified ? "bg-accent-50 text-accent-600" : "bg-danger-50 text-danger-600"
                      }`}
                    >
                      {r.verified ? "ok" : "falhou"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {r.difference_eur == null ? "-" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(r.difference_eur)}
                  </td>
                  <td className="px-4 py-2">{r.retried ? "sim" : "não"}</td>
                  <td className="px-4 py-2">{r.step2_skipped == null ? "-" : r.step2_skipped ? "saltado" : "mostrado"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.edited_lines}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-foreground/55">{label}</p>
      <p className="mt-2 font-mono text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
