const LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-black/5 text-foreground/60" },
  processing: { label: "A processar", className: "bg-amber-100 text-amber-700" },
  completed: { label: "Concluída", className: "bg-accent-50 text-accent-600" },
  failed: { label: "Falhou", className: "bg-danger-50 text-danger-600" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = LABELS[status] ?? { label: status, className: "bg-black/5 text-foreground/60" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
