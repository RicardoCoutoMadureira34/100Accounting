function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta a variável de ambiente ${name}. Copia .env.local.example para .env.local e preenche as credenciais do Supabase.`
    );
  }
  return value;
}

export const supabaseUrl = () => requireEnv("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const supabaseServiceRoleKey = () => requireEnv("SUPABASE_SERVICE_ROLE_KEY");
