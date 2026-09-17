"use client";

import { useTransition } from "react";
import { deleteReconciliation } from "../reconciliations/actions";

export default function DeleteReconciliationButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm("Apagar esta conciliação e os ficheiros carregados?")) return;
        startTransition(() => deleteReconciliation(id));
      }}
      className="rounded-md px-2 py-1 text-xs font-medium text-foreground/40 transition hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50"
    >
      Apagar
    </button>
  );
}
