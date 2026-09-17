"use client";

import { useActionState, useState } from "react";
import { createBankAccount, type ActionState } from "../actions";

const initialState: ActionState = { error: null };

export default function NewBankAccountForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createBankAccount, initialState);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start rounded-lg border border-dashed border-black/20 px-4 py-2 text-sm font-medium text-foreground/60 transition hover:border-accent-500 hover:text-accent-600"
      >
        + Adicionar conta bancária
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground/80">Banco</span>
        <input
          name="bank_name"
          required
          placeholder="Ex.: Banco Atlântico Comercial"
          className="w-56 rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground/80">IBAN (opcional)</span>
        <input
          name="iban"
          className="w-56 rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:opacity-60"
      >
        {pending ? "A guardar…" : "Guardar"}
      </button>
      {state.error && <p className="w-full text-xs font-medium text-danger-600">{state.error}</p>}
    </form>
  );
}
