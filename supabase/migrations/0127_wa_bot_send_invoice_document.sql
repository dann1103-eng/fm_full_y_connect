-- 0127_wa_bot_send_invoice_document.sql
-- Habilita la tool send_invoice_document en el bot de clientes: envía el PDF de
-- una factura ya emitida como documento adjunto por WhatsApp.
-- Append idempotente sobre enabled_tools (text[]) y system_prompt.
--
-- Reutiliza la infra construida para el recordatorio de vencimiento (0126):
-- render del PDF sin sesión + upload de media a Meta.
--
-- Va como mensaje LIBRE (no plantilla) porque el cliente acaba de escribir, así
-- que la ventana de 24h de Meta está abierta.

begin;

update public.wa_bot_configs
set enabled_tools = enabled_tools || array['send_invoice_document']
where audience = 'client'
  and not (enabled_tools @> array['send_invoice_document']::text[]);

update public.wa_bot_configs
set system_prompt = system_prompt || $doc$

## Enviar el PDF de una factura
- Si el cliente pide su factura como archivo/documento/PDF ("mándame mi factura", "necesito el comprobante", "pásame el PDF"), usa send_invoice_document. Sin argumentos envía la más reciente; si el cliente menciona un número de factura, pásalo en invoice_number.
- Esa tool NO cobra ni emite nada: solo envía un documento que ya existe. No pidas confirmación para usarla.
- Cuando responda ok=true el archivo YA fue enviado. Confírmalo en pasado ("te acabo de enviar la factura X") — nunca digas que lo enviarás en un momento.
- Si el cliente quiere PAGAR, eso es send_payment_link (enlace), no esta tool. Puedes usar ambas si pide factura y forma de pago.
$doc$
where audience = 'client'
  and system_prompt not like '%Enviar el PDF de una factura%';

commit;
