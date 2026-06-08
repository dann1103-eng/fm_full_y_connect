-- 0112_wa_replica_identity_full.sql
-- Habilita REPLICA IDENTITY FULL en wa_conversations y wa_messages para que
-- los payloads de realtime UPDATE traigan TODOS los campos del row (no solo
-- la PK). Esto permite que el sidebar y el chat apliquen los cambios
-- directamente sin necesidad de re-querear, lo que evita problemas de RLS
-- silenciosa o latencia en la lectura.

begin;

alter table public.wa_conversations replica identity full;
alter table public.wa_messages replica identity full;
alter table public.wa_leads replica identity full;

commit;
