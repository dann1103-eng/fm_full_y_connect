-- 0054_portal_client_rls_items_and_plans.sql
-- Políticas SELECT faltantes para que los clientes del portal puedan leer:
-- 1) invoice_items  — la factura del cliente sin líneas de detalle se ve vacía
-- 2) quote_items    — mismo caso para cotizaciones
-- 3) plans          — Mi Empresa muestra el plan contratado (read-only)
--
-- La migración 0052 agregó policies para invoices/quotes via is_client_of(client_id),
-- pero no para las tablas de items ni para plans.

begin;

-- 1) invoice_items: cliente puede ver las líneas de sus propias facturas
create policy "invoice_items_select_client" on public.invoice_items
  for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_client_of(i.client_id)
    )
  );

-- 2) quote_items: cliente puede ver las líneas de sus propias cotizaciones
create policy "quote_items_select_client" on public.quote_items
  for select
  using (
    exists (
      select 1 from public.quotes q
      where q.id = quote_items.quote_id
        and public.is_client_of(q.client_id)
    )
  );

-- 3) plans: cliente puede ver el plan asignado a sus clients vinculados.
--    Nota: la policy "Agency users can view plans" de 0001 sigue activa para staff.
create policy "plans_select_own_via_clients" on public.plans
  for select
  using (
    exists (
      select 1 from public.clients c
      where c.current_plan_id = plans.id
        and public.is_client_of(c.id)
    )
  );

commit;
