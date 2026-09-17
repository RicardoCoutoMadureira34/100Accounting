"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createClientRecord, type ActionState } from "../actions";

const initialState: ActionState = { error: null };

export default function NewClientPage() {
  const [state, action, pending] = useActionState(createClientRecord, initialState);

  return (
    <div className="mx-auto max-w-md">
      <Link href="/dashboard" className="text-xs font-medium text-foreground/50 hover:text-foreground">
        ← Clientes
      </Link>
      <h1 className="mt-2 text-xl font-bold text-brand-700">Novo cliente</h1>
      <p className="mt-1 text-sm text-foreground/60">Empresa ou entidade para a qual vais reconciliar extratos.</p>

      <form action={action} className="mt-6 flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground/80">Nome do cliente</span>
          <input
            name="name"
            required
            className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
            placeholder="Ex.: Construções Vieira, S.A."
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground/80">NIF (opcional)</span>
          <input
            name="nif"
            className="rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </label>
        {state.error && <p className="rounded-md bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-lg bg-accent-500 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? "A criar…" : "Criar cliente"}
        </button>
      </form>
    </div>
  );
}
