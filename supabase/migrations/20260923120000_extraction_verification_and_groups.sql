-- Ligações um-para-vários (ex.: 30 + 60 + 130 no banco = 220 na contabilidade):
-- os matches do mesmo grupo partilham o mesmo group_id (null = par 1 para 1).
alter table public.matches
  add column if not exists group_id uuid;

create index if not exists matches_group_id_idx
  on public.matches (group_id)
  where group_id is not null;

-- Saldos iniciais de cada extrato (o saldo final já existia em bank_balance /
-- accounting_balance) e se a leitura dos PDFs passou nas verificações
-- aritméticas (saldo inicial + movimentos = saldo final, totais, saldo linha
-- a linha).
alter table public.reconciliations
  add column if not exists bank_opening_balance numeric(14, 2),
  add column if not exists accounting_opening_balance numeric(14, 2),
  add column if not exists extraction_verified boolean;
