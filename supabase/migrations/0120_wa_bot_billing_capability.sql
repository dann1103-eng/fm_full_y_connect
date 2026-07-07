-- 0120_wa_bot_billing_capability.sql
-- Habilita en el bot de clientes las tools de facturación/autoservicio:
--   send_payment_link  → reenvía/regenera el enlace de pago de una factura pendiente.
--   create_extra_invoice → EMITE una factura de un extra de catálogo + enlace n1co.
-- Y agrega la guía de prompt (confirmación antes de emitir, precios de catálogo).
--
-- Se APÉNDAN las tools (no se reemplaza el array, que 0116 ya modificó) de forma
-- idempotente. El prompt se apéndan solo si aún no contiene la sección.

begin;

-- ── Habilitar tools (append idempotente sobre el array text[]) ────────────────
update public.wa_bot_configs
set enabled_tools = enabled_tools || array['send_payment_link']
where audience = 'client'
  and not (enabled_tools @> array['send_payment_link']::text[]);

update public.wa_bot_configs
set enabled_tools = enabled_tools || array['create_extra_invoice']
where audience = 'client'
  and not (enabled_tools @> array['create_extra_invoice']::text[]);

-- ── Guía de prompt de facturación (append idempotente) ───────────────────────
update public.wa_bot_configs
set system_prompt = system_prompt || $bill$

# FACTURACIÓN Y PAGOS (autoservicio)
- Si el cliente quiere PAGAR una factura pendiente ("quiero pagar", "pásame el link"): usa send_payment_link y compártele el enlace. NO creas nada.
- Si el cliente quiere COMPRAR un EXTRA de catálogo (contenido adicional o paquete de cambios): usa create_extra_invoice. Precios FIJOS de catálogo: estático $15, video corto $20, reel $25, short $15; paquete de 5 cambios $25.
  - SIEMPRE confirma el ítem y el monto EXACTO antes de emitir: "voy a generar tu factura de X por $Y, ¿confirmas?". Emite SOLO si el cliente responde que sí.
  - Nunca inventes precios ni montos fuera del catálogo.
- OVERRIDE: aunque otras partes de estas instrucciones digan "escalar para agregar paquete extra", para EXTRAS de catálogo (contenido/cambios) usa create_extra_invoice directamente. Escala con handoff_to_human SOLO para: renovación del plan, montos o ítems fuera del catálogo, disputas de cobro, o cambios de plan.
- Tras emitir, comparte el enlace de pago; el pago se confirma automáticamente.
$bill$
where audience = 'client'
  and system_prompt not like '%FACTURACIÓN Y PAGOS (autoservicio)%';

commit;
