"use client";

import { useActionState, useRef, useState } from "react";
import { createReconciliation, type ActionState } from "../actions";

const initialState: ActionState = { error: null };

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewReconciliationForm({ bankAccountId }: { bankAccountId: string }) {
  const [state, action, pending] = useActionState(createReconciliation, initialState);

  return (
    <form action={action} className="mt-6 flex flex-col gap-5 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <input type="hidden" name="bank_account_id" value={bankAccountId} />

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground/80">Início do período</span>
          <input
            type="date"
            name="period_start"
            required
            defaultValue={firstDayOfMonth()}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground/80">Fim do período</span>
          <input
            type="date"
            name="period_end"
            required
            defaultValue={today()}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Dropzone name="bank_file" label="Extrato Bancário (PDF)" />
        <Dropzone name="accounting_file" label="Extrato da Contabilidade (PDF)" />
      </div>

      {state.error && <p className="rounded-md bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "A carregar e a processar…" : "Iniciar Conciliação"}
      </button>
      <p className="text-xs text-foreground/45">
        A leitura automática dos PDFs (OCR/IA) ainda não está ligada — esta versão guarda os ficheiros e gera um
        conjunto de movimentos de teste para validar o resto do fluxo.
      </p>
    </form>
  );
}

function Dropzone({ name, label }: { name: string; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function setFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        setFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-1.5 border-dashed px-4 py-8 text-center transition ${
        fileName
          ? "border-accent-500 bg-accent-50"
          : dragOver
            ? "border-accent-500 bg-accent-50/60"
            : "border-black/20 hover:border-accent-500/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="application/pdf,.pdf"
        required
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {fileName ? (
        <span className="mt-1 max-w-full truncate rounded-md bg-white px-2.5 py-1 text-xs font-medium text-accent-600 shadow-sm">
          {fileName}
        </span>
      ) : (
        <span className="text-xs text-foreground/50">Arrasta o ficheiro para aqui ou clica para procurar</span>
      )}
    </div>
  );
}
