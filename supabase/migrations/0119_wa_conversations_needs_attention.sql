-- 0119_wa_conversations_needs_attention.sql
-- Bandera semántica de "requiere atención humana" para conversaciones de WhatsApp.
--
-- Contexto: la tool handoff_to_human solo ponía bot_paused=true + unread_count=1
-- (indistinguible de un no-leído normal y ambiguo con la pausa manual del staff),
-- y la campana global nunca consultaba WhatsApp → nadie se enteraba del handoff.
-- Esta columna la fija el handoff y la limpia el staff al atender; alimenta un
-- nuevo aviso en la campana y un resaltado en el inbox /whatsapp.

alter table public.wa_conversations
  add column if not exists needs_attention boolean not null default false,
  add column if not exists attention_reason text,
  add column if not exists attention_at timestamptz;

-- Índice parcial: la campana consulta solo las que requieren atención.
create index if not exists wa_conversations_needs_attention_idx
  on public.wa_conversations (needs_attention)
  where needs_attention;

-- wa_conversations ya está en la publicación supabase_realtime con REPLICA
-- IDENTITY FULL (migración 0112), así que el UPDATE de la bandera llega al
-- inbox por realtime sin cambios adicionales.
