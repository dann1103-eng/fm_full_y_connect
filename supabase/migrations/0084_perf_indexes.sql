-- 0084_perf_indexes.sql
-- Indices para reducir latencia de queries identificadas como slow en el
-- panel de Query Performance de Supabase (mayo 2026).
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- ── 1) requirements: feed de "deadlines vencidas" ─────────────────────────
-- Query origen (notifications API): WHERE deadline < NOW() AND voided = false
--                                   AND phase NOT IN (...) ORDER BY deadline ASC
-- El indice existente idx_requirements_deadline (0034) cubre el ORDER BY pero
-- aun obliga a filtrar voided/phase post-lookup. Un indice parcial pre-filtra
-- a las filas relevantes.
create index if not exists requirements_open_deadline_idx
  on public.requirements (deadline asc)
  where voided = false
    and phase <> 'publicado_entregado';

-- ── 2) call_participants: presence "en_llamada" ───────────────────────────
-- Query origen (useUsersPresence): JOIN call_sessions WHERE left_at IS NULL
--                                  AND ended_at IS NULL
-- Esta query corre constantemente para detectar quien esta en llamada.
-- Un indice parcial sobre las filas activas (left_at IS NULL) mantiene el
-- indice diminuto incluso cuando la tabla crece.
create index if not exists call_participants_active_idx
  on public.call_participants (session_id, user_id)
  where left_at is null;

-- ── 3) messages: lookup por conversation_id + ordenamiento ────────────────
-- Query origen (inbox): WHERE conversation_id = ANY(...) AND deleted_at IS NULL
--                       ORDER BY created_at DESC LIMIT N
-- Indice parcial que excluye soft-deleted y permite usar el sort del indice.
create index if not exists messages_conv_active_created_idx
  on public.messages (conversation_id, created_at desc)
  where deleted_at is null;

commit;
