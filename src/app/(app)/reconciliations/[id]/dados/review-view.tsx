"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseAmount } from "@/lib/reconciliation/number-parse";
import { checkStepTwoAction, deleteLine, insertLine, reconcile, updateLine, type LineInput } from "./actions";
import type { DocView, LineView, Source } from "./types";

const euro = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);

const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const FORMAT_LABEL: Record<DocView["format"], string> = { pdf: "PDF", xlsx: "Excel", csv: "CSV" };

export default function ReviewView({ reconciliationId, docs }: { reconciliationId: string; docs: DocView[] }) {
  const router = useRouter();
  const started = useRef<Set<Source>>(new Set());
  const [phase, setPhase] = useState<Partial<Record<Source, "reading" | "error">>>({});
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconciling, startReconcile] = useTransition();
  // Fluxo automático (leitura acabada de fazer): se está tudo confirmado, o passo 2 nem aparece.
  const [stage, setStage] = useState<"reading" | "confirmed" | "reconciling" | null>(() =>
    docs.some((d) => d.readStatus === "pending") ? "reading" : null
  );
  const [readDone, setReadDone] = useState<Partial<Record<Source, boolean>>>({});

  // Passo 2: cada documento por ler é lido num pedido próprio, em paralelo.
  async function readDocument(source: Source): Promise<boolean> {
    setPhase((p) => ({ ...p, [source]: "reading" }));
    setErrors((e) => ({ ...e, [source]: undefined }));
    try {
      const res = await fetch(`/api/reconciliations/${reconciliationId}/read/${source}`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setErrors((e) => ({ ...e, [source]: body.error ?? "Não foi possível ler o ficheiro." }));
        setPhase((p) => ({ ...p, [source]: "error" }));
        return false;
      }
    } catch {
      setErrors((e) => ({ ...e, [source]: "Não foi possível ler o ficheiro. Tenta novamente." }));
      setPhase((p) => ({ ...p, [source]: "error" }));
      return false;
    }
    setPhase((p) => ({ ...p, [source]: undefined }));
    setReadDone((d) => ({ ...d, [source]: true }));
    return true;
  }

  // Depois da leitura: passo 2 desnecessário -> reconcilia logo; senão mostra os dados.
  async function afterReads(allRead: boolean) {
    if (!allRead) {
      setStage(null);
      router.refresh();
      return;
    }
    const check = await checkStepTwoAction(reconciliationId);
    if (check.error || !check.skip) {
      setStage(null);
      router.refresh();
      return;
    }
    setStage("confirmed");
    await new Promise((resolve) => setTimeout(resolve, 700));
    setStage("reconciling");
    const result = await reconcile(reconciliationId);
    // Com sucesso a ação redireciona para o resultado; se chegou aqui, falhou.
    setReconcileError(result?.error ?? "Não foi possível reconciliar. Tenta novamente.");
    setStage(null);
    router.refresh();
  }

  useEffect(() => {
    const pending = docs.filter((d) => d.readStatus === "pending" && !started.current.has(d.source));
    if (pending.length === 0) return;
    pending.forEach((d) => started.current.add(d.source));
    void Promise.all(pending.map((d) => readDocument(d.source))).then((results) => afterReads(results.every(Boolean)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  // Leitura iniciada noutro separador ou pedido perdido: volta a verificar.
  useEffect(() => {
    const waiting = docs.some((d) => d.readStatus === "reading" && !started.current.has(d.source));
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [docs, router]);

  function retry(source: Source) {
    started.current.add(source);
    setStage("reading");
    void readDocument(source).then((ok) => afterReads(ok));
  }

  const allReady = docs.length === 2 && docs.every((d) => d.readStatus === "ready");
  const problems = docs.filter((d) => d.readStatus === "ready" && !d.ok);

  function startReconcileNow() {
    setReconcileError(null);
    startReconcile(async () => {
      const result = await reconcile(reconciliationId);
      if (result?.error) setReconcileError(result.error);
    });
  }

  function onReconcileClick() {
    if (problems.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    startReconcileNow();
  }

  if (stage) return <ProcessingPanel docs={docs} readDone={readDone} stage={stage} />;

  return (
    <div className="mt-6 flex flex-col gap-6">
      {docs.map((doc) => {
        const local = phase[doc.source];
        const failedMessage = errors[doc.source] ?? (doc.readStatus === "failed" ? doc.readError : null);
        if (doc.readStatus !== "ready") {
          return (
            <ReadingCard
              key={doc.source}
              doc={doc}
              reading={local === "reading" || doc.readStatus === "reading" || (doc.readStatus === "pending" && local !== "error")}
              error={local === "error" || doc.readStatus === "failed" ? (failedMessage ?? "Não foi possível ler o ficheiro.") : null}
              onRetry={() => retry(doc.source)}
            />
          );
        }
        return <DocumentBlock key={doc.source} reconciliationId={reconciliationId} doc={doc} disabled={reconciling} />;
      })}

      {allReady && (
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          {confirming && problems.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {problems.map((d) => (
                <p key={d.source}>
                  {d.differenceCents
                    ? `A leitura do ${d.label} não bate certo por ${euro(Math.abs(d.differenceCents) / 100)}.`
                    : `Não foi possível confirmar a leitura do ${d.label} automaticamente.`}
                </p>
              ))}
              <p className="mt-1 font-semibold">Queres continuar mesmo assim?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={startReconcileNow}
                  disabled={reconciling}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {reconciling ? "A reconciliar…" : "Continuar mesmo assim"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={reconciling}
                  className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-foreground/70 ring-1 ring-black/10 transition hover:bg-black/[0.03]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {reconcileError && <p className="mb-3 rounded-lg bg-danger-50 px-3 py-2.5 text-sm font-medium text-danger-600">{reconcileError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-foreground/50">
              {problems.length === 0
                ? "Os dois extratos foram lidos e os saldos batem certo."
                : "Corrige as linhas assinaladas ou continua mesmo assim."}
            </p>
            {!confirming && (
              <button
                onClick={onReconcileClick}
                disabled={reconciling}
                className="rounded-xl bg-accent-500 px-6 py-3 text-sm font-bold text-white shadow-sm shadow-accent-500/20 transition hover:bg-accent-600 disabled:cursor-wait disabled:opacity-70"
              >
                {reconciling ? "A reconciliar…" : "Reconciliar"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingPanel({
  docs,
  readDone,
  stage,
}: {
  docs: DocView[];
  readDone: Partial<Record<Source, boolean>>;
  stage: "reading" | "confirmed" | "reconciling";
}) {
  const Spinner = () => <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />;
  const Check = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent-600">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
  const rows: { key: string; done: boolean; text: string }[] = docs.map((d) => ({
    key: d.source,
    done: !!readDone[d.source],
    text: readDone[d.source] ? `Lido: ${d.label}` : `A ler ${d.label}…`,
  }));
  if (stage !== "reading") rows.push({ key: "confirmed", done: true, text: "Leitura confirmada" });
  if (stage === "reconciling") rows.push({ key: "reconciling", done: false, text: "A reconciliar…" });

  return (
    <div className="mt-6 rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 text-sm font-semibold text-brand-700">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent-50">{r.done ? <Check /> : <Spinner />}</span>
            <span className="first-letter:uppercase">{r.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent-500 to-brand-600" />
      </div>
      <p className="mt-2 text-xs text-foreground/45">Pode demorar até cerca de um minuto.</p>
    </div>
  );
}

function FormatBadge({ format }: { format: DocView["format"] }) {
  return (
    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold text-foreground/60">{FORMAT_LABEL[format]}</span>
  );
}

function ReadingCard({ doc, reading, error, onRetry }: { doc: DocView; reading: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {error ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-50 text-danger-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M12 9v4M12 17h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </span>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-50">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-700">
            {error ? `Não foi possível ler o ${doc.label}` : reading ? `A ler ${doc.label}…` : `A preparar a leitura do ${doc.label}…`}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-foreground/55">
            <span className="truncate">{doc.fileName}</span>
            <FormatBadge format={doc.format} />
          </p>
        </div>
      </div>
      {error ? (
        <div className="mt-4">
          <p className="rounded-lg bg-danger-50 px-3 py-2.5 text-sm font-medium text-danger-600">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onRetry}
              className="rounded-lg bg-accent-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-accent-600"
            >
              Tentar de novo
            </button>
            <Link href="/reconciliacao" className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-foreground/70 ring-1 ring-black/10 transition hover:bg-black/[0.03]">
              Voltar ao passo 1
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent-500 to-brand-600" />
          </div>
          <p className="mt-2 text-xs text-foreground/45">Pode demorar até cerca de um minuto.</p>
        </>
      )}
    </div>
  );
}

interface Draft {
  date: string;
  description: string;
  entrada: string;
  saida: string;
  saldo: string;
}

const emptyDraft = (date = ""): Draft => ({ date, description: "", entrada: "", saida: "", saldo: "" });
const draftFromLine = (l: LineView): Draft => ({
  date: l.date,
  description: l.description,
  entrada: l.entrada == null ? "" : String(l.entrada).replace(".", ","),
  saida: l.saida == null ? "" : String(l.saida).replace(".", ","),
  saldo: l.saldo == null ? "" : String(l.saldo).replace(".", ","),
});

function draftToInput(d: Draft, reference: string | null): { input?: LineInput; error?: string } {
  const num = (s: string): number | null | "bad" => {
    if (s.trim() === "") return null;
    const n = parseAmount(s.trim());
    return n == null ? "bad" : n;
  };
  const entrada = num(d.entrada);
  const saida = num(d.saida);
  const saldo = num(d.saldo);
  if (entrada === "bad" || saida === "bad" || saldo === "bad") return { error: "Há um valor que não é um número." };
  return { input: { date: d.date, description: d.description, reference, entrada, saida, saldo } };
}

function DocumentBlock({ reconciliationId, doc, disabled }: { reconciliationId: string; doc: DocView; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!doc.ok);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const badRowRef = useRef<HTMLTableRowElement>(null);

  const badLine = doc.firstBadIndex == null ? null : doc.lines[doc.firstBadIndex];

  // Com ⚠️ a tabela vem aberta e posicionada na linha problemática.
  useEffect(() => {
    if (open && !doc.ok && containerRef.current && badRowRef.current) {
      containerRef.current.scrollTop = Math.max(0, badRowRef.current.offsetTop - 96);
    }
  }, [open, doc.ok, doc.firstBadIndex]);

  function run(action: () => Promise<{ error?: string }>, onDone: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setMessage(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  function save() {
    const parsed = draftToInput(draft, editingId ? (doc.lines.find((l) => l.id === editingId)?.reference ?? null) : null);
    if (!parsed.input) {
      setMessage(parsed.error ?? "Dados inválidos.");
      return;
    }
    if (editingId) {
      run(() => updateLine(reconciliationId, editingId, parsed.input!), () => setEditingId(null));
    } else if (insertAfter != null) {
      run(() => insertLine(reconciliationId, doc.source, insertAfter, parsed.input!), () => setInsertAfter(null));
    }
  }

  function cancel() {
    setEditingId(null);
    setInsertAfter(null);
    setMessage(null);
  }

  async function downloadExcel() {
    const XLSX = await import("xlsx");
    const header = ["Data", "Descrição", "Referência", "Entrada", "Saída", "Saldo"];
    const rows = doc.lines.map((l) => [
      "",
      l.description,
      l.reference ?? "",
      l.entrada ?? "",
      l.saida ?? "",
      l.saldo ?? l.calculado ?? "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // Datas como datas (número de série com formato), valores como números.
    doc.lines.forEach((l, i) => {
      const [y, m, d] = l.date.split("-").map(Number);
      const serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })] = { t: "n", v: serial, z: "dd/mm/yyyy" };
      for (const c of [3, 4, 5]) {
        const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
      }
    });
    ws["!cols"] = [{ wch: 12 }, { wch: 48 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, doc.source === "bank" ? "Extrato bancário" : "Contabilidade");
    const base = doc.fileName.replace(/\.[^.]+$/, "");
    XLSX.writeFile(wb, `Match_${doc.source === "bank" ? "banco" : "contabilidade"}_${base}.xlsx`);
  }

  const editing = (l: LineView) => editingId === l.id;

  return (
    <section className="rounded-2xl border border-black/10 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-brand-700 first-letter:uppercase">{doc.label}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
            <span className="truncate">{doc.fileName}</span>
            <FormatBadge format={doc.format} />
            {doc.sourceName && <span className="text-foreground/45">· {doc.sourceName}</span>}
            <span className="font-mono">· {doc.lines.length} movimentos</span>
          </p>
        </div>
        <button
          onClick={downloadExcel}
          className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-foreground/70 ring-1 ring-black/10 transition hover:bg-black/[0.03]"
        >
          Descarregar Excel
        </button>
      </div>

      <div className="grid gap-3 px-5 sm:grid-cols-4">
        <Stat label="Saldo inicial" value={euro(doc.openingBalance)} />
        <Stat label="Saldo final" value={euro(doc.closingBalance)} />
        <Stat label="Total entradas" value={euro(doc.totalIn)} />
        <Stat label="Total saídas" value={euro(doc.totalOut)} />
      </div>

      <div className="px-5 pt-4">
        {doc.ok ? (
          <p className="rounded-xl border border-accent-500/25 bg-accent-50 px-4 py-2.5 text-sm font-semibold text-accent-600">
            ✅ Leitura confirmada: os saldos batem certo
          </p>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <p className="font-semibold">⚠️ {doc.problem ?? "A leitura não bate certo"}</p>
            {badLine ? (
              <p className="mt-1 text-xs">
                Primeira linha onde o saldo deixa de bater: {dmy(badLine.date)} · {badLine.description || "sem descrição"}
                {badLine.origin ? ` (${badLine.origin.startsWith("p") ? `página ${badLine.origin.slice(1)}` : `linha ${badLine.origin.slice(1)}`})` : ""}.
              </p>
            ) : (
              !doc.hasBalanceColumn && (
                <p className="mt-1 text-xs">O documento não tem coluna de saldo, por isso não é possível indicar a linha.</p>
              )
            )}
          </div>
        )}
        {doc.issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-foreground/55">
            {doc.issues.map((i, idx) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-5 pt-3">
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-accent-600 hover:underline">
          {open ? "Esconder movimentos" : "Ver movimentos"}
        </button>

        {open && (
          <div className="mt-3">
            {message && <p className="mb-2 rounded-lg bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600">{message}</p>}
            <div ref={containerRef} className="relative max-h-[480px] overflow-auto rounded-xl border border-black/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white text-left text-xs uppercase tracking-wide text-foreground/50 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="min-w-[220px] px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 text-right font-semibold">Entrada</th>
                    <th className="px-3 py-2 text-right font-semibold">Saída</th>
                    <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                    <th className="px-3 py-2 text-right font-semibold">Saldo calculado</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {insertAfter === 0 && (
                    <DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} />
                  )}
                  {doc.lines.map((l, i) => {
                    const isBad = i === doc.firstBadIndex;
                    return (
                      <FragmentRows key={l.id}>
                        {editing(l) ? (
                          <DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} />
                        ) : (
                          <tr
                            ref={isBad ? badRowRef : undefined}
                            className={`border-t border-black/5 align-top ${isBad ? "bg-amber-100" : "hover:bg-black/[0.015]"}`}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground/60">{dmy(l.date)}</td>
                            <td className="px-3 py-2">
                              {l.description || <span className="text-foreground/30">sem descrição</span>}
                              {l.edited && <span className="ml-2 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-foreground/50">editada</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-accent-600">{l.entrada == null ? "" : euro(l.entrada)}</td>
                            <td className="px-3 py-2 text-right font-mono">{l.saida == null ? "" : euro(l.saida)}</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground/70">{l.saldo == null ? "" : euro(l.saldo)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${isBad ? "font-bold text-amber-800" : "text-foreground/50"}`}>
                              {l.calculado == null ? "" : euro(l.calculado)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                              {deletingId === l.id ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className="text-foreground/60">Apagar?</span>
                                  <button
                                    disabled={busy || disabled}
                                    onClick={() => run(() => deleteLine(reconciliationId, l.id), () => setDeletingId(null))}
                                    className="font-semibold text-danger-600 hover:underline"
                                  >
                                    Sim
                                  </button>
                                  <button onClick={() => setDeletingId(null)} className="font-semibold text-foreground/60 hover:underline">
                                    Não
                                  </button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-3">
                                  <button
                                    disabled={busy || disabled}
                                    onClick={() => {
                                      cancel();
                                      setDraft(draftFromLine(l));
                                      setEditingId(l.id);
                                    }}
                                    className="font-semibold text-accent-600 hover:underline"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    disabled={busy || disabled}
                                    onClick={() => {
                                      cancel();
                                      setDraft(emptyDraft(l.date));
                                      setInsertAfter(l.position);
                                    }}
                                    className="font-semibold text-accent-600 hover:underline"
                                  >
                                    + Linha
                                  </button>
                                  <button
                                    disabled={busy || disabled}
                                    onClick={() => setDeletingId(l.id)}
                                    className="font-semibold text-danger-600 hover:underline"
                                  >
                                    Apagar
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        )}
                        {insertAfter === l.position && (
                          <DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} />
                        )}
                      </FragmentRows>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <button
                disabled={busy || disabled}
                onClick={() => {
                  cancel();
                  setDraft(emptyDraft(doc.lines[doc.lines.length - 1]?.date ?? ""));
                  setInsertAfter(doc.lines[doc.lines.length - 1]?.position ?? 0);
                  // a linha nova fica no fim da tabela: leva-a para dentro do ecrã
                  requestAnimationFrame(() => {
                    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
                  });
                }}
                className="font-semibold text-accent-600 hover:underline"
              >
                + Acrescentar linha no fim
              </button>
              <button
                disabled={busy || disabled}
                onClick={() => {
                  cancel();
                  setDraft(emptyDraft(doc.lines[0]?.date ?? ""));
                  setInsertAfter(0);
                }}
                className="font-semibold text-accent-600 hover:underline"
              >
                + Acrescentar linha no início
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[0.025] px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">{label}</p>
      <p className="mt-1 font-mono text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function DraftRow({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const input = "w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs focus:border-accent-500 focus:outline-none";
  return (
    <tr className="border-t border-black/5 bg-accent-50/50 align-top">
      <td className="px-2 py-2">
        <input className={input} value={draft.date} placeholder="AAAA-MM-DD" onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
      </td>
      <td className="px-2 py-2">
        <input className={input} value={draft.description} placeholder="Descrição" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </td>
      <td className="px-2 py-2">
        <input className={`${input} text-right`} value={draft.entrada} placeholder="Entrada" inputMode="decimal" onChange={(e) => setDraft({ ...draft, entrada: e.target.value })} />
      </td>
      <td className="px-2 py-2">
        <input className={`${input} text-right`} value={draft.saida} placeholder="Saída" inputMode="decimal" onChange={(e) => setDraft({ ...draft, saida: e.target.value })} />
      </td>
      <td className="px-2 py-2">
        <input className={`${input} text-right`} value={draft.saldo} placeholder="Saldo" inputMode="decimal" onChange={(e) => setDraft({ ...draft, saldo: e.target.value })} />
      </td>
      <td />
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
        <button disabled={busy} onClick={onSave} className="mr-3 font-bold text-accent-600 hover:underline disabled:opacity-50">
          {busy ? "A guardar…" : "Guardar"}
        </button>
        <button disabled={busy} onClick={onCancel} className="font-semibold text-foreground/60 hover:underline">
          Cancelar
        </button>
      </td>
    </tr>
  );
}
