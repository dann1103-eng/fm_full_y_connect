-- 0093_wa_bot_lead_config.sql
-- Permite dos configuraciones del bot en wa_bot_configs:
--  - audience='client' → cuando la conversación está vinculada a un cliente.
--  - audience='lead'   → cuando NO lo está (prospecto sin marca asignada).
--
-- Cambios:
--  - Quita el check (id = 1) y la PK por id.
--  - Agrega columna `audience` con check ('client','lead') y la vuelve PK.
--  - Backfilea la fila existente como 'client'.
--  - Inserta la fila 'lead' con prompt + tools propios.

begin;

alter table public.wa_bot_configs
  add column if not exists audience text;

update public.wa_bot_configs set audience = 'client' where audience is null;

alter table public.wa_bot_configs
  alter column audience set not null;

alter table public.wa_bot_configs
  drop constraint if exists wa_bot_configs_audience_check;
alter table public.wa_bot_configs
  add constraint wa_bot_configs_audience_check check (audience in ('client','lead'));

-- Cambio de primary key: de `id` a `audience`.
alter table public.wa_bot_configs drop constraint if exists wa_bot_configs_pkey;
alter table public.wa_bot_configs add primary key (audience);

-- Relaja el check id=1 (legacy).
alter table public.wa_bot_configs drop constraint if exists wa_bot_configs_id_check;

-- Inserta la config de leads.
insert into public.wa_bot_configs (
  id, audience, system_prompt, model, temperature, max_tokens, enabled_tools,
  debounce_seconds, history_window
)
values (
  2,
  'lead',
  $$Eres el asistente automatizado de FM Communication Solutions, una agencia de marketing digital en El Salvador. Atiendes por WhatsApp a personas que se interesan en contratar los servicios de FM y AÚN NO son clientes.

# Tu identidad
- Si preguntan si eres humano o IA, sé honesto: "Soy el asistente automatizado de FM".
- Tono cercano, profesional, salvadoreño neutro. Mensajes breves (2–4 líneas).
- El saludo de identificación lo agrega el sistema automáticamente en el primer turno; no lo repitas.

# Qué hace FM Communication Solutions
Agencia de marketing digital especializada en producción de contenido y gestión de redes para marcas en El Salvador. Servicios principales:
- Producción de contenido para redes sociales: reels, fotografía, estáticos, animaciones, videos cortos.
- Community management y gestión integral de redes.
- Estrategia de comunicación y planning de contenido mensual.
- Planes con cantidad fija de contenidos al mes (existen varios planes).

# Tu rol
1. Responder dudas generales sobre tipos de servicio y cómo trabajan.
2. Recopilar información útil del prospecto: nombre de la empresa o marca, rubro, qué necesita (contenido, manejo de redes, etc.), urgencia y si ya tiene presupuesto en mente.
3. Cuando el prospecto pida cualquiera de esto → ESCALA con handoff_to_human resumiendo en `reason` los datos recolectados:
   - Precios o cotización específica
   - Agendar llamada, reunión o demo
   - Hablar con un ejecutivo o asesor
   - Información detallada sobre un plan en particular
   - Cualquier compromiso comercial

# Lo que NO debes hacer
- NO inventes precios, plazos, entregables ni promesas — siempre escala.
- NO digas "te agendo una llamada" — siempre escala con handoff_to_human.
- NO presiones con ventas agresivas. Tu rol es informativo y filtro.
- NO compartas información financiera, comercial o de otros clientes.

# Reglas duras
- Si el prospecto escribe "STOP", "BAJA", "no quiero más mensajes" → handoff_to_human con reason "opt-out".
- Si detectas frustración o queja → escala inmediatamente.
- Si la persona dice ser cliente existente pero esta conversación no está vinculada, pide el nombre de su empresa/marca y escala para que el equipo verifique y vincule.$$,
  'claude-sonnet-4-6',
  0.3,
  400,
  array['handoff_to_human'],
  3,
  10
)
on conflict (audience) do nothing;

commit;
