import Link from "next/link";

export default function InicioPage() {
  return (
    <div className="flex flex-col gap-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-600 px-8 py-14 text-white shadow-lg sm:px-14 sm:py-16">
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-accent-400/25 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-amber-glow/10 blur-3xl"
          aria-hidden
        />
        <div className="relative max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80 ring-1 ring-white/20">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
            Para gabinetes de contabilidade
          </p>
          <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] sm:text-5xl">
            A picagem manual do extrato bancário acabou.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-white/80">
            Carrega o extrato do banco e o extrato da contabilidade em PDF. O Concilia lê os dois com IA, cruza os
            movimentos e devolve-te, em minutos, um relatório claro do que bate, do que precisa de confirmação e do
            que falta explicar — pronto a exportar para Excel.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/reconciliacao"
              className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-accent-500/20 transition hover:bg-accent-400"
            >
              Nova conciliação
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <p className="text-sm text-white/60">Sem folhas de cálculo manuais. Sem cruzar movimento a movimento à mão.</p>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="grid gap-4 sm:grid-cols-3">
        <ValueCard
          icon={<BoltIcon />}
          title="Minutos, não horas"
          text="O que normalmente é uma tarde a comparar linha a linha passa a ser um upload e uma chávena de café."
        />
        <ValueCard
          icon={<BrainIcon />}
          title="Raciocina como um contabilista"
          text="Identifica cheques em trânsito, comissões por lançar e prováveis erros de digitação — e explica sempre porquê."
        />
        <ValueCard
          icon={<SheetIcon />}
          title="Sai direto para Excel"
          text="O relatório fica sempre estruturado da mesma forma, pronto a exportar e a arquivar no dossiê do cliente."
        />
      </section>

      {/* Como funciona */}
      <section>
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wide text-accent-600">Como funciona</p>
          <h2 className="mt-1 text-2xl font-bold text-brand-700">Três passos, do PDF ao relatório</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <StepCard
            n={1}
            title="Carregar os dois PDFs"
            text="Extrato bancário e extrato de conta corrente da contabilidade — arrasta os ficheiros ou escolhe-os do computador."
          />
          <StepCard
            n={2}
            title="Deixar o Concilia analisar"
            text="O motor de IA lê ambos os documentos, normaliza os sinais de débito/crédito e cruza os movimentos automaticamente."
          />
          <StepCard
            n={3}
            title="Rever e exportar"
            text="Confirma os pares prováveis, vê o que ficou por explicar de cada lado, e exporta o relatório completo para Excel."
          />
        </div>
      </section>

      {/* CTA final */}
      <section className="flex flex-col items-start gap-3 rounded-2xl border border-black/10 bg-white px-7 py-8 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-brand-700">Pronto para experimentar?</h2>
          <p className="mt-1 text-sm text-foreground/60">Precisas só do extrato bancário e do extrato da contabilidade, os dois em PDF.</p>
        </div>
        <Link
          href="/reconciliacao"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-700"
        >
          Ir para Reconciliação Bancária
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </section>
    </div>
  );
}

function ValueCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-600">{icon}</div>
      <h3 className="mt-4 text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">{text}</p>
    </div>
  );
}

function StepCard({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="relative rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <span className="font-display text-3xl font-extrabold text-brand-50">{String(n).padStart(2, "0")}</span>
      <h3 className="mt-2 text-sm font-bold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">{text}</p>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M8 3a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 3 9v2a2.5 2.5 0 0 0 2 2.45V16a3 3 0 0 0 3 3" />
      <path d="M16 3a3 3 0 0 1 3 3v.5A2.5 2.5 0 0 1 21 9v2a2.5 2.5 0 0 1-2 2.45V16a3 3 0 0 1-3 3" />
      <path d="M8 3a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3" />
      <path d="M16 3a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3" />
    </svg>
  );
}
function SheetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M9 13h6M9 17h6M9 9h1" />
    </svg>
  );
}
