-- 0118_wa_bot_whatsapp_formatting.sql
-- Guía de formato NATIVO de WhatsApp para el bot + cómo reportar la bolsa de
-- contenidos de planes con pool unificado (paquetes on-demand).
--
-- Contexto: los mensajes del bot salían "en bruto" con **doble asterisco** y
-- tablas markdown que WhatsApp NO renderiza. La ruta de envío ya sanea el texto
-- (src/lib/whatsapp/formatForWhatsapp.ts) como red de seguridad; esta migración
-- además instruye al modelo para que genere el formato correcto desde el inicio
-- (menos tablas, negrita simple) y reporte los paquetes on-demand como bolsa única.
--
-- Idempotente: solo agrega la sección si aún no existe (guard NOT LIKE).

-- ── Formato WhatsApp para AMBAS audiencias (client + lead) ───────────────────
update public.wa_bot_configs
set system_prompt = system_prompt || $fmt$

# FORMATO WHATSAPP (OBLIGATORIO)
Escribe en el formato NATIVO de WhatsApp, NUNCA en markdown:
- Negrita con *un solo asterisco* (NUNCA **doble asterisco**).
- Cursiva con _texto_. Tachado con ~texto~.
- PROHIBIDO: tablas markdown (| a | b |), encabezados (#, ##) y **negrita doble**.
- Para listar o resumir usa líneas simples "Etiqueta: valor" o viñetas con "- ".
  Ejemplo correcto de un resumen de fases:
  Aprobado: 2
  Publicado: 1
- Mensajes cortos, claros y sin adornos.
$fmt$
where audience in ('client', 'lead')
  and system_prompt not like '%FORMATO WHATSAPP%';

-- ── Reporte de disponibilidad (solo audiencia client) ────────────────────────
update public.wa_bot_configs
set system_prompt = system_prompt || $disp$

# DISPONIBILIDAD DE CONTENIDO
Cuando check_request_eligibility devuelva "unified_pool" (no null), el cliente tiene
un PAQUETE de N contenidos de CUALQUIER tipo (estático, video, reel o short).
Repórtalo como una BOLSA ÚNICA ("te quedan N contenidos de cualquier tipo, para
usar cuando quieras"), NO listes la disponibilidad por tipo (todos repiten el mismo
cupo del pool). Solo si unified_pool es null, informa la disponibilidad por tipo.
$disp$
where audience = 'client'
  and system_prompt not like '%DISPONIBILIDAD DE CONTENIDO%';
