-- supabase/migrations/0090_client_request_attachments.sql
-- Agrega columnas de adjuntos y links a solicitudes del cliente,
-- y policy RLS UPDATE para que el cliente pueda editar sus propias solicitudes pending.

begin;

alter table public.requirements
  add column if not exists client_request_attachments_json jsonb null,
  add column if not exists client_request_links_json jsonb null;

-- RLS: work user puede actualizar sus propias solicitudes mientras estén pending.
-- La server action usa adminClient (bypass RLS), así que esta policy es defensa adicional.
drop policy if exists "Work users can update own pending requests" on public.requirements;
create policy "Work users can update own pending requests" on public.requirements
  for update
  using (
    approval_status = 'pending'
    and voided = false
    and requested_by_user_id = auth.uid()
    and exists (
      select 1 from public.billing_cycles bc
      where bc.id = requirements.billing_cycle_id
        and public.is_work_user_of(bc.client_id)
    )
  )
  with check (
    approval_status = 'pending'
    and requested_by_user_id = auth.uid()
  );

commit;
