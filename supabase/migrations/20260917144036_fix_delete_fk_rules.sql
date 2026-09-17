-- reconciliations.created_by e matches.reviewed_by não tinham regra de
-- eliminação em cascata: apagar um profile (ex.: apagar o utilizador Auth)
-- ficava bloqueado com "Database error deleting user" por violação de FK.
--
-- created_by é NOT NULL, por isso cascata (a conciliação já desaparece de
-- qualquer forma pela cadeia bank_accounts -> clients quando o contabilista
-- é apagado). reviewed_by é opcional, por isso fica a null em vez de
-- arrastar o match consigo.

alter table public.reconciliations
  drop constraint reconciliations_created_by_fkey,
  add constraint reconciliations_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete cascade;

alter table public.matches
  drop constraint matches_reviewed_by_fkey,
  add constraint matches_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles (id) on delete set null;
