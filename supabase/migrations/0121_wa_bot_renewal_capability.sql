-- 0121_wa_bot_renewal_capability.sql
-- Habilita la tool create_renewal_invoice en el bot de clientes (renovación del
-- plan por WhatsApp; solo planes monthly, otros → handoff) + guía de prompt.
-- Append idempotente sobre enabled_tools (text[]) y system_prompt.

begin;

update public.wa_bot_configs
set enabled_tools = enabled_tools || array['create_renewal_invoice']
where audience = 'client'
  and not (enabled_tools @> array['create_renewal_invoice']::text[]);

update public.wa_bot_configs
set system_prompt = system_prompt || $ren$

## Renovación del plan (autoservicio)
- Si el cliente quiere RENOVAR o pagar su próximo mes, confirma primero ("voy a generar tu renovación del plan X, ¿confirmas?") y luego usa create_renewal_invoice. Emite una factura fiscal real.
- Si create_renewal_invoice devuelve needs_human=true (plan quincenal o bimestral), NO insistas ni inventes montos: usa handoff_to_human para que el equipo gestione la renovación.
- Tras emitir, comparte el enlace de pago; el pago se confirma automáticamente.
$ren$
where audience = 'client'
  and system_prompt not like '%Renovación del plan (autoservicio)%';

commit;
