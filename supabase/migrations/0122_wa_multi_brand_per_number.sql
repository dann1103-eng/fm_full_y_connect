-- 0122_wa_multi_brand_per_number.sql
-- Permite vincular VARIAS marcas (clientes) a un mismo número de WhatsApp.
--   - client_whatsapp_contacts: unique(phone_e164) GLOBAL → unique(client_id, phone_e164).
--   - wa_conversations.client_id se reinterpreta como la "marca ACTIVA" (ya nullable).
--     Las marcas candidatas se derivan en runtime desde client_whatsapp_contacts.
--   - Habilita las tools list_linked_brands + set_active_brand + guía de prompt.

begin;

-- ── 1. Constraint: de global a compuesto (idempotente) ───────────────────────
alter table public.client_whatsapp_contacts
  drop constraint if exists client_whatsapp_contacts_phone_e164_key;
-- Por si el unique se hubiera creado como índice suelto en algún entorno:
drop index if exists client_whatsapp_contacts_phone_e164_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_whatsapp_contacts_client_phone_key'
  ) then
    alter table public.client_whatsapp_contacts
      add constraint client_whatsapp_contacts_client_phone_key unique (client_id, phone_e164);
  end if;
end $$;

-- ── 2. Habilitar tools multi-marca (append idempotente) ──────────────────────
update public.wa_bot_configs
set enabled_tools = enabled_tools || array['list_linked_brands']
where audience = 'client'
  and not (enabled_tools @> array['list_linked_brands']::text[]);

update public.wa_bot_configs
set enabled_tools = enabled_tools || array['set_active_brand']
where audience = 'client'
  and not (enabled_tools @> array['set_active_brand']::text[]);

-- ── 3. Guía de prompt (append idempotente) ───────────────────────────────────
update public.wa_bot_configs
set system_prompt = system_prompt || $mb$

## Varias marcas en un mismo número (multi-marca)
- Algunos números administran VARIAS marcas. Si una tool responde needs_brand_selection=true, o no sabes de cuál marca habla el cliente:
  1. Llama list_linked_brands para ver las marcas vinculadas al número.
  2. Pregúntale al cliente de cuál marca quiere hablar.
  3. Fíjala con set_active_brand.
- NUNCA des información ni crees solicitudes/facturas sin una marca activa confirmada (mezclar datos de marcas distintas es un error grave).
- La marca activa se mantiene hasta que el cliente indique EXPLÍCITAMENTE que quiere hablar de OTRA marca; ahí vuelve a preguntar y fíjala de nuevo.
$mb$
where audience = 'client'
  and system_prompt not like '%Varias marcas en un mismo número (multi-marca)%';

commit;
