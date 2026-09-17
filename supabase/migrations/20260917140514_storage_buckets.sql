-- Bucket privado para os PDFs carregados (extrato bancário + extrato da
-- contabilidade). Convenção de caminho: "<accountant_id>/<reconciliation_id>/<ficheiro>"
-- para que as políticas de RLS possam isolar por contabilista.

insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

create policy "statements_select_own" on storage.objects
  for select using (
    bucket_id = 'statements'
    and (storage.foldername(name)) [1] = auth.uid()::text
  );

create policy "statements_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'statements'
    and (storage.foldername(name)) [1] = auth.uid()::text
  );

create policy "statements_delete_own" on storage.objects
  for delete using (
    bucket_id = 'statements'
    and (storage.foldername(name)) [1] = auth.uid()::text
  );
