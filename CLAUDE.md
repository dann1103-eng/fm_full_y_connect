@AGENTS.md

# FM CRM — Claude Context

## Proyecto
CRM interno para FM Communication Solutions. Gestiona clientes, ciclos de facturación, requerimientos de contenido, pipeline de producción, sistema de revisión de contenido, facturación, portal del cliente y control de tiempo.

## Stack
- Next.js 16 App Router · React 19 · TypeScript 5 · Tailwind CSS 4
- shadcn/ui + @base-ui/react para componentes UI
- Supabase (Postgres + Auth + Storage + Realtime) — `@supabase/supabase-js@2`
- @dnd-kit/core para drag-and-drop en pipeline
- react-big-calendar + date-fns para calendario
- @react-pdf/renderer para generación de PDFs
- Rama principal: `master` (auto-deploy a Vercel)

## Comandos esenciales
```bash
npm run dev          # localhost:3000
npm run lint         # debe dar 0 errors nuevos antes de commit
npm run build        # verificación final de tipos y build
git add <files> && git commit -m "feat|fix|docs|chore: mensaje en español"
git push origin master  # requiere confirmación explícita del usuario
```

## Arquitectura de archivos clave
| Archivo | Rol |
|---------|-----|
| `src/types/db.ts` | Tipos TS manuales (NO auto-generados). Editar directamente al cambiar el schema. |
| `src/lib/domain/pipeline.ts` | `PipelineItem` interface, `movePhase`, `migrateOpenPipelineItems`, `CLIENT_PHASE_*` para el portal. |
| `src/lib/domain/requirement.ts` | Lógica de cálculo de límites y semanas |
| `src/lib/domain/plans.ts` | `limitsToRecord`, `CONTENT_TYPE_LABELS` |
| `src/lib/domain/calendar.ts` | `KIND_COLORS`, `KIND_COLORS_DARK`, `requirementToCalendarEvent` |
| `src/lib/domain/billing.ts` | Lógica de facturación e invoices |
| `src/lib/domain/pipeline.ts` | `clientPhaseOf()` — mapeo de las 12 fases internas a 5 fases del portal |
| `src/app/actions/` | Server Actions (`'use server'`) — 22 archivos |
| `src/contexts/UserContext.tsx` | `useUser()` (lanza si no hay Provider) · `useUserOrNull()` (retorna null) |
| `supabase/migrations/` | Migraciones SQL (`NNNN_description.sql`) — aplicar manualmente en Supabase Dashboard |

## Supabase — dos clientes, nunca confundir
```ts
// Server components / Server Actions:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()   // ← async

// 'use client' components:
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()          // ← sync

// Admin / Service Role (solo en Server Actions que lo requieran):
import { createAdminClient } from '@/lib/supabase/admin'
const supabase = createAdminClient()    // ← bypass RLS
```

## Reglas ESLint que muerden
- **`react-hooks/set-state-in-effect`**: No llamar `setState` sincrónicamente en el body de `useEffect`. Estado derivado → `useMemo`. Si hay patrón legacy necesario, usar `// eslint-disable-next-line react-hooks/set-state-in-effect`.
- **`react-hooks/purity`**: Nunca `Date.now()` en render/hooks → usar `new Date().getTime()`
- `redirect()` de `next/navigation` lanza internamente — siempre última línea en Server Actions.
- `@next/next/no-img-element`: usar `<Image>` de next/image o `{/* eslint-disable-next-line */}` si se necesita `<img>`.

## Modelo de datos (tablas principales)
```
users                 → roles: admin | supervisor | operator | client
clients               → billing_cycles → requirements → requirement_phase_logs
                                      ↘ requirement_messages (chat por requerimiento)
                                      ↘ review_assets → review_versions → review_version_files
                                                     ↘ review_pins → review_comments
clients → client_users (tabla puente) → users (rol: owner | viewer)

clients.status             — 'active'|'paused'|'overdue'|'inactive_payment'|'inactive_manual' (0001+0093)
clients.deactivation_reason — texto auditoría (0093)
clients.deactivated_at     — timestamptz (0093)
clients.max_cambios        — límite de cambios por requerimiento (default 2)
requirements.title         — requerido en UI, DEFAULT '' en DB (legacy rows ok)
requirements.cambios_count — contador. Se decrementa al anular un cambio
                              (server action voidCambioLog en cambioLogs.ts).
requirements.phase         — fase actual en pipeline (12 valores posibles)
requirements.review_started_at — timestamp al entrar a revision_cliente
requirements.consumption_overrides_json — JSONB. Map ContentType→cantidad. Solo admin.
                              NULL = consumo legacy (1 del content_type + 1 historia
                              si includes_story). Si tiene valores, reemplaza esa lógica.
requirements.client_request_attachments_json — JSONB [{path, publicUrl, name, mime, sizeBytes}]. Archivos adjuntos al solicitar desde portal.
requirements.client_request_links_json — JSONB [{url}]. Links de referencia al solicitar desde portal.
requirement_cambio_logs.voided/voided_by_user_id/voided_at — auditoría de anulación.
requirement_messages.visible_to_client — true = visible en el portal del cliente
billing_cycles.grace_period_until — DATE. Mientras >= today, permite inserts y cron no suspende (0096)
billing_cycles.grace_period_granted_by/at — auditoría de quién otorgó la gracia
work_sessions.last_alive_at — timestamptz heartbeat de la jornada activa (0092). touchPresence() la actualiza cada 20 min
```

### Cascade delete (orden obligatorio)
`requirement_phase_logs` → `requirements` → `billing_cycles` → `clients`
No hay FK CASCADE en DB — el app borra en secuencia (ver `deleteClient.ts`).

## Fases del pipeline
```
12 fases internas (Phase type):
  pendiente, proceso_edicion, proceso_diseno, proceso_animacion,
  cambios, pausa, revision_interna, revision_diseno,
  revision_cliente, aprobado, pendiente_publicar, publicado_entregado

5 fases del portal del cliente (ClientPhase):
  diseno          ← agrupa todas las fases de proceso + pendiente + pausa + revision_interna + revision_diseno
  revision_cliente ← fase interactiva: cliente puede dejar pines, comentarios y chat
  aprobado
  pendiente_publicar
  publicado

CLIENT_PHASE_LABELS.diseno = 'En proceso' (no 'En diseño')
```

## Pipeline — arquitectura de componentes
```
pipeline/page.tsx (server)
  └─ KanbanBoard ('use client')
       ├─ KanbanColumn (onDoubleClick → PhaseSheet)
       │    └─ PipelineCard — DRAGGABLE (@dnd-kit, onDoubleClick → PhaseSheet sin move)
       ├─ MovePhaseModal   — abre al soltar en nueva columna (DnD)
       └─ PhaseSheet       — abre en doble clic, showMoveSection=false, logs on-demand
            ├─ RequirementChat   (chat interno, toggle visible_to_client por mensaje)
            └─ ContentReviewDialog → ContentReviewPanel (review assets/versions/pins)

clients/[id]/page.tsx (server)
  └─ ClientPipelineTab ('use client')
       └─ PipelineCard — NO-DRAGGABLE (onClick → PhaseSheet con move section)

portal/pipeline/page.tsx (server — portal del cliente)
  └─ ClientPipelineBoard ('use client')
       └─ [revision_cliente cards] → ClientRequirementSheet
            ├─ Tab "Revisión": ContentReviewPanel (clientMode, lastVersionOnly)
            └─ Tab "Chat":     RequirementChat (clientMode, visible_to_client=true)
```

### PhaseSheet props clave
`showMoveSection` (default true), `title`, `requirementNotes`, `cambiosCount`, `maxCambios`.

### ContentReviewPanel props clave
`active`, `requirementId`, `clientId`, `currentUserId`, `clientMode?`, `initialPinId?`

En `clientMode`:
- Solo muestra la última versión de cada asset (`lastVersionOnly`)
- Oculta "Nueva versión", "Agregar archivos", botones de resolver/archivar
- El cliente puede crear pines e insertar comentarios

### RequirementChat props clave
`requirementId`, `currentUserId`, `isAdmin?`, `clientMode?`

En `clientMode`:
- Mensajes se envían con `visible_to_client=true`
- Sin @-menciones al staff
- En modo staff: botón toggle 👁 para marcar mensaje visible al cliente (badge "Cliente" en mensajes marcados)

## Sistema de revisión de contenido
```
review_assets (por requirement)
  └─ review_versions (versiones de un asset)
       └─ review_version_files (archivos/thumbnails de la versión)
       └─ review_pins (pines sobre la versión)
            └─ review_comments (hilos de comentarios en un pin)

Bucket Storage: review-files (privado)
Path layout: review-files/{requirement_id}/{asset_id}/v{n}.{ext}
             review-files/{requirement_id}/{asset_id}/v{n}.thumb.jpg
```

## Portal del cliente — RLS
Función clave: `public.is_client_of(client_id uuid)` (migración 0052)
- Retorna true si el `auth.uid()` actual es un `client_user` del cliente dado

Función auxiliar: `public.is_work_user_of(client_id uuid)` — retorna true si el usuario es client_user del cliente. Usada en RLS UPDATE policies (ej: edición de solicitudes pending desde portal).

Patrón estándar para policies del portal:
```sql
using (
  exists (
    select 1 from public.requirements r
    join public.billing_cycles bc on bc.id = r.billing_cycle_id
    where r.id = <tabla>.requirement_id
      and r.phase = 'revision_cliente'   -- solo en esa fase
      and public.is_client_of(bc.client_id)
  )
)
```

## Storage — buckets
| Bucket | Visibilidad | Helper |
|--------|------------|--------|
| `client-logos` | Público | `upload-logo.ts` |
| `agency-assets` | Privado | `upload-agency-logo.ts` |
| `requirement-attachments` | Público | `upload-req-attachment.ts` — `uploadRequirementAttachment` (imágenes PNG/JPG/WebP, comprime a <800KB) · `uploadRequirementAttachmentRaw` (otros tipos, máx 10MB). **Ambas son client-only** (usan `createClient` del browser). En server actions, borrar con `adminClient.storage.from('requirement-attachments').remove(paths)` directamente — NO usar `deleteRequirementAttachments` (usa browser client). |
| `review-files` | Privado | `upload-review-file.ts` |
| `avatars` | Público | `upload-avatar.ts` |

## Realtime
Las siguientes tablas están en la publicación `supabase_realtime`:
- `messages`, `conversations`, `conversation_members` (inbox)
- `review_assets`, `review_versions`, `review_pins`, `review_comments`, `review_comment_mentions`, `review_version_files` (sistema de revisión)
- `requirement_messages` (chat de requerimientos — migración 0056)
- Notifications (migración 0058)

Si se agrega una tabla nueva que necesite realtime, incluir en la migración:
```sql
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'nueva_tabla'
    ) then
      execute 'alter publication supabase_realtime add table public.nueva_tabla';
    end if;
  end if;
end $$;
```

## Facturación — módulo billing
- `invoices` (facturas) + `quotes` (cotizaciones) + `payment_methods` + `terms_and_conditions`
- Generación PDF via @react-pdf/renderer en `src/app/api/invoices/` y `src/app/api/quotes/`
- Edge Function `daily-cycle-runner` (cron `0 6 * * *`) maneja:
  - Cleanup de jornadas huérfanas (vía `close_orphan_work_sessions` y `truncate_anomalous_time_entries`)
  - Auto-billing si `period_end ≤ 10 días` y cycle pagado
  - Al expirar cycle PAGADO: archivar + promover scheduled o crear nuevo current
  - Al expirar cycle IMPAGO (sin gracia): archivar + suspender cliente (`inactive_payment` vía RPC `deactivate_client_for_unpaid_cycle`)
  - Al expirar cycle IMPAGO (con gracia vigente): **no toca el cycle ni al cliente** (queda `current`) hasta que la gracia expire o el cliente pague

## Suspensión + gracia (flujo billing — 0093+0094+0096)

| Acción | Server action | Efecto |
|---|---|---|
| Marcar pagado un cycle | `markCyclePaid()` | `payment_status='paid'`. Si cliente estaba `inactive_payment`, llama `reactivate_client` RPC automáticamente |
| Pausar cliente | `pauseClient()` | Archiva cycle + `status='paused'`. Disponible en /renovaciones y header del perfil (PauseClientButton) |
| Reactivar suspendido | `reactivateClient()` | Limpia status + reason + deactivated_at. Solo admin/supervisor |
| Otorgar/extender gracia | `deferPaymentGracePeriod(cycleId, clientId, days)` | Setea `grace_period_until = today + days` (1-60). Si cliente estaba `inactive_payment`, lo reactiva automáticamente |
| Anular gracia | `revokeGracePeriod()` | Limpia `grace_period_until`. No reactiva/suspende |

**Trigger `requirements_check_week_payment_trg`** (0094+0095+0096):
- Rechaza INSERT en `requirements` si `client.status IN ('inactive_payment','inactive_manual')`
- Calcula semana 1..4 desde `(registered_at - cycle.period_start) / 7 + 1` (aritmética entera)
- Para biweekly: S1-S2 requiere `payment_status='paid'`; S3-S4 requiere `payment_status_2='paid'`
- Para monthly: toda semana requiere `payment_status='paid'`
- **Override por gracia**: si `cycle.grace_period_until >= current_date`, permite el INSERT a pesar de impago
- Errores con código `P0001` y mensaje en español (RequirementModal/requirementRequests.ts deben propagarlos al UI)

## Sistema de jornadas (work_sessions)

- `endShift()` cierra `time_entries` abiertas defensivamente antes de calcular productive_seconds
- `ShiftPanel.confirmEndShift()` NO bloquea si `stopActiveEntry()` falla — `endShift` se encarga
- `touchPresence()` actualiza `last_alive_at` cada 20 min como heartbeat
- `close_orphan_work_sessions(p_user_id, p_older_than_hours)` cierra jornadas con `last_alive_at < now() - 4h` (preferido) o `started_at < now() - 14h` (fallback legacy)
- `adminEditWorkSession(sessionId, payload)` — admin/supervisor edita horarios de jornadas. Usa service role (createAdminClient) porque RLS solo da SELECT a admins en work_sessions, no UPDATE

## /renovaciones — secciones y filtros (post-0096)

- Query A (próximos a vencer): `status IN ('current','pending_renewal') AND period_end <= today+10d`
- Query B (vencidos impagos): `payment_status='unpaid' AND period_end < today AND status != 'scheduled'`
- Dedup por client_id: B tiene prioridad sobre A
- **TZ correcto**: page.tsx usa `today()` y `addDaysString()` de `@/lib/domain/dates` (GMT-6, no UTC)
- Después del split, items se particionan en `pendingItems` (rojo/ámbar) y `renewedItems` (verde, `renewalState.kind='paid'`)
- Sección verde "Renovados — esperando fin de ciclo" para clientes que pagaron anticipadamente
- Chips de summary: `N morosos`, `N vencen en ≤3 días`, `N ya renovados`

## RequirementModal — propaga errores del trigger

`RequirementModal.tsx:327-332` propaga `insertError.message` directo del trigger SQL (antes mostraba "Error al registrar el requerimiento. Intenta de nuevo." genérico). Eso significa que mensajes como "Cliente X suspendido por falta de pago" o "No se puede registrar requerimientos en la semana 3 sin el pago correspondiente" llegan al UI sin perderse.

## Calendario
- `CalendarPageClient` (interno): MutationObserver para dark mode, DnD habilitado, rich event cards
- `PortalCalendarioClient` (cliente): read-only, misma clase `calendar-wrapper` para CSS dark mode
- Colores de eventos: `KIND_COLORS` (light) / `KIND_COLORS_DARK` (dark) — ambos en `calendar.ts`
- El wrapper debe tener clase `calendar-wrapper` para que apliquen los estilos dark de `globals.css`

## Componentes clave de billing/suspensión/perfil

| Componente | Ubicación | Rol |
|---|---|---|
| `InactiveClientBanner` | `components/clients/` | Banner rojo en /clients/[id] cuando `client.status IN ('inactive_payment','inactive_manual')` + botón "Reactivar" para admin/supervisor |
| `PauseClientButton` | `components/clients/` | Modal 2-tap en header del perfil (al lado de DeleteClientButton). Solo admin con `cycle && status='active'`. Llama `pauseClient()` |
| `GracePeriodControl` | `components/renewals/` | Control reusable (variant `compact` para RenewalRow, `full` para perfil). Muestra chip verde "Pago diferido hasta DD/MM" + botones Extender/Anular. Si no hay gracia y cycle unpaid → input para otorgar |
| `EditWorkSessionModal` | `components/tiempo/` | Admin/supervisor edita inicio/fin/notas de una jornada. Recalcula `total_seconds = (end-start) - sum(breaks)` |
| `AdminTimePanel` | `components/tiempo/` | Sección "Jornadas" arriba del feed de time entries con botón ✎ por fila |
| `/public/portal-bg-pattern.svg` | `public/` | Background decorativo (blobs orgánicos + dots + curvas) en colores FM, montado en `/portal/dashboard` con opacity 18% light / 8% dark |

## Modales con scroll (portal)
Patrón estándar para modales tall: `fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center` → card con `flex flex-col max-h-[90dvh] rounded-t-2xl sm:rounded-2xl` → header `flex-shrink-0` + body `overflow-y-auto flex-1` + footer `flex-shrink-0`. Mobile bottom sheet, desktop centrado.

## Patrones UI
- Colores primarios: teal `#00675c` / rojo `#b31b25` / gris `#595c5e`
- CSS classes: `glass-panel`, `fm-primary`, `fm-on-surface`, `fm-surface-container-*`, etc. — todas en Tailwind como custom tokens
- Dark mode: clase `dark` en `<html>` gestionada por `next-themes` via `ThemeProvider`
- CSS class `glass-panel` definida en `globals.css`
- Admin check: `supabase.from('users').select('role').eq('id', user.id).single()` → `role === 'admin'`
- Todo el texto UI y los mensajes de error van en **español**
- Commits en español: `feat:`, `fix:`, `docs:`, `chore:`
- Material Symbols (iconos): `<span className="material-symbols-outlined">icon_name</span>`

## Despliegue (actualizado 2026-05-07)

- **Producción:** Vercel (Pro plan), repo `dann1103-eng/fm_full_y_connect`, rama `master` con auto-deploy.
- **Dominio canónico:** `fullefm.site` (Namecheap, BasicDNS) + `www.fullefm.site`.
  - DNS: A `@ → 216.150.1.1`, CNAME `www → 905f6f409665fc27.vercel-dns-017.com.`
  - URL anterior `fm-full-y-connect.vercel.app` sigue activa.
- **LiveKit:** migrado a **LiveKit Cloud** (era self-hosted en EasyPanel). Webhook → `/api/livekit/webhook` apunta al dominio canónico.
- **EasyPanel:** descartado — el contenedor app está detenido. La VPS de Hostinger se mantiene apagada / o eventualmente para borrar.
- **Vercel Observability Plus:** desactivado (excluido el proyecto) para evitar el cargo grande por Observability Events. Logs siguen en `vercel logs` y panel Functions.

## Migraciones aplicadas (0001–0097)
| # | Contenido |
|---|-----------|
| 0001–0006 | Schema inicial, pipeline base, reuniones, campos de clientes |
| 0007 | Bucket client-logos (Storage, público) |
| 0008 | `consumptions.title`, `cambios_count`, `clients.max_cambios` |
| 0009 | Rename `consumptions` → `requirements` y logs |
| 0010–0018 | Chat, cambios, facturación inicial, time entries, rol supervisor, propiedades req, distribución semanal, perfil usuario |
| 0019 | Fases del pipeline v2 (las 12 fases actuales) |
| 0020–0024 | Multi-asignación, logs de cambios, matriz contenido, plan historias, asignado por defecto |
| 0025 | Split timer: `worked_seconds` vs `standby_seconds` en phase logs |
| 0026–0039 | Adjuntos en mensajes, pagos bisemanal, plan contenido, app settings, RLS time entries, restricciones operadores, flags deadline/historia, distribución semanal overrides |
| 0040–0043 | Inbox chat (DM/canales), menciones, bucket agency-assets, admin elimina mensajes |
| 0044 | Sistema de revisión: `review_assets`, `review_versions`, `review_pins`, `review_comments` + realtime |
| 0045 | Bucket `review-files` |
| 0046–0047 | Fix body check, menciones en comentarios de revisión |
| 0048 | Módulo billing completo: `invoices`, `quotes`, `payment_methods`, `terms_and_conditions` |
| 0049 | `review_version_files` + realtime |
| 0050 | Realtime para `messages`, `conversations`, `conversation_members` |
| 0051 | `calendar_events` table |
| 0052 | Fundamentos portal cliente: `client_users`, `is_client_of()`, `visible_to_client` en messages, RLS base |
| 0053 | Policies self-read del cliente |
| 0054 | RLS portal: requirements, billing_cycles, planes, invoices, quotes |
| 0055 | RLS portal: review_assets/versions/pins/comments gateados por `phase='revision_cliente'` + is_client_of. Storage policy bucket review-files |
| 0056 | `requirement_messages` a publicación realtime |
| 0057 | Automatización billing (auto_billing flag, ciclos scheduled) |
| 0058 | Realtime para notificaciones |
| 0059 | Multi-consumo + anulación de cambios |
| 0060 | Integración n1co (pagos) |
| 0061–0068 | Fixes inbox realtime |
| 0069–0071 | call_sessions + call_participants + RLS llamadas + room_name unique parcial + backfill team channels |
| 0072 | `user_presence` (status manual + updated_at + realtime) |
| 0073 | client_user permissions |
| 0074 | Approval flow de requerimientos: `approval_status` (approved/pending/rejected), policies para solicitudes desde portal |
| 0075–0081 | Quotes optional client, relax request types, missed call messages, billing cycle marker, can_quote, message reply_to, invoice terms snapshot |
| 0082 | Infra de jobs de IA: `ai_jobs`, `ai_job_events`, RPC `claim_ai_job`, rol `'agent'`, usuario FM Bot (UUID `…0b07`). Worker en `ai-worker/`. Ver `docs/AI_AGENT_CONTEXT.md` §9.1. |
| 0083 | Fix usuario FM Bot |
| 0084 | **Indices de performance (mayo 2026)** — partial indexes: `requirements_open_deadline_idx`, `call_participants_active_idx`, `messages_conv_active_created_idx`. Aplicado tras detectar slow queries en panel Query Performance de Supabase. |
| 0085–0089 | Cleanup time entries/work sessions huérfanas, RPCs `close_orphan_work_sessions`, `truncate_anomalous_time_entries`, fix call_participants orphans |
| 0090 | Adjuntos y links en solicitudes portal: `client_request_attachments_json`, `client_request_links_json` en `requirements` + RLS UPDATE policy para edición de solicitudes pending |
| 0091 | WhatsApp integration (Fase 1) |
| 0092 | **`work_sessions.last_alive_at`** (heartbeat de jornada) + RPC `close_orphan_work_sessions` mejorado (4h heartbeat, fallback 14h legacy). Cierra `time_entries` huérfanas al cerrar sesión. Cleanup retroactivo one-shot |
| 0093 | **Suspensión por impago**: extiende `clients.status` con `inactive_payment`/`inactive_manual` + columnas `deactivation_reason`/`deactivated_at` + RPCs `deactivate_client_for_unpaid_cycle(p_client_id,p_cycle_id)` y `reactivate_client(p_client_id)` |
| 0094 | **Trigger `requirements_check_week_payment_trg`** BEFORE INSERT en `requirements`: rechaza insert si client.status='inactive_payment'/'inactive_manual', o si la semana del registro no está pagada. Códigos error `P0001` con mensaje en español |
| 0095 | Fix bug en 0094: `date - date` retorna `integer` (no `interval`); usa aritmética entera directa para calcular la semana |
| 0096 | **Período de gracia**: columnas `billing_cycles.grace_period_until`, `grace_period_granted_by`, `grace_period_granted_at`. Trigger 0094 actualizado: si `grace_period_until >= today`, permite inserts a pesar de impago |
| 0097 | **Fix race condition en llamadas**: el paso 2 de `close_orphan_call_participants` cerraba sesiones recién creadas (antes del primer INSERT de call_participant). Ahora exige gracia mínima 5min sobre `call_sessions.started_at` |
| 0098 | **Planes sin vencimiento**: columnas `plans.no_expira` y `billing_cycles.no_expira` (snapshot). Ciclos con `no_expira=true` son ignorados por `daily-cycle-runner` en auto-billing y en el loop de expiración: no se archivan ni renuevan automáticamente |
| 0099 | **Fix avatar portal**: storage policies del bucket `user-avatars` recreadas para permitir a cualquier usuario autenticado (incluido `role='client'`) gestionar archivos en su propia carpeta `{auth.uid()}/*` |
| 0100 | **Planes bimestrales**: nuevo `billing_period='bimonthly'` en `plans`, `clients` y `billing_cycles`. Ciclo de 60 días con 8 semanas, 2 pagos manuales (S1-S4 → `payment_status`, S5-S8 → `payment_status_2`). Trigger `requirements_check_week_payment` actualizado para soportar 8 semanas según `billing_period`. `daily-cycle-runner` excluye `bimonthly` del auto-billing (facturas manuales). UI: `WeekRangeNavigator` con flecha animada S1-S4/S5-S8 en `RequirementPanel` |
