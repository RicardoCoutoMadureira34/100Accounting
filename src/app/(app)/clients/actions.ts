"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error: string | null };

export async function createClientRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const nif = String(formData.get("nif") ?? "").trim();

  if (!name) return { error: "O nome do cliente é obrigatório." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entra novamente." };

  const { data, error } = await supabase
    .from("clients")
    .insert({ accountant_id: user.id, name, nif: nif || null })
    .select("id")
    .single();

  if (error || !data) return { error: "Não foi possível criar o cliente." };

  revalidatePath("/dashboard");
  redirect(`/clients/${data.id}`);
}

export async function createBankAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const clientId = String(formData.get("client_id") ?? "");
  const bankName = String(formData.get("bank_name") ?? "").trim();
  const iban = String(formData.get("iban") ?? "").trim();

  if (!clientId || !bankName) return { error: "Indica o nome do banco." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_accounts")
    .insert({ client_id: clientId, bank_name: bankName, iban: iban || null });

  if (error) return { error: "Não foi possível adicionar a conta bancária." };

  revalidatePath(`/clients/${clientId}`);
  return { error: null };
}
