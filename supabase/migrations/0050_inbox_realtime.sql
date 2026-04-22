-- Habilita Supabase Realtime para el chat interno.
-- Antes: useInboxPolling.ts se suscribía a postgres_changes, pero las tablas no
-- estaban en la publicación supabase_realtime, por lo que los eventos nunca
-- llegaban y la UI dependía de un poll de seguridad de 60s.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.messages';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.conversations';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.conversation_members';
    exception when duplicate_object then null;
    end;
  end if;
end$$;

-- REPLICA IDENTITY FULL para que el payload de UPDATE/DELETE incluya todas las
-- columnas (el cliente filtra por conversation_id en payload.old de DELETE).
alter table public.messages replica identity full;
alter table public.conversation_members replica identity full;

notify pgrst, 'reload schema';
