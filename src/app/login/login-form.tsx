"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signUp, type AuthActionState } from "./actions";

const initialState: AuthActionState = { error: null };

export default function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/inicio";

  const [loginState, loginAction, loginPending] = useActionState(signIn, initialState);
  const [signupState, signupAction, signupPending] = useActionState(signUp, initialState);

  const state = mode === "login" ? loginState : signupState;

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="mb-5 flex gap-1 rounded-lg bg-black/[0.04] p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-md py-1.5 transition ${
            mode === "login" ? "bg-white text-brand-700 shadow-sm" : "text-foreground/50"
          }`}
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded-md py-1.5 transition ${
            mode === "signup" ? "bg-white text-brand-700 shadow-sm" : "text-foreground/50"
          }`}
        >
          Criar conta
        </button>
      </div>

      {mode === "login" ? (
        <form action={loginAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Palavra-passe" name="password" type="password" required autoComplete="current-password" />
          <SubmitButton pending={loginPending}>Entrar</SubmitButton>
        </form>
      ) : (
        <form action={signupAction} className="flex flex-col gap-3">
          <Field label="Nome" name="full_name" type="text" required autoComplete="name" />
          <Field label="Nome do gabinete (opcional)" name="firm_name" type="text" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Palavra-passe" name="password" type="password" required autoComplete="new-password" minLength={8} />
          <SubmitButton pending={signupPending}>Criar conta</SubmitButton>
        </form>
      )}

      {state.error && (
        <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-xs font-medium text-danger-600">{state.error}</p>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  type,
  required,
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground/80">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        minLength={minLength}
        className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
      />
    </label>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 rounded-lg bg-accent-500 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Aguarda…" : children}
    </button>
  );
}
