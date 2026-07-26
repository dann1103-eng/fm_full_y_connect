# Recordatorio de factura por vencer (WhatsApp) — Diseño

**Fecha:** 2026-07-25 · **Revisión:** 2 (tras revisión adversarial)
**Estado:** Aprobado en diseño — pendiente de plan de implementación

## Problema

No existe aviso automático al cliente cuando su factura está por vencer. Hoy el cobro
depende de que alguien del equipo lo recuerde manualmente.

Se quiere un recordatorio por WhatsApp ~3 días antes del vencimiento, con el PDF de la
factura adjunto y un enlace de pago funcional.

## Hallazgo previo: los enlaces de pago nacen muertos

`daily-cycle-runner` emite la factura ~10 días antes de `period_end`
(`AUTO_INVOICE_LEAD_DAYS = 10`) y crea el enlace n1co con `expirationMinutes: 4320`
(3 días) hardcodeado (`supabase/functions/daily-cycle-runner/index.ts:285`), ignorando
`due_date`. El resto del código deriva la expiración de `due_date`
(`src/lib/n1co/payment-links.ts:93-95`).

Cronología real: emisión en `period_end - 10`, el enlace muere en `period_end - 7`, el
recordatorio sale en `period_end - 2` → **el enlace lleva 5 días muerto** cuando el cliente
lo recibe, y 8 al llegar el `due_date`. Ya ocurre en producción, al margen de esta feature.
Además `isLinkExpired` (`src/app/(portal)/portal/facturacion/[id]/page.tsx:268-275`) asume
la semántica de `due_date`, así que muestra como válido un enlace muerto.

**Se corrige aquí** (pasar `dueDate` en vez del literal), y el recordatorio además regenera
el enlace antes de enviarlo.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| PDF adjunto | Desde el inicio | Comparte infra con la feature pendiente del bot |
| Dónde corre | Ruta Next.js + cron Vercel | El Edge Function corre en Deno y no puede importar `src/` |
| Hora de envío | 9:00 AM El Salvador (`0 15 * * *` UTC) | El cron actual dispara a medianoche local |
| Alcance | Solo facturas con `due_date` | Los extras se emiten con `due_date` NULL a propósito |
| Multi-marca | Un recordatorio por factura, `{{1}}` = nombre de la marca | Garantiza que dos marcas del mismo número se distingan |
| Gate `wa_bot_enabled` | **No aplica** | Es un flag del bot conversacional; un cobro es transaccional |
| Entrega a Meta | `media_id` | Evita exponer el PDF en una URL pública |

## Arquitectura

### 1. Infra compartida de documentos WhatsApp

Nueva, reutilizable por la feature pendiente del bot (`send_invoice_document`).

- **`renderInvoicePdfBuffer(admin, invoiceId)`** — extrae el render existente
  (`renderToBuffer(<InvoicePDF invoice items/>)`) a una función sin gate de auth.
  Devuelve `{ buffer, invoice, items }` para que `src/app/api/invoices/[id]/pdf/route.tsx`
  la consuma y siga autorizando con `invoice.client_id` sin repetir el query.
- **`uploadWhatsappMedia(buffer, filename, mime)`** — `POST /{phone_number_id}/media`
  (multipart) → `media_id`, válido 30 días.
- **`sendWhatsappDocument({toE164, mediaId, filename, caption})`** — envío libre (bot).
- **`sendWhatsappTemplate` de `src/lib/whatsapp/templates.ts`** (el registry tipado, no el
  genérico de `send.ts`) gana un parámetro opcional de header `document`.

> ⚠️ El `header_handle` que exige la **creación** de una plantilla con header de documento
> proviene de la Resumable Upload API (`/{app_id}/uploads`) y **no es** el `media_id` de
> `/{phone_number_id}/media`. Son identificadores distintos. Por eso la plantilla se crea a
> mano en Business Manager; no intentar reusar `uploadWhatsappMedia` para aprobarla.

### 2. Handler `invoice_due_reminder`

Nuevo `job_type` registrado en `src/lib/ai/runner.ts`. El handler genérico
`whatsapp_template` **no se modifica**.

Flujo:
1. Cargar factura; abortar si ya está pagada o anulada (carrera con un pago reciente).
2. `regenerateInvoiceLinkCore(admin, invoiceId)` — enlace vigente hasta el fin del `due_date`.
3. `renderInvoicePdfBuffer` → `uploadWhatsappMedia` → `media_id`.
4. **Marcar `invoices.due_reminder_sent_at = now()` ANTES de enviar** (ver abajo).
5. `sendWhatsappTemplate` con header document + 5 parámetros de body.
6. Si el envío devuelve error explícito → **limpiar el marcador** para que el cron reintente
   al día siguiente. Si el proceso muere aquí, el marcador queda puesto: se pierde ese
   recordatorio, pero no se duplica.
7. Persistir en `wa_messages` (`msg_type='document'`, `sent_by='system'`).

**Por qué marcar antes de enviar (at-most-once).** El watchdog de la migración 0124 reclama
jobs que llevan >5 min en `processing`. Si el handler enviara primero y muriera antes de
marcar, el watchdog re-ejecutaría el handler completo y el cliente recibiría **un segundo
cobro**, facturable. Para un recordatorio de cortesía, perder uno es preferible a duplicarlo.
La ventana de 3 días del cron actúa como reintento natural en los fallos explícitos.

**Reintentos:** el backoff del runner es corto de verdad —
`Math.min(60_000, 2 ** attempts * 1000)` con `max_attempts = 3` da +2s y +4s y luego
`failed`. No sirve para un corte de n1co. La resiliencia real la aporta el cron diario:
mientras el marcador esté limpio y el `due_date` siga en ventana, el recordatorio se
reintenta al día siguiente.

**Prioridad:** los jobs se encolan con `priority = 7`. El default es 5, igual que
`whatsapp_reply`, y `claim_ai_job` ordena por `priority asc` — sin esto, un lote de
recordatorios de las 09:00 se reclamaría antes que las respuestas del bot a clientes en vivo.

### 3. Cron ligero

`/api/billing/due-reminders` (Next.js, `runtime = 'nodejs'`, `maxDuration = 60`),
autenticado **solo** por el header de `CRON_SECRET` / `AI_JOBS_TRIGGER_SECRET`. No se
replica el fallback por query param de `src/app/api/ai-jobs/process/route.ts:33-34`, que
está marcado en el propio código como deuda a eliminar.

Solo busca y encola — sin trabajo pesado.

```sql
status = 'issued'
  AND payment_date IS NULL
  AND due_date BETWEEN today+1 AND today+3
  AND due_reminder_sent_at IS NULL
ORDER BY due_date ASC
```

**Throttle:** máximo **un recordatorio por `phone_e164` por corrida**, tomando el `due_date`
más próximo. Sin esto, un cliente con renovación + extra, o un número con varias marcas
(migración 0122), recibiría varios mensajes la misma mañana. Los demás quedan sin marcar y
salen en corridas siguientes.

Teléfono destino: `client_whatsapp_contacts` ordenado por `is_primary desc, created_at asc`,
`limit 1` — el orden canónico de `whatsappNotify.ts:52-59` (`is_primary` no tiene constraint
de unicidad). Si el cliente no tiene contacto, se omite y se registra en log.

`vercel.json` gana un segundo cron: `{"path": "/api/billing/due-reminders", "schedule": "0 15 * * *"}`.

**Limitación conocida y aceptada:** una factura **emitida tarde** (manual, o vía
`create_renewal_invoice` del bot) puede recibir su único aviso a T-1 en vez de T-3, y una con
`due_date` ya pasado no recibe ninguno. Los recordatorios de mora quedan fuera de alcance.

### Formato de la fecha en el mensaje

`invoices.due_date` es `DATE` y llega como `'YYYY-MM-DD'`. Pasarlo por `new Date()` lo parsea
a medianoche **UTC** y en GMT-6 muestra **el día anterior**. Se formatea con los helpers
existentes `formatDateEs` / `APP_TZ` de `src/lib/domain/dates.ts`. Un recordatorio con la
fecha equivocada es peor que no enviarlo.

## Migración 0126

- **`invoices.due_reminder_sent_at timestamptz`** — marcador de notificación. No existe
  ninguna columna equivalente; `billing_cycles.auto_billed_at` marca *factura emitida*, no
  *notificación enviada*.
- **`ai_jobs.invoice_id uuid references public.invoices(id) on delete set null`** —
  siguiendo la convención de FK de `0082`/`0091`.
- **Índice único parcial** `create unique index if not exists` sobre `(invoice_id)` where
  `status in ('pending','processing') and job_type = 'invoice_due_reminder'`. Evita doble
  encolado. El cron inserta **fila por fila con `on conflict do nothing`** repitiendo el
  predicado del índice: un índice único lanza `23505` y en un insert por lote un solo
  conflicto abortaría todo el batch.
- **Índice de apoyo al query del cron** sobre `(due_date)` where
  `status = 'issued' and due_reminder_sent_at is null`, siguiendo el patrón de `0084`.
- **`src/types/db.ts` se actualiza a mano** (es manual, no autogenerado) para
  `invoices.due_reminder_sent_at` y `ai_jobs.invoice_id`.

## Plantilla de Meta

Se crea manualmente en Business Manager
(https://business.facebook.com/wa/manage/message-templates/).

- Nombre: `factura_por_vencer` · Categoría: `UTILITY` · Idioma: `es_MX`
- Header: `DOCUMENT`
- Body:
  ```
  Hola {{1}} 👋 Te recordamos que tu factura {{2}} por {{3}} vence el {{4}}.

  Puedes pagarla en este enlace: {{5}}

  Si ya realizaste el pago, puedes ignorar este mensaje. ¡Gracias!
  ```
  La línea de cierre no es decorativa: Meta rechaza plantillas que **empiecen o terminen con
  una variable**, y sin ella el cuerpo acabaría en `{{5}}`.
- `paramKeys`: `client_name`, `invoice_number`, `amount`, `due_date`, `payment_url`
- Variables de tipo **numérico** (posicionales), que es como las envía
  `sendWhatsappTemplate` (`orderedValues` según `paramKeys`).
- La aprobación exige subir un **documento de muestra** (el `header_handle`); es solo para
  la revisión de Meta y no tiene relación con el PDF que se adjunta en cada envío.

`{{1}}` se llena con **`clients.name` (la marca)**, no con el nombre del contacto: es lo que
permite distinguir dos recordatorios de marcas distintas que comparten el mismo número.

La entry se declara en `WA_TEMPLATES` (`src/lib/whatsapp/templates.ts`). Nombre e idioma
deben coincidir exactamente con lo aprobado por Meta.

## Manejo de errores

| Fallo | Comportamiento |
|---|---|
| Factura pagada entre el encolado y el envío | Handler aborta sin enviar ni marcar |
| n1co no regenera el enlace | Job falla; el cron reintenta al día siguiente (marcador limpio) |
| Upload a Meta falla | Igual: job falla sin marcar, reintento diario |
| Envío devuelve error (p. ej. 132000, plantilla no aprobada) | Se limpia el marcador; reintento diario |
| Proceso muere entre marcar y enviar | Se pierde ese recordatorio (at-most-once). No se duplica |
| Cliente sin contacto de WhatsApp | Se omite en el cron, sin encolar |

**Observabilidad — hueco conocido.** No existe hoy ninguna vista de jobs fallidos ni alerta:
`/admin/whatsapp` son tabs de prompts y stats de consumo, no un panel de jobs. Un recordatorio
que no sale es invisible para el equipo salvo consultando `ai_jobs`/`ai_job_events`. Cada paso
registra `logEvent`; una vista o alerta queda fuera de alcance y se anota como deuda.

**Visibilidad para staff — limitación.** El outbound se guarda con `media_path` NULL, y
`WaChat.tsx:401` renderiza documentos como `📎 {body}` sin descarga: el staff verá que se
envió un PDF pero no podrá abrirlo desde el inbox. Para mitigarlo, `body` lleva una etiqueta
legible (`Recordatorio de pago — factura FAC-0123 (PDF adjunto)`). Guardar el PDF en Storage
para el inbox queda fuera de alcance.

## Verificación

1. **Sin plantilla aprobada:** el cron encola y el job falla con 132000 — confirma que el
   pipeline funciona antes de depender de Meta, y que el marcador queda limpio.
2. **Con plantilla aprobada:** factura de prueba con `due_date = hoy+3` → llega el mensaje
   con PDF adjunto; el enlace abre el checkout de n1co y no está expirado; la fecha del
   mensaje coincide con el `due_date` real (no el día anterior).
3. **Idempotencia:** correr el cron dos veces el mismo día → un solo mensaje.
4. **Throttle:** cliente con dos facturas en ventana → un solo mensaje ese día.
5. **Regresión del enlace:** una factura recién emitida por el cron debe traer expiración
   hasta `due_date`, no 3 días.

## Fuera de alcance

- Recordatorios en otros umbrales (T-7, día del vencimiento, mora).
- Reintento manual desde el UI y panel/alerta de jobs fallidos.
- Recordatorio para facturas de extras (no tienen `due_date`).
- Guardar el PDF enviado en Storage para verlo desde el inbox.
