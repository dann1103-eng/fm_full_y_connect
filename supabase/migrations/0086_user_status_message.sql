-- 0086_user_status_message.sql
-- Status descriptivo libre del usuario (emoji + texto corto, "for fun":
-- "feliz", "ocupado", "en café", etc). NO reemplaza el status formal de
-- presencia (online/away/almuerzo) — es un complemento descriptivo.
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

alter table public.user_presence
  add column if not exists status_emoji text,
  add column if not exists status_message text;

-- Constraints suaves: limitar largo para que no abuse la UI
alter table public.user_presence
  drop constraint if exists user_presence_status_emoji_len_check,
  drop constraint if exists user_presence_status_message_len_check;

alter table public.user_presence
  add constraint user_presence_status_emoji_len_check
    check (status_emoji is null or char_length(status_emoji) <= 8),
  add constraint user_presence_status_message_len_check
    check (status_message is null or char_length(status_message) <= 60);

-- user_presence ya está en publicación supabase_realtime (migración 0072),
-- así que estos campos se propagan automáticamente.

commit;
