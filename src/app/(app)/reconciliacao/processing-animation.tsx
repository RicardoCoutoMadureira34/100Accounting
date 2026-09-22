"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "A extrair movimentos do extrato bancário…",
  "A extrair movimentos da contabilidade…",
  "A comparar e a calcular correspondências…",
  "A gerar o relatório…",
];

const STEP_DURATION_MS = 7000;

export default function ProcessingAnimation() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = STEPS.slice(0, -1).map((_, i) =>
      setTimeout(() => setActiveStep(i + 1), (i + 1) * STEP_DURATION_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // O progresso não chega a 100%: só sabemos que terminou quando a página
  // muda (redirect do servidor), por isso a última fase fica "em curso".
  const progressPct = Math.min(92, ((activeStep + 0.5) / STEPS.length) * 100);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-black/10 bg-white px-8 py-12 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-50">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
      <h2 className="mt-5 text-base font-bold text-brand-700">A processar a conciliação</h2>
      <p className="mt-1 text-sm text-foreground/55">
        O Match está a ler os dois extratos, pode demorar até cerca de um minuto.
      </p>

      <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-500 to-brand-600 transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ul className="mt-7 flex w-full flex-col gap-1 text-left">
        {STEPS.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <li
              key={label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active ? "bg-accent-50 font-semibold text-foreground" : done ? "text-foreground/70" : "text-foreground/35"
              }`}
            >
              <span
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border transition ${
                  done ? "border-accent-500 bg-accent-500" : active ? "border-accent-500" : "border-black/15"
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                ) : active ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
                ) : null}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
