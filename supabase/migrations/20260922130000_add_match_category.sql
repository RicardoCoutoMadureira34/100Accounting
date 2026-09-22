-- Categoria fechada para movimentos sem correspondência ("Só no Banco" /
-- "Só na Contabilidade"), além da explicação em texto livre já existente em
-- "note". Permite agrupar e subtotalizar por causa no ecrã e no Excel.
alter table public.matches
  add column category text
    check (
      category is null
      or category in (
        'cheque_em_transito',
        'deposito_em_transito',
        'debito_nao_registado',
        'comissao_juro_bancario',
        'erro_transcricao',
        'duplicado',
        'outro'
      )
    );
