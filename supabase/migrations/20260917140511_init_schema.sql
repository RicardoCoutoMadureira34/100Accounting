-- Concilia — schema inicial
-- Contabilistas (profiles) gerem clientes, cada cliente tem contas bancárias,
-- cada conta tem conciliações periódicas, cada conciliação tem movimentos
-- (banco + contabilidade) e correspondências entre eles.

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  firm_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- clients ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  accountant_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  nif text,
  created_at timestamptz not null default now()
);

create index clients_accountant_id_idx on public.clients (accountant_id);

-- ---------- bank_accounts ----------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  bank_name text not null,
  iban text,
  account_number text,
  created_at timestamptz not null default now()
);

create index bank_accounts_client_id_idx on public.bank_accounts (client_id);

-- ---------- reconciliations ----------
create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  bank_statement_path text,
  accounting_statement_path text,
  bank_balance numeric(14, 2),
  accounting_balance numeric(14, 2),
  difference numeric(14, 2),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reconciliations_bank_account_id_idx on public.reconciliations (bank_account_id);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_reconciliations_updated_at
  before update on public.reconciliations
  for each row execute procedure public.set_updated_at();

-- ---------- transactions ----------
-- Um movimento extraído de um dos dois extratos (banco ou contabilidade).
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations (id) on delete cascade,
  source text not null check (source in ('bank', 'accounting')),
  transaction_date date not null,
  description text not null,
  amount numeric(14, 2) not null,
  raw_data jsonb,
  created_at timestamptz not null default now()
);

create index transactions_reconciliation_id_idx on public.transactions (reconciliation_id);

-- ---------- matches ----------
-- Resultado da comparação: cada linha liga (ou não) um movimento do banco
-- a um movimento da contabilidade.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations (id) on delete cascade,
  bank_transaction_id uuid references public.transactions (id) on delete set null,
  accounting_transaction_id uuid references public.transactions (id) on delete set null,
  match_type text not null
    check (match_type in ('exact', 'probable', 'unmatched_bank', 'unmatched_accounting')),
  confidence numeric(5, 2),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index matches_reconciliation_id_idx on public.matches (reconciliation_id);

-- ========================================================================
-- Row Level Security — um contabilista só vê os seus próprios clientes,
-- contas, conciliações, movimentos e correspondências.
-- ========================================================================

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.reconciliations enable row level security;
alter table public.transactions enable row level security;
alter table public.matches enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "clients_select_own" on public.clients
  for select using (accountant_id = auth.uid());
create policy "clients_insert_own" on public.clients
  for insert with check (accountant_id = auth.uid());
create policy "clients_update_own" on public.clients
  for update using (accountant_id = auth.uid());
create policy "clients_delete_own" on public.clients
  for delete using (accountant_id = auth.uid());

create policy "bank_accounts_select_own" on public.bank_accounts
  for select using (
    exists (
      select 1 from public.clients c
      where c.id = bank_accounts.client_id and c.accountant_id = auth.uid()
    )
  );
create policy "bank_accounts_insert_own" on public.bank_accounts
  for insert with check (
    exists (
      select 1 from public.clients c
      where c.id = bank_accounts.client_id and c.accountant_id = auth.uid()
    )
  );
create policy "bank_accounts_update_own" on public.bank_accounts
  for update using (
    exists (
      select 1 from public.clients c
      where c.id = bank_accounts.client_id and c.accountant_id = auth.uid()
    )
  );
create policy "bank_accounts_delete_own" on public.bank_accounts
  for delete using (
    exists (
      select 1 from public.clients c
      where c.id = bank_accounts.client_id and c.accountant_id = auth.uid()
    )
  );

create policy "reconciliations_select_own" on public.reconciliations
  for select using (
    exists (
      select 1 from public.bank_accounts ba
      join public.clients c on c.id = ba.client_id
      where ba.id = reconciliations.bank_account_id and c.accountant_id = auth.uid()
    )
  );
create policy "reconciliations_insert_own" on public.reconciliations
  for insert with check (
    exists (
      select 1 from public.bank_accounts ba
      join public.clients c on c.id = ba.client_id
      where ba.id = reconciliations.bank_account_id and c.accountant_id = auth.uid()
    )
  );
create policy "reconciliations_update_own" on public.reconciliations
  for update using (
    exists (
      select 1 from public.bank_accounts ba
      join public.clients c on c.id = ba.client_id
      where ba.id = reconciliations.bank_account_id and c.accountant_id = auth.uid()
    )
  );

create policy "transactions_select_own" on public.transactions
  for select using (
    exists (
      select 1 from public.reconciliations r
      join public.bank_accounts ba on ba.id = r.bank_account_id
      join public.clients c on c.id = ba.client_id
      where r.id = transactions.reconciliation_id and c.accountant_id = auth.uid()
    )
  );
create policy "transactions_insert_own" on public.transactions
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      join public.bank_accounts ba on ba.id = r.bank_account_id
      join public.clients c on c.id = ba.client_id
      where r.id = transactions.reconciliation_id and c.accountant_id = auth.uid()
    )
  );

create policy "matches_select_own" on public.matches
  for select using (
    exists (
      select 1 from public.reconciliations r
      join public.bank_accounts ba on ba.id = r.bank_account_id
      join public.clients c on c.id = ba.client_id
      where r.id = matches.reconciliation_id and c.accountant_id = auth.uid()
    )
  );
create policy "matches_insert_own" on public.matches
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      join public.bank_accounts ba on ba.id = r.bank_account_id
      join public.clients c on c.id = ba.client_id
      where r.id = matches.reconciliation_id and c.accountant_id = auth.uid()
    )
  );
create policy "matches_update_own" on public.matches
  for update using (
    exists (
      select 1 from public.reconciliations r
      join public.bank_accounts ba on ba.id = r.bank_account_id
      join public.clients c on c.id = ba.client_id
      where r.id = matches.reconciliation_id and c.accountant_id = auth.uid()
    )
  );
