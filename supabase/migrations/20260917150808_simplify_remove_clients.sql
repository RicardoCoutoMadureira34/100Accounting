-- Simplificação do produto: sem gestão de clientes/contas bancárias.
-- Uma conciliação pertence diretamente ao contabilista (profiles). O Claude
-- passa a fazer a leitura E o raciocínio de reconciliação numa só chamada
-- (ver src/lib/reconciliation/analyze.ts), por isso os "matches" passam a
-- incluir uma explicação ("note") em vez de serem só geometria de datas/valores.

drop table if exists public.matches cascade;
drop table if exists public.transactions cascade;
drop table if exists public.reconciliations cascade;
drop table if exists public.bank_accounts cascade;
drop table if exists public.clients cascade;

-- ---------- reconciliations ----------
create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  bank_statement_path text,
  accounting_statement_path text,
  bank_balance numeric(14, 2),
  accounting_balance numeric(14, 2),
  difference numeric(14, 2),
  closes boolean,
  summary text,
  issues jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reconciliations_created_by_idx on public.reconciliations (created_by);

create trigger set_reconciliations_updated_at
  before update on public.reconciliations
  for each row execute procedure public.set_updated_at();

-- ---------- transactions ----------
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
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations (id) on delete cascade,
  bank_transaction_id uuid references public.transactions (id) on delete set null,
  accounting_transaction_id uuid references public.transactions (id) on delete set null,
  match_type text not null
    check (match_type in ('exact', 'probable', 'unmatched_bank', 'unmatched_accounting')),
  confidence numeric(5, 2),
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index matches_reconciliation_id_idx on public.matches (reconciliation_id);

-- ========================================================================
-- Row Level Security
-- ========================================================================

alter table public.reconciliations enable row level security;
alter table public.transactions enable row level security;
alter table public.matches enable row level security;

create policy "reconciliations_select_own" on public.reconciliations
  for select using (created_by = auth.uid());
create policy "reconciliations_insert_own" on public.reconciliations
  for insert with check (created_by = auth.uid());
create policy "reconciliations_update_own" on public.reconciliations
  for update using (created_by = auth.uid());
create policy "reconciliations_delete_own" on public.reconciliations
  for delete using (created_by = auth.uid());

create policy "transactions_select_own" on public.transactions
  for select using (
    exists (
      select 1 from public.reconciliations r
      where r.id = transactions.reconciliation_id and r.created_by = auth.uid()
    )
  );
create policy "transactions_insert_own" on public.transactions
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      where r.id = transactions.reconciliation_id and r.created_by = auth.uid()
    )
  );

create policy "matches_select_own" on public.matches
  for select using (
    exists (
      select 1 from public.reconciliations r
      where r.id = matches.reconciliation_id and r.created_by = auth.uid()
    )
  );
create policy "matches_insert_own" on public.matches
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      where r.id = matches.reconciliation_id and r.created_by = auth.uid()
    )
  );
create policy "matches_update_own" on public.matches
  for update using (
    exists (
      select 1 from public.reconciliations r
      where r.id = matches.reconciliation_id and r.created_by = auth.uid()
    )
  );
