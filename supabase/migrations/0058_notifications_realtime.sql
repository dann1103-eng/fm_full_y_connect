-- Habilita realtime para las tablas fuente del feed de notificaciones.
-- Antes sólo estaban publicadas messages/conversations/conversation_members (0050)
-- y requirement_messages (0056), por eso el hook useNotifications dependía
-- del safety poll de 60s.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.requirement_mentions';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.review_comment_mentions';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.time_entries';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.invoices';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.requirements';
    exception when duplicate_object then null;
    end;
  end if;
end$$;

-- REPLICA IDENTITY FULL para que los payloads de UPDATE traigan todas las columnas
-- (necesario para filtrar por mentioned_user_id / assignees en el cliente).
alter table public.requirement_mentions replica identity full;
alter table public.review_comment_mentions replica identity full;
alter table public.time_entries replica identity full;
alter table public.requirements replica identity full;

notify pgrst, 'reload schema';
