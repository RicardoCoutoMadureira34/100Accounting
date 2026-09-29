import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <circle cx="9" cy="9" r="2.5"/>
              <circle cx="15" cy="15" r="2.5"/>
              <line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </span>
          <div>
            <p className="font-semibold leading-tight text-brand-700">100% Contas</p>
            <p className="text-[11px] uppercase tracking-wide text-foreground/50">Escritório de Contabilidade</p>
          </div>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
