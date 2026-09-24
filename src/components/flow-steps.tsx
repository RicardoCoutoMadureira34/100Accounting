import Link from "next/link";

// Indicador dos 3 passos do fluxo de conciliação: 1 Carregar · 2 Preparar
// dados · 3 Resultado. Aparece no topo de todas as páginas do fluxo.
const STEPS = [
  { n: 1, label: "Carregar" },
  { n: 2, label: "Preparar dados" },
  { n: 3, label: "Resultado" },
] as const;

export function FlowSteps({
  current,
  hrefs = {},
}: {
  current: 1 | 2 | 3;
  // Links para os passos que já se podem abrir (o atual nunca leva a lado nenhum).
  hrefs?: Partial<Record<1 | 2 | 3, string>>;
}) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Passos da conciliação">
      {STEPS.map((step, i) => {
        const done = step.n < current;
        const active = step.n === current;
        const href = !active ? hrefs[step.n] : undefined;
        const body = (
          <>
            <span
              className={`flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                active
                  ? "bg-accent-500 text-white"
                  : done
                    ? "bg-accent-50 text-accent-600"
                    : "bg-black/5 text-foreground/40"
              }`}
            >
              {done ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                  <path d="M4 12l5 5L20 6" />
                </svg>
              ) : (
                step.n
              )}
            </span>
            <span className={`font-semibold ${active ? "text-brand-700" : done ? "text-foreground/70" : "text-foreground/40"}`}>{step.label}</span>
          </>
        );
        return (
          <li key={step.n} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {href ? (
              <Link href={href} className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition hover:bg-black/[0.03]">
                {body}
              </Link>
            ) : (
              <span className="flex items-center gap-2 px-1 py-0.5">{body}</span>
            )}
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-black/15 sm:w-10" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
