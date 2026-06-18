# Bot de WhatsApp — Comportamiento esperado para clientes con marca asignada

**Fecha:** 2026-06-18
**Autor:** Daniel + Claude (brainstorming)
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Contexto previo:** Leer `project_whatsapp_bot.md` (memoria) y `CLAUDE.md` del repo § Integración WhatsApp Cloud API.

---

## 1. Objetivo

Definir el **checklist completo de comportamiento esperado** del bot de WhatsApp para clientes que ya
tienen marca asignada (conversación con `wa_conversations.client_id` poblado). El checklist cumple doble
propósito:

1. **Auditar** lo que el bot ya hace y verificar que lo hace bien.
2. **Extender** el bot con las capacidades que faltan.

Cada ítem va etiquetado:

- ✅ **ya existe** — solo auditar que funcione.
- 🔧 **existe pero hay que pulir/verificar** — ajuste menor.
- 🆕 **construir** — capacidad nueva.

## 2. Decisiones de diseño (acordadas)

| Tema | Decisión |
|---|---|
| Acciones del cliente vía chat | Solicitar contenido nuevo (auditar), pedir cambios (nuevo), reprogramar fecha (nuevo) |
| Aprobar contenido desde el chat | **Fuera de alcance** — se queda en el portal (pines/comentarios) |
| Patrón de escritura | **Registrar, equipo confirma.** El bot nunca aplica cambios/fechas directo; deja constancia y el staff confirma desde el CRM |
| Notificación al equipo | Aparece en la **campana del CRM** + queda en el **chat del requerimiento**. Reusa los feeds derivados existentes (sin plomería nueva) |
| Modelo de cambios | **No hay límite por requerimiento.** El límite es un **pool por ciclo/mes**: `plan.cambios_included` (cambios aprobados no-crédito en el ciclo) + créditos extra sin caducidad (`client_credits` kind `cambios`). `requirements.cambios_count` es contador informativo, no tope |

## 3. Hallazgo arquitectónico clave: notificaciones derivadas

La tabla `notifications` **no existe como destino de escritura**. El feed de la campana se *deriva* en
`src/app/api/notifications/route.ts` a partir de varias fuentes. Dos nos sirven directo:

- **`cambio_pending`** — toda fila en `requirement_cambio_logs` con `status='pending'` y `voided=false`
  aparece en la campana de **todos los admin/supervisor**, y en la cola de aprobación existente.
- **`mention`** — toda fila en `requirement_mentions` aparece en la campana del usuario mencionado.

Por lo tanto, registrar peticiones del cliente **reusa estos surfaces**; no se construye sistema de
notificaciones nuevo.

---

## 4. Bloque A — Checklist de comportamiento esperado (auditoría)

### A1. Consultar disponibilidad del plan
- ✅ **A1.1** — Saber cuánto le queda por tipo en el ciclo. Tool: `check_request_eligibility` (devuelve `available`/`used`/`limit` por tipo).
- 🔧 **A1.2** — **Proactividad ante petición vaga.** Si el cliente dice "quiero pedir contenido" sin decir qué, el bot responde *"claro, ahora mismo tiene disponibles X shorts, Y estáticos, Z historias…"*. El dato ya existe; depende del **prompt** (`wa_bot_configs`, audience `client`). Verificar/ajustar que el prompt instruya esto.
- 🔧 **A1.3** — Mostrar también lo **ya usado** ("ha usado 3 de 5 reels") cuando aporte, no solo lo disponible.
- 🔧 **A1.4** — Verificar que `check_request_eligibility` sume los **créditos extra de contenido** (`getAvailableContentCredits`, `client_credits` kind content), no solo los límites base del plan. Si no los cuenta, un cliente con paquete extra vería mal su disponibilidad.

### A2. Consultar estatus y cambios
- ✅ **A2.1** — Resumen del pipeline por fase. Tool: `get_requirements_summary`.
- ✅ **A2.2** — Listar títulos de una fase. Tool: `get_requirements_by_phase`.
- ✅ **A2.3** — Detalle de un contenido puntual. Tool: `get_requirement_detail`.
- 🆕 **A2.4** — **Cambios disponibles del mes (pool).** *"Te quedan N cambios este mes"* = `cambios_included` − cambios aprobados no-crédito en el ciclo + créditos extra. Hoy **ninguna tool lo expone.** Es el filtro natural antes de pedir un cambio (A4.2). → ver B1 `get_changes_balance`.
- 🔧 **A2.5** — **Cambios ya aplicados a un contenido (informativo).** *"A este short ya le hicimos 2 cambios"* vía `cambios_count`. Útil como contexto, **no como límite.** → ampliar `get_requirement_detail`.

### A3. Consultar fechas y facturación
- ✅ **A3.1** — Próximas publicaciones agendadas. Tool: `get_next_publications`.
- ✅ **A3.2** — Estado del ciclo: días restantes, pago, gracia, plan. Tool: `get_billing_status`.
- ✅ **A3.3** — Facturas sin pagar. Tool: `get_unpaid_invoices`.

### A4. Acciones (escritura — patrón "registrar, equipo confirma")
- ✅ **A4.1** — Solicitar contenido nuevo pasando filtros de disponibilidad. Tools: `check_request_eligibility` → `create_requirement_request`. Auditar que el flujo de 5 pasos se sienta natural.
- 🆕 **A4.2** — **Pedir cambios** a un contenido en revisión. → ver B1 `request_requirement_change`.
- 🆕 **A4.3** — **Reprogramar fecha** de un requerimiento ya solicitado. → ver B1 `request_reschedule`.
- ✅ **A4.4** — Escalar a humano cuando aplique. Tool: `handoff_to_human`.

---

## 5. Bloque B — Qué construir y cómo

Todas las tools viven en `src/lib/ai/tools.ts` (definición en `TOOL_DEFS`, ejecutor en `TOOL_FNS`),
se habilitan en runtime vía `wa_bot_configs.enabled_tools` (audience `client`), y reciben el `ToolContext`
(`supabase`, `conversationId`, `clientId`, `phoneE164`). Usar `FM_BOT_USER_ID` de `src/lib/bot.ts` como
autor de cualquier escritura.

> **⚠️ Cliente Supabase para escrituras (RLS).** `ToolContext.supabase` no es admin. Las inserciones en
> `requirement_cambio_logs` y `requirement_mentions`, y la llamada a `botPostMessage`, están **bloqueadas
> por RLS para usuarios normales** (ver `bot.ts:13-14`, `requirement-messages.ts:30`). Las tools nuevas que
> escriben **deben usar `createAdminClient()`** (`@/lib/supabase/admin`) para esos inserts — no `ctx.supabase`.
> Decidir en el plan si se inyecta un admin client en el `ToolContext` o se crea localmente en cada tool de
> escritura. Las tools de solo-lectura (`get_changes_balance`) pueden seguir usando `ctx.supabase`.

### B1. Tools nuevas

#### 🆕 `get_changes_balance` (sirve A2.4)
- **Input:** `{}` (usa `ctx.clientId`).
- **Lógica:** obtener ciclo `current` del cliente; `cambios_included` del plan; contar cambios aprobados
  no-crédito del ciclo (misma cuenta que `consumeCambioSlot` en `src/app/actions/cambioLogs.ts`:
  `requirement_cambio_logs` con `status='approved'`, `voided != true`, `paid_from_credit_id is null`,
  sobre los `requirement_id` del ciclo); créditos extra con `getAvailableCambiosCredits`
  (`src/lib/domain/credits.ts`).
- **Output:** `{ included, used, remaining_cycle, extra_credits, total_available, pending }`.
- **Semántica de `used` (decisión):** `used` cuenta solo cambios **`approved`** (igual que `consumeCambioSlot`),
  porque el pool se consume al aprobar (`approveCambioLog`), no al solicitar. Para no sobre-prometer, devolver
  además `pending` = cambios `status='pending'` del ciclo (los que el cliente ya pidió y aún no se aprueban),
  y que el prompt mencione *"tienes N pendientes de revisión"* cuando aplique. `remaining_cycle` y
  `total_available` se calculan sobre `approved`; el bot no descuenta los `pending`.
- **Helper compartido (obligatorio):** extraer la cuenta del pool a un helper en `src/lib/domain/credits.ts`
  (p. ej. `getCambiosBalance(client, clientId)`) y consumirlo **tanto desde esta tool como desde
  `consumeCambioSlot`** (`cambioLogs.ts`) para garantizar que el saldo informado coincida exacto con el que
  el CRM aplica.
- **Guard:** `NO_CLIENT` si falta `clientId`; manejar "sin ciclo activo".

#### 🆕 `request_requirement_change` (sirve A4.2)
- **Input:** `{ requirement_id: string, change_notes: string }`.
- **Lógica:**
  1. Verificar pertenencia con **check estricto positivo** (ver B4): el requerimiento debe tener
     `billing_cycles.client_id === ctx.clientId`; rechazar si no se puede confirmar (no copiar el check
     permisivo de la tool de lectura). Y que esté en una **fase interna (`Phase`) donde aplica cambio.**
     Definir whitelist explícita de fases internas: **todas excepto `aprobado`, `pendiente_publicar`,
     `publicado_entregado`** (es decir: `pendiente`, `proceso_edicion`, `proceso_diseno`,
     `proceso_animacion`, `cambios`, `pausa`, `revision_interna`, `revision_diseno`, `revision_cliente`).
     Nota: `requirements.phase` guarda una de las **12 fases internas**, no las 5 del cliente.
  2. Calcular saldo con la lógica de `get_changes_balance`. Si `total_available <= 0` → devolver mensaje
     de "se agotaron los cambios del mes" + sugerir paquete extra o `handoff_to_human`. **No registra.**
  3. Si hay saldo: insertar en `requirement_cambio_logs` con `status='pending'`,
     `created_by = FM_BOT_USER_ID`, `notes = change_notes`, `voided = false`.
     → Aparece automáticamente como `cambio_pending` en la campana del equipo y en la cola de aprobación.
     El staff aprueba con `approveCambioLog` (ahí se consume el pool). **El bot no descuenta nada.**
  4. (Opcional) además `botPostMessage` con el texto del cambio para dejar contexto en el chat del req.
- **Output:** `{ ok: true, cambio_log_id, message: "Registré tu solicitud de cambio. El equipo la revisará..." }`
  o `{ error, ... }`.
- **Nota:** no replicar el auto-approve de admin/supervisor — el bot siempre crea `pending`.

#### 🆕 `request_reschedule` (sirve A4.3)
- **Input:** `{ requirement_id: string, new_desired_date: string, reason?: string }`.
- **Lógica:**
  1. Verificar pertenencia al cliente; parsear/validar `new_desired_date` (mismo formato que
     `create_requirement_request`: fecha `YYYY-MM-DD`, o datetime para reunion/produccion).
  2. `botPostMessage` (autor FM Bot, **admin client**) con: *"📅 El cliente pide reprogramar a DD/MM — motivo: …"*.
     Crear el mensaje **primero** (se necesita su `message_id` para las menciones).
  3. Insertar `requirement_mentions` (una por usuario destino) con `mentioned_by_user_id = FM_BOT_USER_ID`,
     `requirement_id`, `message_id` = el mensaje recién creado → aparece como `mention` en la campana.
     **No hay feed derivado "reschedule_pending", así que las menciones son la única superficie de aviso
     — la lista de destinos no es opcional.** Destinos:
     - Usuarios en `requirements.assigned_to` (`string[] | null`), si los hay.
     - **Fallback obligatorio** si `assigned_to` está vacío/null: `select id from users where role in ('admin','supervisor')`,
       mencionar a todos.
  4. **No** modificar `deadline`/`starts_at`. El staff ajusta la fecha real desde el CRM.
- **Output:** `{ ok: true, message: "Avisé al equipo tu nueva fecha deseada..." }` o `{ error }`.

### B2. Modificaciones a tools existentes
- 🔧 **`get_requirement_detail`** — agregar `cambios_count` al output (informativo).
- 🔧 **`check_request_eligibility`** — auditar que sume `getAvailableContentCredits`; corregir si no lo hace.

### B3. Prompt (`wa_bot_configs`, audience `client`) — sin redeploy
- A1.2/A1.3 — instruir disponibilidad proactiva ante petición vaga, mencionando lo usado cuando aporte.
- Registrar las 3 tools nuevas en `enabled_tools` y documentar su flujo (cuándo pedir `requirement_id`,
  confirmar antes de registrar, qué decir si no hay saldo de cambios).
- Subir `max_tokens` si el flujo lo requiere (hoy 800).

### B4. Guards transversales (todas las tools nuevas)
- Verificar `ctx.clientId` presente (patrón `NO_CLIENT`).
- **Ownership estricto positivo:** antes de cualquier escritura, confirmar que el `requirement_id`
  pertenezca al cliente (`billing_cycles.client_id === ctx.clientId`). Si el join no devuelve `client_id`
  o no coincide → **rechazar**. (La tool de lectura `get_requirement_detail` tiene un check permisivo
  `tools.ts:254` que pasa si falta `client_id`; **no replicar esa permisividad en escrituras.**)
- Usar `createAdminClient()` para las escrituras bloqueadas por RLS (ver ⚠️ arriba).
- Usar `FM_BOT_USER_ID` (`src/lib/bot.ts`) como autor.
- Respuestas JSON pequeñas y consistentes (estilo del resto de `TOOL_FNS`).

### B5. Fuera de alcance (confirmado)
- Aprobar contenido desde el chat.
- Aplicar cambios/fechas directo sin confirmación humana.
- Comprar paquetes extra desde el chat (solo se sugiere / escala).

---

## 6. Archivos afectados (estimado)

| Archivo | Cambio |
|---|---|
| `src/lib/ai/tools.ts` | 3 tools nuevas (def + fn), 2 modificaciones |
| `src/lib/domain/credits.ts` | reusar `getAvailableCambiosCredits` / `getAvailableContentCredits` (sin cambios, o helper de saldo de cambios extraído) |
| `src/lib/bot.ts` | reusar `botPostMessage` / `FM_BOT_USER_ID` |
| `wa_bot_configs` (DB, audience `client`) | prompt + `enabled_tools` + `max_tokens` (sin migración de código; se edita en `/admin/whatsapp`) |

## 7. Riesgos y notas
- El conteo del pool de cambios (`get_changes_balance`) debe coincidir **exactamente** con
  `consumeCambioSlot`, si no el bot informaría saldo distinto al que el CRM aplica. Considerar **extraer
  la cuenta a un helper compartido** en `credits.ts` y consumirlo desde ambos lados (cambioLogs.ts y la
  tool) para evitar divergencia.
- `requirement_mentions` requiere `message_id` válido → crear el mensaje primero, luego las menciones
  (mismo orden que `sendRequirementMessage`).
- Validar fase antes de aceptar cambio: un cambio sobre un contenido ya `publicado` no tiene sentido.
- Auditar A1.2 contra el prompt real en DB (no está en el repo).
