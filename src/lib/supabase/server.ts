import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabaseAnonKey, supabaseUrl } from "./env";

// Um cliente Supabase por pedido, ligado aos cookies do Next.js (App Router).
// Usar dentro de Server Components, Server Actions e Route Handlers.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll foi chamado a partir de um Server Component (sem Response
          // disponível). É seguro ignorar se o proxy.ts já atualiza a sessão.
        }
      },
    },
  });
}

// Cliente com a service role key: contorna RLS, só para usar dentro de
// Server Actions/Route Handlers depois de validar a sessão do utilizador
// (nunca expor esta chave ao browser).
export async function createServiceRoleClient() {
  const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
  const { supabaseServiceRoleKey } = await import("./env");
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
