-- Passo 2 saltado automaticamente quando a leitura está confirmada.

-- Quantos valores/datas não se conseguiram converter na leitura do ficheiro
-- (0 = conversão limpa). Serve para decidir se o passo 2 pode ser saltado.
alter table public.statement_documents
  add column if not exists conversion_problems integer not null default 0;

-- Registo: o passo 2 foi saltado (true), mostrado (false) ou ainda não se sabe (null).
alter table public.extraction_logs
  add column if not exists step2_skipped boolean;
