-- ============================================================
-- FM CRM — Migration 0048: Módulo de Facturación y Cotización
-- ============================================================
-- Añade:
--   1. Campos fiscales en `clients` (razón social, NIT, NRC, DUI, dirección, giro, IVA default).
--   2. Tabla `company_settings` (singleton con datos fiscales de FM como emisor).
--   3. Tablas `invoices` / `invoice_items`, `quotes` / `quote_items`.
--   4. Secuencias de correlativos anuales para INV-YYYYnnnnnnn y QUO-YYYYnnnnnnn.
--   5. Trigger que restringe edición de campos fiscales de `clients` a admins.
--   6. RLS (admin UPDATE; agency users SELECT) sobre todas las tablas nuevas.
-- ============================================================

-- ── 1. Campos fiscales en clients ────────────────────────────
alter table public.clients
  add column if not exists legal_name       text,
  add column if not exists person_type      text check (person_type in ('natural','juridical')),
  add column if not exists nit              text,
  add column if not exists nrc              text,
  add column if not exists dui              text,
  add column if not exists fiscal_address   text,
  add column if not exists giro             text,
  add column if not exists country_code     text default 'SV',
  add column if not exists default_tax_rate numeric(5,4) default 0.13;

-- Trigger: solo admins pueden modificar campos fiscales.
create or replace function public.clients_fiscal_admin_only()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    if new.legal_name       is distinct from old.legal_name
    or new.person_type      is distinct from old.person_type
    or new.nit              is distinct from old.nit
    or new.nrc              is distinct from old.nrc
    or new.dui              is distinct from old.dui
    or new.fiscal_address   is distinct from old.fiscal_address
    or new.giro             is distinct from old.giro
    or new.country_code     is distinct from old.country_code
    or new.default_tax_rate is distinct from old.default_tax_rate then
      raise exception 'Solo los administradores pueden modificar los datos fiscales del cliente.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_fiscal_admin_only on public.clients;
create trigger clients_fiscal_admin_only
  before update on public.clients
  for each row execute procedure public.clients_fiscal_admin_only();


-- ── 2. company_settings (emisor) ─────────────────────────────
create table if not exists public.company_settings (
  id                         uuid primary key default gen_random_uuid(),
  legal_name                 text not null,
  trade_name                 text,
  nit                        text,
  nrc                        text,
  fiscal_address             text,
  giro                       text,
  phone                      text,
  email                      text,
  logo_url                   text,
  invoice_footer_note        text,
  payment_methods_json       jsonb not null default '[]'::jsonb,
  terms_and_conditions_json  jsonb not null default '[]'::jsonb,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references public.users(id)
);

alter table public.company_settings enable row level security;

create policy "company_settings_select_agency"
  on public.company_settings for select
  using (public.is_agency_user());

create policy "company_settings_insert_admin"
  on public.company_settings for insert
  with check (public.is_admin());

create policy "company_settings_update_admin"
  on public.company_settings for update
  using (public.is_admin());

create policy "company_settings_delete_admin"
  on public.company_settings for delete
  using (public.is_admin());

grant all on public.company_settings to anon, authenticated, service_role;

-- Seed inicial con datos oficiales de FM (tarjeta IVA).
insert into public.company_settings (
  legal_name, trade_name, nit, nrc,
  fiscal_address, giro,
  payment_methods_json, terms_and_conditions_json
)
select
  'MORATAYA DE FLOTRES, LAURA MARIA',
  'FM COMMUNICATION SOLUTIONS',
  '0467-1632-2',
  '371163-1',
  'Calle Belice, Psj. 4, Col. Centroamérica, #7, Distrito de San Salvador, Municipio de San Salvador Centro, Departamento de San Salvador',
  'Publicidad',
  '[
    {"id":"pm_bac","type":"bank","label":"Banco BAC","account_holder":"Laura María Morataya de Flores","account_number":"116244039","account_type":"Cuenta corriente"},
    {"id":"pm_card","type":"card","label":"Tarjeta de crédito/débito","note":"Solicitar enlace de pago al ejecutivo"}
  ]'::jsonb,
  '[
    {"id":"tc_01","order":1,"text":"Esta cotización tiene una validez de 15 días calendario a partir de la fecha de emisión."},
    {"id":"tc_02","order":2,"text":"Los precios están expresados en dólares de los Estados Unidos de América (USD)."},
    {"id":"tc_03","order":3,"text":"Para clientes locales (El Salvador) el IVA del 13% está incluido según indique la factura."},
    {"id":"tc_04","order":4,"text":"Para clientes del exterior los servicios se emiten exentos de IVA."},
    {"id":"tc_05","order":5,"text":"La aceptación de esta cotización implica el pago del 50% como anticipo para iniciar el servicio."},
    {"id":"tc_06","order":6,"text":"El saldo restante se cancela contra entrega del servicio/producto contratado."},
    {"id":"tc_07","order":7,"text":"Los tiempos de entrega se contabilizan a partir de la recepción del anticipo y del material requerido por el cliente."},
    {"id":"tc_08","order":8,"text":"Cualquier modificación fuera del alcance cotizado será cotizada por separado."},
    {"id":"tc_09","order":9,"text":"FM Communication Solutions se reserva los derechos de autor de todo material creativo hasta el pago total."},
    {"id":"tc_10","order":10,"text":"Los métodos de pago aceptados son transferencia bancaria y tarjeta de crédito/débito (ver datos de pago)."},
    {"id":"tc_11","order":11,"text":"Cualquier consulta sobre esta cotización puede dirigirse al ejecutivo asignado."}
  ]'::jsonb
where not exists (select 1 from public.company_settings);


-- ── 3. Secuencias de correlativos (por año) ───────────────────
-- Una secuencia global por tipo de documento; el año va prepended en el número formateado.
create sequence if not exists public.invoice_number_seq;
create sequence if not exists public.quote_number_seq;

-- RPCs para consumir correlativos (seguras para ser llamadas desde server actions).
create or replace function public.next_invoice_number()
returns text language plpgsql security definer as $$
declare
  n bigint;
  y int;
begin
  n := nextval('public.invoice_number_seq');
  y := extract(year from now())::int;
  return format('INV-%s%s', y, lpad(n::text, 7, '0'));
end;
$$;

create or replace function public.next_quote_number()
returns text language plpgsql security definer as $$
declare
  n bigint;
  y int;
begin
  n := nextval('public.quote_number_seq');
  y := extract(year from now())::int;
  return format('QUO-%s%s', y, lpad(n::text, 7, '0'));
end;
$$;

grant execute on function public.next_invoice_number() to authenticated;
grant execute on function public.next_quote_number() to authenticated;


-- ── 4. invoices + invoice_items ──────────────────────────────
create table if not exists public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  invoice_number        text unique not null,
  client_id             uuid not null references public.clients(id) on delete restrict,
  billing_cycle_id      uuid references public.billing_cycles(id) on delete set null,
  quote_id              uuid,  -- FK se añade después de crear quotes
  issue_date            date not null default current_date,
  due_date              date,
  currency              text not null default 'USD',
  subtotal              numeric(12,2) not null default 0,
  discount_amount       numeric(12,2) not null default 0,
  tax_rate              numeric(5,4)  not null default 0.13,
  tax_amount            numeric(12,2) not null default 0,
  total                 numeric(12,2) not null default 0,
  status                text not null default 'draft'
                          check (status in ('draft','issued','paid','void')),
  payment_date          date,
  payment_method        text,
  payment_reference     text,
  notes                 text,
  client_snapshot_json  jsonb not null,
  emitter_snapshot_json jsonb not null,
  void_reason           text,
  void_by               uuid references public.users(id),
  void_at               timestamptz,
  created_by            uuid references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists invoices_client_id_idx      on public.invoices (client_id);
create index if not exists invoices_billing_cycle_idx  on public.invoices (billing_cycle_id);
create index if not exists invoices_status_idx         on public.invoices (status);
create index if not exists invoices_issue_date_idx     on public.invoices (issue_date desc);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute procedure public.update_updated_at();

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity    numeric(10,2) not null default 1,
  unit_price  numeric(12,2) not null,
  line_total  numeric(12,2) not null,
  sort_order  int not null default 0
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;

-- SELECT: cualquier agency user (para que supervisores/admins vean el módulo).
create policy "invoices_select_agency"      on public.invoices      for select using (public.is_agency_user());
create policy "invoice_items_select_agency" on public.invoice_items for select using (public.is_agency_user());

-- INSERT/UPDATE/DELETE: solo admin (emisión controlada).
create policy "invoices_insert_admin" on public.invoices for insert with check (public.is_admin());
create policy "invoices_update_admin" on public.invoices for update using (public.is_admin());
create policy "invoices_delete_admin" on public.invoices for delete using (public.is_admin());

create policy "invoice_items_insert_admin" on public.invoice_items for insert with check (public.is_admin());
create policy "invoice_items_update_admin" on public.invoice_items for update using (public.is_admin());
create policy "invoice_items_delete_admin" on public.invoice_items for delete using (public.is_admin());

grant all on public.invoices      to anon, authenticated, service_role;
grant all on public.invoice_items to anon, authenticated, service_role;


-- ── 5. quotes + quote_items ──────────────────────────────────
create table if not exists public.quotes (
  id                     uuid primary key default gen_random_uuid(),
  quote_number           text unique not null,
  client_id              uuid not null references public.clients(id) on delete restrict,
  issue_date             date not null default current_date,
  valid_until            date,
  currency               text not null default 'USD',
  subtotal               numeric(12,2) not null default 0,
  discount_amount        numeric(12,2) not null default 0,
  tax_rate               numeric(5,4)  not null default 0.13,
  tax_amount             numeric(12,2) not null default 0,
  total                  numeric(12,2) not null default 0,
  status                 text not null default 'draft'
                           check (status in ('draft','sent','accepted','rejected','expired')),
  notes                  text,
  client_snapshot_json   jsonb not null,
  emitter_snapshot_json  jsonb not null,
  terms_snapshot_json    jsonb not null default '[]'::jsonb,
  converted_invoice_id   uuid references public.invoices(id) on delete set null,
  created_by             uuid references public.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists quotes_client_id_idx  on public.quotes (client_id);
create index if not exists quotes_status_idx     on public.quotes (status);
create index if not exists quotes_issue_date_idx on public.quotes (issue_date desc);

create trigger quotes_updated_at
  before update on public.quotes
  for each row execute procedure public.update_updated_at();

create table if not exists public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  quantity    numeric(10,2) not null default 1,
  unit_price  numeric(12,2) not null,
  line_total  numeric(12,2) not null,
  sort_order  int not null default 0
);

create index if not exists quote_items_quote_id_idx on public.quote_items (quote_id);

-- FK bidireccional invoices.quote_id → quotes.id (ahora que quotes existe).
alter table public.invoices
  add constraint invoices_quote_id_fkey
  foreign key (quote_id) references public.quotes(id) on delete set null;

alter table public.quotes      enable row level security;
alter table public.quote_items enable row level security;

create policy "quotes_select_agency"      on public.quotes      for select using (public.is_agency_user());
create policy "quote_items_select_agency" on public.quote_items for select using (public.is_agency_user());

create policy "quotes_insert_admin" on public.quotes for insert with check (public.is_admin());
create policy "quotes_update_admin" on public.quotes for update using (public.is_admin());
create policy "quotes_delete_admin" on public.quotes for delete using (public.is_admin());

create policy "quote_items_insert_admin" on public.quote_items for insert with check (public.is_admin());
create policy "quote_items_update_admin" on public.quote_items for update using (public.is_admin());
create policy "quote_items_delete_admin" on public.quote_items for delete using (public.is_admin());

grant all on public.quotes      to anon, authenticated, service_role;
grant all on public.quote_items to anon, authenticated, service_role;


-- ── 6. Reload PostgREST schema ───────────────────────────────
notify pgrst, 'reload schema';
