-- 0056_requirement_messages_realtime.sql
-- Habilita realtime para requirement_messages.
-- Sin esto, los postgres_changes del chat de requerimiento no disparan
-- en el cliente Supabase y el chat no actualiza en tiempo real.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'requirement_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.requirement_messages';
    end if;
  end if;
end $$;
