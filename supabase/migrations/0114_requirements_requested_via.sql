-- 0114_requirements_requested_via.sql
-- Trazabilidad del canal por el que se solicitó un requerimiento.
-- Útil para auditar cuántos contenidos vienen vía portal, bot de WhatsApp, etc.

begin;

alter table public.requirements
  add column if not exists requested_via text not null default 'portal'
    check (requested_via in ('portal', 'whatsapp_bot', 'staff', 'unknown'));

create index if not exists requirements_requested_via_idx
  on public.requirements(requested_via, registered_at desc)
  where requested_via <> 'portal';

commit;
