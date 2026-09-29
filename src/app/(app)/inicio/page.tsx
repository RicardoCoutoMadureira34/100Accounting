import Link from "next/link";
import { Reveal } from "./reveal";

export default function InicioPage() {
  return (
    // Quebra o max-w-5xl herdado do layout partilhado para o fundo azul
    // ocupar a largura toda do ecrã — o conteúdo lá dentro continua alinhado
    // com o resto da app através do wrapper max-w-5xl interior.
    <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen overflow-hidden bg-ink-950 text-white">
      <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-lime-400/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute top-[60vh] left-1/4 h-72 w-72 rounded-full bg-lime-400/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute bottom-0 right-1/3 h-80 w-80 rounded-full bg-lime-400/10 blur-3xl" aria-hidden />

      <div className="relative mx-auto flex max-w-5xl flex-col gap-20 px-6 py-14 sm:py-20">
        {/* Hero */}
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="max-w-xl">
            <Reveal>
              <h1 className="font-display text-4xl font-extrabold uppercase leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                Reconciliação bancária <span className="text-lime-400">automática</span> para o seu negócio.
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-6 text-lg leading-relaxed text-white/70">
                Carrega o extrato do banco e o extrato da contabilidade em PDF. A 100Accounting lê os dois, cruza os movimentos e
                devolve-te, em minutos, um relatório claro do que analisou.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/reconciliacao"
                  className="inline-flex items-center gap-2 rounded-xl bg-lime-400 px-6 py-3.5 text-sm font-bold text-ink-950 shadow-lg shadow-lime-400/20 transition hover:bg-lime-300"
                >
                  Nova conciliação
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={200} className="hidden lg:block">
            <DashboardMockup />
          </Reveal>
        </div>

        {/* Como funciona */}
        <div>
          <Reveal className="mb-9">
            <h2 className="font-display text-3xl font-extrabold uppercase tracking-tight text-white sm:text-4xl">Como funciona</h2>
            <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-lime-400">Três passos, do PDF ao relatório</p>
          </Reveal>

          <div className="grid gap-5 sm:grid-cols-3">
            <Reveal delay={0}>
              <StepCard
                n={1}
                icon={<UploadIcon />}
                title="Importar dados bancários"
                text="Carrega o extrato bancário e o extrato de conta corrente da contabilidade, os dois em PDF."
              />
            </Reveal>
            <Reveal delay={120}>
              <StepCard
                n={2}
                icon={<AiIcon />}
                title="Cruzamento automático"
                text="A 100Accounting lê ambos os documentos, normaliza os sinais de débito/crédito e cruza os movimentos automaticamente."
              />
            </Reveal>
            <Reveal delay={240}>
              <StepCard
                n={3}
                icon={<ExcelIcon />}
                title="Revisão e exportação"
                text="Confirma os pares prováveis, vê o que ficou por explicar de cada lado, e exporta o relatório completo para Excel."
              />
            </Reveal>
          </div>
        </div>

        {/* CTA final */}
        <Reveal className="flex flex-col items-start gap-3 rounded-2xl bg-white px-7 py-8 text-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-brand-700">Pronto para experimentar?</h2>
            <p className="mt-1 text-sm text-foreground/60">Precisas só do extrato bancário e do extrato da contabilidade, os dois em PDF.</p>
          </div>
          <Link
            href="/reconciliacao"
            className="inline-flex items-center gap-2 rounded-xl bg-ink-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-ink-900"
          >
            Ir para Reconciliação Bancária
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </div>
  );
}

function StepCard({ n, icon, title, text }: { n: number; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="relative rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="font-display text-4xl font-extrabold text-lime-500">{String(n).padStart(2, "0")}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-950/5 text-ink-950">{icon}</div>
      </div>
      <h3 className="mt-3 text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">{text}</p>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M12 18v-6M9.5 14.5 12 12l2.5 2.5" />
    </svg>
  );
}
function AiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M3 12h2.5M18.5 12H21M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}
function ExcelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="m9 13 3 3 5-5" />
    </svg>
  );
}

// Ilustração decorativa (estática) do dashboard da app, para o hero — inspirada
// no mockup fornecido: uma "janela" com barra de título e uma pré-visualização
// simplificada do ecrã de nova conciliação.
function DashboardMockup() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white p-1.5 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-danger-600/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-glow/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-lime-500/80" />
        <span className="ml-2 text-[11px] font-bold text-ink-950/60">100Accounting · Dashboard</span>
      </div>
      <div className="rounded-xl bg-ink-950/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold text-ink-950/70">Nova Conciliação</p>
          <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[10px] font-bold text-ink-950">Nova Conciliação</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-950/10">
          <div className="h-full w-2/3 rounded-full bg-lime-400" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-dashed border-ink-950/15 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-950/40">Extrato Bancário</p>
            <div className="mt-2 h-8 rounded-md bg-ink-950/[0.04]" />
          </div>
          <div className="rounded-lg border border-dashed border-ink-950/15 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-950/40">Extrato da Contabilidade</p>
            <div className="mt-2 h-8 rounded-md bg-ink-950/[0.04]" />
          </div>
        </div>
        <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-wide text-ink-950/40">Conciliações Anteriores</p>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-2 shadow-sm">
              <div className="h-2 flex-1 rounded-full bg-ink-950/10" />
              <span className="h-2 w-10 rounded-full bg-lime-400/80" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
