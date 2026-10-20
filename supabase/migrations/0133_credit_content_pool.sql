-- 0133_credit_content_pool.sql
-- Paquete on-demand para clientes de plan mensual.
--
-- CONTEXTO: los créditos (0063) son por tipo de contenido (estático, video corto, reel, short) y
-- solo nacían al pagar una factura "extra" de un tipo. No existía "N contenidos de cualquier tipo",
-- que es lo que vende el plan ON-DEMAND, y un cliente mensual no podía tener ambos. Se agrega un
-- tipo de crédito comodín: `content_pool` cubre cualquiera de los cuatro tipos vendibles y se
-- descuenta solo cuando el contenido excede el cupo del mes (después de los créditos por tipo).
-- Sin caducidad, como el resto de los créditos.
--
-- Cómo nace un saldo:
--   1) Factura pagada con extras_metadata { kind: 'content_pool', qty: N } (grantCreditsFromInvoice).
--   2) Ajuste manual de un admin (server action adjustContentPoolCredits): fila sin factura,
--      con `granted_by` y `notes` para auditoría.
--
-- NOTA: ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción que lo agrega; esta
-- migración no lo usa, así que corre completa en el SQL Editor.

alter type credit_kind add value if not exists 'content_pool';

alter table public.client_credits
  add column if not exists granted_by uuid references public.users(id) on delete set null;

comment on column public.client_credits.granted_by is
  'Admin que agregó el saldo a mano (sin factura). Null cuando el crédito nació de una factura pagada.';

-- VERIFICACIÓN (correr aparte):
--   select enumlabel from pg_enum where enumtypid = 'credit_kind'::regtype order by enumsortorder;
--   -- debe listar: cambios, content_estatico, content_video_corto, content_reel, content_short, content_pool
