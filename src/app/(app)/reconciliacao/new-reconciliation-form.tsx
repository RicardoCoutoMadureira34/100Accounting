"use client";

import { useActionState, useRef, useState } from "react";
import { createReconciliation, type ActionState } from "../reconciliations/actions";
import ProcessingAnimation from "./processing-animation";

const initialState: ActionState = { error: null };

export default function NewReconciliationForm() {
  const [state, action, pending] = useActionState(createReconciliation, initialState);

  if (pending) return <ProcessingAnimation />;

  return (
    <form action={action} className="flex flex-col gap-5 rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Dropzone name="bank_file" label="Extrato Bancário" hint="O extrato emitido pelo banco (PDF)" />
        <Dropzone name="accounting_file" label="Extrato da Contabilidade" hint="Conta corrente / razão (PDF)" />
      </div>

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2.5 text-sm font-medium text-danger-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 flex-none">
            <path d="M12 9v4M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="submit"
          className="rounded-xl bg-accent-500 px-6 py-3 text-sm font-bold text-white shadow-sm shadow-accent-500/20 transition hover:bg-accent-600"
        >
          Iniciar Conciliação
        </button>
        <p className="text-xs text-foreground/45">
          O Match lê os dois PDFs e cruza os movimentos automaticamente, cerca de um minuto.
        </p>
      </div>
    </form>
  );
}

function Dropzone({ name, label, hint }: { name: string; label: string; hint: string }) {
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
      className={`flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-1.5 border-dashed px-4 py-9 text-center transition ${
        fileName
          ? "border-accent-500 bg-accent-50"
          : dragOver
            ? "border-accent-500 bg-accent-50/60"
            : "border-black/15 hover:border-accent-500/60 hover:bg-black/[0.015]"
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
      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${fileName ? "bg-accent-500" : "bg-black/[0.04]"}`}>
        {fileName ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M4 12l5 5L20 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-foreground/50">
            <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path d="M14 3v5h5M9 13h6M9 17h6M9 9h1" />
          </svg>
        )}
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {fileName ? (
        <span className="max-w-full truncate rounded-md bg-white px-2.5 py-1 text-xs font-medium text-accent-600 shadow-sm">{fileName}</span>
      ) : (
        <span className="text-xs text-foreground/50">{hint} · arrasta ou clica</span>
      )}
    </div>
  );
}
