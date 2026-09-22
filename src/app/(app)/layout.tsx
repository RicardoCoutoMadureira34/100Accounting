import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import NavTabs from "./nav-tabs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, firm_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-brand-600 text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/inicio" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span className="font-display text-[16px] font-extrabold tracking-tight">Match</span>
            </Link>
            <NavTabs />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-white/60 sm:inline">
              {profile?.full_name || user.email}
              {profile?.firm_name ? ` · ${profile.firm_name}` : ""}
            </span>
            <form action={signOut}>
              <button className="rounded-md px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
