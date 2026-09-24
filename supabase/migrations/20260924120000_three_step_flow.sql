-- Fluxo de conciliação em 3 passos: 1) carregar, 2) preparar/confirmar os
-- dados lidos, 3) reconciliar. As linhas lidas de cada extrato ficam guardadas
-- para o utilizador poder sair, corrigir e voltar.

-- ---------- novo estado "review" (passo 2: a confirmar a leitura) ----------
alter table public.reconciliations
  drop constraint if exists reconciliations_status_check;

alter table public.reconciliations
  add constraint reconciliations_status_check
  check (status in ('pending', 'processing', 'review', 'completed', 'failed'));

-- ---------- statement_documents: um registo por ficheiro carregado ----------
create table if not exists public.statement_documents (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations (id) on delete cascade,
  source text not null check (source in ('bank', 'accounting')),
  file_name text not null,
  file_format text not null check (file_format in ('pdf', 'xlsx', 'csv')),
  read_status text not null default 'pending'
    check (read_status in ('pending', 'reading', 'ready', 'failed')),
  read_error text,
  -- banco ou programa de contabilidade detetado na leitura
  source_name text,
  period_start date,
  period_end date,
  opening_balance numeric(14, 2),
  closing_balance numeric(14, 2),
  -- totais que o próprio documento mostra (colunas Débito/Crédito da linha "Total")
  total_debits numeric(14, 2),
  total_credits numeric(14, 2),
  -- débitos/créditos acumulados que alguns razões mostram na linha de saldo inicial
  opening_row_debits numeric(14, 2),
  opening_row_credits numeric(14, 2),
  -- avisos da leitura (sinais corrigidos, problemas reportados pelo modelo)
  issues jsonb not null default '[]'::jsonb,
  retried boolean not null default false,
  lines_deleted integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reconciliation_id, source)
);

drop trigger if exists set_statement_documents_updated_at on public.statement_documents;
create trigger set_statement_documents_updated_at
  before update on public.statement_documents
  for each row execute procedure public.set_updated_at();

-- ---------- statement_lines: a tabela padrão de cada documento ----------
create table if not exists public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.reconciliations (id) on delete cascade,
  source text not null check (source in ('bank', 'accounting')),
  -- ordem no documento (com intervalos, para inserir linhas pelo meio)
  position integer not null,
  date date not null,
  description text not null default '',
  reference text,
  -- colunas tal como aparecem no documento (Débito/Crédito)
  debit numeric(14, 2),
  credit numeric(14, 2),
  -- valor com sinal, perspetiva da conta bancária (positivo entra, negativo sai)
  amount numeric(14, 2) not null,
  -- saldo depois do movimento, se o documento o indicar
  balance_after numeric(14, 2),
  -- página (p2) ou linha da folha (L15) de onde veio
  origin text,
  edited boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists statement_lines_recon_source_position_idx
  on public.statement_lines (reconciliation_id, source, position);

-- ---------- extraction_logs: registo para acompanhar a qualidade da leitura ----------
-- Sem descrições nem valores individuais de movimentos. Só é lido/escrito com
-- a service role (não há políticas para os utilizadores).
create table if not exists public.extraction_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reconciliation_id uuid references public.reconciliations (id) on delete set null,
  source text not null check (source in ('bank', 'accounting')),
  file_format text not null check (file_format in ('pdf', 'xlsx', 'csv')),
  source_name text,
  line_count integer not null default 0,
  verified boolean not null default false,
  difference_eur numeric(14, 2),
  retried boolean not null default false,
  edited_lines integer not null default 0
);

create index if not exists extraction_logs_created_at_idx
  on public.extraction_logs (created_at desc);

-- ========================================================================
-- Row Level Security (igual às outras tabelas: só o dono da conciliação)
-- ========================================================================

alter table public.statement_documents enable row level security;
alter table public.statement_lines enable row level security;
alter table public.extraction_logs enable row level security;

drop policy if exists "statement_documents_select_own" on public.statement_documents;
create policy "statement_documents_select_own" on public.statement_documents
  for select using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_documents.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_documents_insert_own" on public.statement_documents;
create policy "statement_documents_insert_own" on public.statement_documents
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_documents.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_documents_update_own" on public.statement_documents;
create policy "statement_documents_update_own" on public.statement_documents
  for update using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_documents.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_documents_delete_own" on public.statement_documents;
create policy "statement_documents_delete_own" on public.statement_documents
  for delete using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_documents.reconciliation_id and r.created_by = auth.uid()
    )
  );

drop policy if exists "statement_lines_select_own" on public.statement_lines;
create policy "statement_lines_select_own" on public.statement_lines
  for select using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_lines.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_lines_insert_own" on public.statement_lines;
create policy "statement_lines_insert_own" on public.statement_lines
  for insert with check (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_lines.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_lines_update_own" on public.statement_lines;
create policy "statement_lines_update_own" on public.statement_lines
  for update using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_lines.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "statement_lines_delete_own" on public.statement_lines;
create policy "statement_lines_delete_own" on public.statement_lines
  for delete using (
    exists (
      select 1 from public.reconciliations r
      where r.id = statement_lines.reconciliation_id and r.created_by = auth.uid()
    )
  );

-- Os matches e as transações antigas têm de poder ser apagados quando o
-- utilizador volta aos dados e reconcilia de novo.
drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions
  for delete using (
    exists (
      select 1 from public.reconciliations r
      where r.id = transactions.reconciliation_id and r.created_by = auth.uid()
    )
  );
drop policy if exists "matches_delete_own" on public.matches;
create policy "matches_delete_own" on public.matches
  for delete using (
    exists (
      select 1 from public.reconciliations r
      where r.id = matches.reconciliation_id and r.created_by = auth.uid()
    )
  );
