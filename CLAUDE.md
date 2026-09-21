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

## Planes — billing_period + no_expira (0098 + 0100)

**`plans.billing_period`** (default `'monthly'`): periodicidad por defecto del plan. Valores: `'monthly' | 'biweekly' | 'bimonthly'`. Al asignar plan al cliente en `ClientForm`, el selector se autocompleta con `plan.billing_period`.

**`plans.no_expira`** (default `false`): si `true`, los ciclos creados con ese plan se marcan `no_expira=true` y `daily-cycle-runner` los ignora (no archiva, no factura auto). UI: toggle "Vencimiento" en `PlanForm` (Mensual / No vence).

**Pool unificado bloquea tippables:** constante `TIPPABLE_LIMIT_KEYS = ['historias','estaticos','videos_cortos','reels','shorts']`. Cuando `useUnifiedPool=true` los 5 inputs se deshabilitan y resetean a 0. Producciones, reuniones, horas/reunión y matriz siguen editables.

### Bimonthly (60 días, 8 semanas)
- `period_end = period_start + 59 días` (60 días inclusive)
- 8 semanas: `WEEKS_BIMONTHLY = ['S1'..'S8']` en `src/types/db.ts`. Helper `weeksForBillingPeriod(bp)`.
- Mapeo pago→semanas: **S1-S4 → `payment_status`, S5-S8 → `payment_status_2`**
- **2 pagos manuales** (cron excluye bimonthly del auto-billing, admin emite las 2 facturas)
- Trigger `requirements_check_week_payment_trg` cap dinámico (8 si bimonthly, 4 en otros)
- `WeekRangeNavigator` (`src/components/clients/WeekRangeNavigator.tsx`) anima flecha entre S1-S4 y S5-S8. Usado en `RequirementPanel`. Semanas sin pago muestran lock icon.

### Snapshot de billing_period al crear ciclos
**7 puntos de creación de billing_cycles** que deben snapshotar `billing_period`:
1. `ClientForm.tsx` (al crear cliente)
2. `ReactivatePanel.tsx` (al reactivar)
3. `renewals.ts` × 3 (scheduled, immediate, fallback admin)
4. `invoices.ts` (`ensureScheduledCycle`)
5. `contentPackage.ts` (paquete de contenido)
6. `daily-cycle-runner/index.ts` × 2 (auto-billing crea scheduled, fallback de promoción)

## /renovaciones — scheduled cycles stale (fix 2026-05-23)

**Problema histórico:** `ensureScheduledCycle` solo chequeaba `status='scheduled'` sin validar fechas. Cuando el cron promovía un scheduled a current pero creaba un duplicado, quedaban scheduleds "stale" con `period_start ≤ current.period_end`. La UI mostraba "Renovación pagada · inicia 1 de mayo" siendo idéntico al ciclo actual.

**Fix defensivo** en `src/app/actions/invoices.ts` `ensureScheduledCycle`:
```ts
if (existing?.id) {
  const isStale = existing.period_start <= current.period_end
  if (!isStale) return { ok, cycleId: existing.id }
  // Stale: archivar y caer al flujo de creación abajo
  await admin.from('billing_cycles').update({ status: 'archived' }).eq('id', existing.id)
}
```

**Cleanup one-shot** cuando haya stales en DB:
```sql
update billing_cycles bc_s
set period_start = (bc_c.period_end + interval '1 day')::date,
    period_end = case c.billing_period
      when 'biweekly'  then (bc_c.period_end + interval '14 days')::date
      when 'bimonthly' then (bc_c.period_end + interval '60 days')::date
      else (bc_c.period_end + interval '1 month')::date
    end,
    billing_period = c.billing_period
from billing_cycles bc_c, clients c
where bc_s.client_id = bc_c.client_id and bc_c.client_id = c.id
  and bc_s.status = 'scheduled' and bc_c.status = 'current'
  and bc_s.period_start <= bc_c.period_end;
```

## Auth — passwords y avatares (post-0099)

- **Reset por admin**: `resetPortalUserPassword({userId, clientId, newPassword})` en `clientUsers.ts` (usa `admin.auth.admin.updateUserById`). UI: botón "Resetear contraseña" en `ClientPortalInvite` con input inline.
- **Cambio por el propio usuario**: `changeMyPassword(newPassword)` en `profile.ts` (server-side). `supabase.auth.updateUser` desde browser client falla con "Auth session missing!" en SSR — la sesión vive en HttpOnly cookies que solo el server puede leer. Aplicado a `/profile` (admin) y `/portal/config` (cliente).
- **Avatar portal**: migración 0099 recrea policies del bucket `user-avatars` para permitir a cualquier usuario autenticado gestionar `{auth.uid()}/*`. `setClientAvatarUrl` en `portalProfile.ts` usa `createAdminClient()` para el UPDATE en `users` (belt-and-suspenders contra RLS).

## Patrón: `.delete()` de Supabase NO lanza

Las violaciones de FK (RESTRICT) **no producen excepción** — retornan `{ error }`. Hay que verificarlo siempre. Patrón aplicado en `deleteClient.ts`:
1. Pre-check `invoices` y `quotes` (FK RESTRICT) → si count > 0, devolver `{ error: 'No se puede eliminar: el cliente tiene N factura(s)...' }`.
2. En cada `.delete()` posterior, checar `{ error }` y devolverlo.
3. `redirect('/clients')` como última línea, solo si todo bien.
`DeleteClientButton` recibe `{ error }` y lo muestra en banner rojo en lugar de cerrar el modal.

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

## Migraciones aplicadas (0001–0131)
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
| 0101–0105 | dev_requests, schedule_daily_cron, enforce_single_active_timer, users_deactivation |
| 0106 | **Bot WhatsApp v1**: prompt + tools alineadas a las 5 fases del cliente. `wa_bot_configs` con system_prompt robusto. |
| 0107 | **Config de bot separada por audiencia** (`client` \| `lead`): drops singleton id=1, agrega `audience` como PK. Inserta fila `lead` con prompt para prospectos. |
| 0108 | **`wa_leads`**: tabla one-row-per-conversation con datos recolectados por el bot (company, contact, interest, budget, urgency, notes). Habilita tool `submit_lead_info` en config `lead`. |
| 0109 | **Pipeline comercial de leads** en `wa_leads`: status (`active`/`escalated`/`converted`/`rejected`/`archived`), `assigned_to_user_id`, `converted_to_client_id`, `rejected_reason`, trigger touch `status_updated_at`. |
| 0110 | **Tracking de tokens** en `ai_jobs`: columnas `tokens_input`, `tokens_output`, `tokens_cached`. Para reportes de costo en `/admin/whatsapp`. |
| 0111 | **Regla #1 NO SALUDAR** en ambos prompts (client y lead) — fix del saludo duplicado. |
| 0112 | `REPLICA IDENTITY FULL` en `wa_conversations`, `wa_messages`, `wa_leads` — payloads de realtime UPDATE incluyen row completo. |
| 0113 | Prompt de leads inyectado con contexto completo de fmcomsolutions.com (servicios, planes con precios públicos, industrias, clientes, contacto). |
| 0114 | **`requirements.requested_via`** (`portal`/`whatsapp_bot`/`staff`/`unknown`) para trazabilidad de canal de origen. |
| 0115 | Bot de clientes puede crear solicitudes de contenido: habilita tools `check_request_eligibility` + `create_requirement_request`. Sube `max_tokens` 600→800. Prompt reescrito con flujo step-by-step de 5 pasos. |
| 0116 | Bot de clientes: capacidad de solicitar **cambios y reprogramaciones** (tools `request_requirement_change` + `request_reschedule`); prompt del cliente actualizado (supersede 0115), `max_tokens=1000`. |
| 0117 | **Tareas asignadas**: tabla `assigned_tasks` (título, descripción, `client_ref` texto libre, responsable, creador, `status` pending/in_progress/done/cancelled, timestamps). `time_entries` gana `task_id` + `entry_type='task'` (constraints `entry_type_check` y `type_check` extendidos). El tiempo de una tarea es una `time_entry` normal → cuenta como productividad (endShift) y sale en /tiempo. RLS: responsable ve las suyas, admin/supervisor ven/gestionan todas; transiciones del operador (start/done) vía service role. Página `/tareas` role-aware. Notificaciones derivadas `task_assigned`/`task_completed`. |
| 0118 | **Bot fixes — formato WhatsApp**: `sanitizeForWhatsapp()` en `src/lib/whatsapp/formatForWhatsapp.ts` convierte markdown `**bold**`→`*bold*`, headings→`*Heading*`, normaliza bullets, convierte tablas markdown a `Label: Value`. Detección de tabla requiere header+separador+data-row (evita falsos positivos). Respeta bloques de código. + Prompt actualizado para no usar markdown. |
| 0119 | **Bot handoff — notificación real**: `wa_conversations` gana columnas `needs_attention` (bool), `attention_reason` (text), `attention_at` (timestamptz). `handoff_to_human` tool ahora setea esas columnas + encola notif `wa_handoff`. Inbox sidebar destaca convs con `needs_attention=true`. `markConversationRead` + `toggleBotForConversation` (reanudar) limpian el estado. |
| 0120 | **Bot billing — carril A + extras**: habilita tools `send_payment_link` (reenvía/regenera link n1co de factura pendiente) + `create_extra_invoice` (contenido/cambios a precio fijo, catálogo fijo). Core fiscal compartido `src/lib/domain/invoice-create.ts` (`createIssuedInvoiceWithLink`, `regenerateInvoiceLinkCore`, `ensureScheduledCycleCore`). Helpers de bot en `src/lib/ai/billingHelpers.ts`. |
| 0121 | **Bot billing — renovación**: habilita tool `create_renewal_invoice`. Solo `monthly`; bimestral/quincenal → `needsHuman=true` → handoff. Idempotente (reutiliza factura unpaid del ciclo scheduled). Marca `auto_billed_at` para evitar duplicado con cron. |
| 0122 | **Multi-marca por número**: `client_whatsapp_contacts.phone_e164` UNIQUE global → `UNIQUE(client_id, phone_e164)`. Permite un mismo número en N clientes. `wa_conversations.client_id` = marca ACTIVA (sticky, bot pregunta si es ambiguo). Tools nuevas `list_linked_brands` + `set_active_brand` en `wa_bot_configs.enabled_tools` (audience client). `src/app/actions/whatsapp.ts` gana `setActiveBrandForConversation`; `linkConversationToClient` es aditivo; `unlinkConversationFromClient` quita solo la marca activa. `WaChat.tsx` muestra chips de marcas vinculadas. |
| 0123 | **Fix costo bot 100x (backfill)**: `ai_jobs.cost_usd_cents` de jobs `whatsapp_reply` estaba inflado ~100x (la fórmula en `whatsappReply.ts` multiplicaba por `*100` de más sobre coeficientes que ya estaban en céntimos/token). Divide entre 100 (`ceil`) las filas históricas. Solo `whatsapp_reply` escribe esa columna. Idempotente vía tabla `oneshot_backfills` + cutoff `now()`. **Aplicar DESPUÉS de desplegar el fix del handler.** |
| 0124 | **Watchdog claim_ai_job**: rescata jobs colgados en `status='processing'` (serverless muerto entre claim y complete/fail). `claim_ai_job` ahora también reclama `processing` con `locked_at` > 5 min y `attempts < max_attempts` → reintento real. Preserva la firma `(text, text[])`. El índice de dedupe solo mira `pending`, así que un colgado no dejaba muda la conversación (hallazgo secundario). |
| 0125 | **Fix RLS de `client-logos`**: la única policy de INSERT (0007) exigía `role='admin'`, pero `LogoUploader` se usa también desde el portal (el propio cliente) y por supervisores → "new row violates row-level security policy". Recrea las policies de forma idempotente: staff interno en cualquier carpeta, cliente solo en `{clientId}/` vía `is_client_of`. |
| 0126 | **Recordatorio de factura por vencer**: `invoices.due_reminder_sent_at` (marcador de notificación; se escribe ANTES de enviar → at-most-once, para que el watchdog de 0124 no reejecute el handler y duplique el cobro) + `ai_jobs.invoice_id` con índice único parcial contra doble encolado + índice de apoyo al query diario del cron. |
| 0127 | **Bot envía el PDF de facturas**: habilita la tool `send_invoice_document` (audience `client`) + guía de prompt. Envía como mensaje libre (ventana de 24h abierta), no plantilla. |
| 0128 | **Aviso de ventana de 24h por cerrar**: `users.notify_wa_window` (bool, default false). Solo quienes lo tienen activo reciben la notificación de conversaciones sin contestar cuya ventana de WhatsApp está por vencer. Seed por nombre (laura/samuel) — **verificar a quién le pegó**. Se activa/desactiva con un `update` sin redeploy. |
| 0129 | **Creador de matrices (bloque 1)**: `content_matrices` (una por cliente + `period_start`, `unique(client_id, period_start)`, estados `draft`/`approved`/`closed`, `topics_json` con `check (jsonb_typeof(topics_json)='array')`, `lead_days`, `matrix_requirement_id`) y `content_matrix_items` (piezas: tipo, título, tema, objetivo, copy, guión, estilo visual, hashtags, CTA, deadline, `needs_production`; `status`/`requirement_id`/`blocked_reason`/`converted_at` reservados para el bloque 2). Índices **únicos** parciales en el vínculo al requerimiento (`content_matrices_matrix_requirement_uq`, `content_matrix_items_requirement_uq`: una matriz por requerimiento de matriz, una pieza por requerimiento) e índice parcial en piezas `planned`. Checks de longitud `*_len_chk` con los topes de `MATRIX_TEXT_LIMITS` (tema 60). `set local lock_timeout='5s'` antes de los `create table`. RLS: una sola policy `for all` por tabla para `role in ('admin','supervisor')` (equivale a las 4 policies separadas). |
| 0130 | **Creador de matrices (bloque 2)**: `content_matrix_items` gana `assigned_to` (`uuid[]`, responsables de la pieza, se copian al requerimiento al convertir), `estimated_time_minutes` (`integer`, con constraint **con nombre** `content_matrix_items_est_minutes_chk`: `null` o entre 1 y 10080 — 7 días) y `blocked_at` (`timestamptz`, momento del bloqueo: `updated_at` lo pisa cualquier edición del brief, así que no puede fechar ni ordenar el aviso). Índice parcial `content_matrix_items_blocked_idx` sobre `(blocked_at desc nulls last, id desc) where status = 'blocked'` — el `nulls last` y el desempate por `id` son obligatorios: replican exactamente el `order` del query de `/api/notifications` (`desc` implica `nulls first`, así que sin ellos Postgres no podría usar el índice para ordenar). Cierra con un **backfill idempotente** que data con `updated_at` las piezas ya `blocked` sin `blocked_at`. Todo dentro de una transacción con `set local lock_timeout = '5s'` (convención de 0129). |
| 0131 | **Creador de matrices (bloque 3)**: `client_brand_profiles` (perfil de marca: una fila por cliente, `client_id` PK y FK a `clients` `on delete cascade`; `tone`, `person` — `voseo`/`tuteo`/`usted`, **nulo permitido** porque el perfil se llena campo por campo —, `audience`, `value_proposition`, `offerings`, `avoid`, `base_hashtags` `text[]` (≤ 15), `sample_copies` `jsonb` array de strings (≤ 5), `updated_by_user_id`). Checks **con nombre** `client_brand_profiles_*_chk` con los topes de `BRAND_TEXT_LIMITS` (tres lados, como `MATRIX_TEXT_LIMITS`); el largo de **cada elemento** de los dos arrays (40 y 1000) no lo puede validar un check sin subconsulta: lo valida solo la app (`validateBrandPatch`). Trigger `updated_at` y una sola policy `for all` para admin/supervisor. `ai_jobs` gana `content_matrix_id` y `content_matrix_item_id` (FK `on delete cascade`: un job de una matriz o pieza borrada no le sirve a nadie) con los índices únicos parciales `ai_jobs_one_active_matrix_generate` y `ai_jobs_one_active_matrix_item_write` sobre `status in ('pending','processing')` — cubren `processing`, la variante de 0126 y no la de 0091: el trabajo en curso también bloquea un segundo encolado. `content_matrix_items` gana `ai_written_at` (qué redactó la IA, y la diferencia entre "sin redactar" y "el usuario vació el brief"). Todo en una transacción con `set local lock_timeout = '5s'`. |

> La rama asume que `content_matrices`/`content_matrix_items` existen. En un entorno donde 0129 no esté aplicada, `/matrices` y `/matrices/[id]` muestran el error boundary de `src/app/(app)/error.tsx`; la tarjeta del perfil (`ClientMatricesCard`) está guardada con un `.catch()` sobre `loadClientMatrices` en `clients/[id]/page.tsx` y simplemente no aparece.

## Tareas asignadas (feature — migración 0117)

Función para que supervisores/admins asignen tareas específicas (fuera del plan de un cliente) a miembros del equipo.

- **Modelo**: metadata en `assigned_tasks`; el tiempo se registra en `time_entries` (`entry_type='task'`, `task_id`). Horas de una tarea = `SUM(duration_seconds)` de sus entries. Cuenta como productividad automáticamente (endShift/computeTimeSummary suman toda entry).
- **Server actions** `src/app/actions/tasks.ts`: `createTask`/`editTask`/`reassignTask`/`cancelTask` (admin/supervisor), `startTaskTimer`/`markTaskDone` (responsable). Reusan guardas de timer desde `src/lib/time/entry-guards.ts` (helpers extraídos de `time.ts`: `getActiveEntry`, `findOverlappingEntry`, `overlapErrorMsg`). Un solo timer activo por usuario (índice 0104) cubre también las tareas.
- **UI** `/tareas` (nav "Tareas", visible a todos los roles internos): admin/supervisor → `TaskManagerPanel` (lista + filtros por responsable/estado + asignar/editar/reasignar/cancelar); operador → `MyTasksPanel` (iniciar/detener timer, marcar finalizada, historial + contador de horas). El timer activo de tarea se refleja en `ClockInPanel` de /tiempo con badge "Tarea".
- **Notificaciones**: derivadas en `/api/notifications` (sin tabla; kinds `task_assigned` al responsable y `task_completed` al asignador) + toast/bell + browser-notif.

## Auth — fix expulsión de sesión (2026-07-07)

`verifySession` en `src/app/actions/sessions.ts` ahora retorna `status: 'valid' | 'superseded' | 'unknown'` en lugar de `{ valid: boolean }`. `SessionSentinel.tsx` solo expulsa al usuario en `superseded` (hay otro `current_session_id` no-nulo diferente en DB). `unknown` (fallo transitorio de auth, columna NULL) ya NO provoca kick — antes causaba falsos positivos cada 30s.

## Integración WhatsApp Cloud API + Bot IA (migraciones 0091 + 0106–0122)

**Stack:** webhook receiver en Vercel, runner de jobs IA reemplaza ai-worker externo (corre dentro de Vercel vía cron + trigger del webhook), Anthropic Claude Sonnet 4.6 con tool-use loop y prompt caching, plantillas aprobadas por Meta para mensajes salientes proactivos.

### Tablas (migración 0091 + extensiones)
- `client_whatsapp_contacts` — contactos WA por cliente. **Constraint post-0122: `UNIQUE(client_id, phone_e164)`** (antes era `UNIQUE(phone_e164)` global). Un mismo número puede pertenecer a N clientes (multi-marca).
- `wa_conversations` — una por número externo (`phone_e164` UNIQUE). Campos: `client_id` (FK clients, NULL = lead o multi-marca sin activa elegida), `bot_paused`, `unread_count`, `last_message_at`, `last_message_preview`, `needs_attention` (bool), `attention_reason` (text), `attention_at` (timestamptz).
- `wa_messages` — todos los mensajes, direction `inbound`/`outbound`. `wamid` UNIQUE para idempotencia. `sent_by` ∈ `bot`/`staff`/`system`. `ai_job_id` FK para auditar qué job lo generó.
- `wa_bot_configs` — PK `audience` (`client` \| `lead`). Cada audience tiene su prompt, modelo, tools habilitadas, debounce, max_tokens, etc. Editable en `/admin/whatsapp` sin redeploy.
- `wa_leads` — one-row-per-conversation con info recolectada por el bot. Pipeline comercial (status, assigned_to, converted_to_client_id).

### Columnas añadidas
- `clients.wa_bot_enabled` (boolean default true) — toggle por cliente.
- `requirements.requested_via` (text) — trazabilidad (`portal` default, `whatsapp_bot`, `staff`, `unknown`).
- `ai_jobs.wa_conversation_id` + índice único parcial → dedupe de jobs `whatsapp_reply` por conversación.
- `ai_jobs.tokens_input`/`tokens_output`/`tokens_cached` (integer) → costo en `/admin/whatsapp`.

### Arquitectura del runner IA (sin ai-worker externo)
- `src/lib/ai/runner.ts` — `runJobs({maxJobs, waitForUpcomingMs})`: claim_ai_job → dispatch al handler → completar/reintentar con backoff exponencial.
- `src/app/api/ai-jobs/process/route.ts` — endpoint POST/GET autenticado por `CRON_SECRET` (Vercel Cron header) o `AI_JOBS_TRIGGER_SECRET` (trigger interno desde webhook + server actions). **`maxDuration = 180`**, con `RUNNER_BUDGET_MS = 45_000` como corte para *reclamar* (un job reclamado a los 44,9 s tiene que poder terminar: un padre de matriz grande pasa de 40–80 s de modelo). **No subirlo cerca de 300**: el watchdog de 0124 rescata a los 5 min de `locked_at`, así que una función que corriera ~300 s con un job reclamado al principio vería ese job reclamado otra vez mientras sigue vivo (doble llamada al modelo, doble mensaje).
- **Barrido de zombis agotados** (`sweepExhaustedZombies`, `src/lib/ai/zombies.ts`), al arrancar `runJobs` y antes de reclamar: marca `failed` (`error_text` "La función terminó sin respuesta en el último intento.") los jobs `processing` con `locked_at` de más de **10 min** y `attempts >= max_attempts` — la condición de intentos se filtra en JS tras un select con `.limit(50)`, y el update lleva `.eq('status','processing')` para no pisar una terminación concurrente. **Por qué**: el watchdog de 0124 solo rescata `attempts < max_attempts`, así que un job muerto en su último intento quedaba `processing` para siempre, y con los índices únicos que cubren `processing` (0126, 0131) eso era un candado permanente sobre la factura, la matriz o la pieza (solo se destrababa con SQL a mano). Aplica a todos los tipos: un `whatsapp_reply` colgado pasa a verse en `WaBotFailedJobs`. Nunca lanza (loguea y sigue) y cuesta una lectura acotada por invocación.
- `vercel.json` — cron cada minuto a `/api/ai-jobs/process?max=10&wait=15000` como fallback de procesamiento.
- Webhook WhatsApp y `enqueueReviewReadyNotification` disparan el runner con fire-and-forget tras encolar (low-latency).
- Handlers registrados en `src/lib/ai/runner.ts`: `whatsapp_reply`, `whatsapp_template`, `invoice_due_reminder`, y los dos de matrices (`matrix_generate`, `matrix_item_write`, ver "Bloque 3" en la sección de matrices). El disparo fire-and-forget vive en un solo sitio, `triggerJobRunner({ max, waitMs })` de `src/lib/ai/trigger.ts` (webhook `max: 3`/debounce, `whatsappNotify` `max: 2`/0, matrices `max: 2`/0 y el fan-out del padre `max: 3`/0).
- **El directorio `ai-worker/` ya NO está en uso productivo** — quedó legacy para referencia local. Vercel + Supabase es la infra real.

### Tools del bot (src/lib/ai/tools.ts)
Filtradas en runtime por `wa_bot_configs.enabled_tools`:
- `get_client_context` — datos básicos del cliente
- `get_requirements_summary` / `get_requirements_by_phase` / `get_requirement_detail` — fases visibles al cliente (5, mapeadas con `CLIENT_PHASE_MAP`)
- `get_billing_status` — días restantes, pago, gracia, plan
- `get_unpaid_invoices` / `get_next_publications`
- `check_request_eligibility` + `create_requirement_request` — bot puede crear solicitudes de contenido (mismas validaciones que el portal, reusa `createRequirementRequestCore`)
- `request_requirement_change` — inserta `requirement_cambio_logs` status=pending (requiere `change_notes`). NO consume pool.
- `request_reschedule` — mensaje+mention al asignado sin modificar deadline.
- `handoff_to_human` — pausa bot + sets `needs_attention=true` en `wa_conversations` + notif `wa_handoff` al equipo + marca lead `escalated` si aplica
- `submit_lead_info` — solo audience `lead`, upsert por conversation_id en `wa_leads`
- `send_payment_link` — busca factura unpaid, regenera link n1co, retorna URL. `src/lib/ai/billingHelpers.ts`.
- `create_extra_invoice` — emite factura de catálogo fijo: contenido extra (precios en `EXTRA_CONTENT_PRICES`) o cambios extra ($25/paquete de 5). Crea link n1co. Decisión de negocio: emisión directa con confirmación del bot (no aprobación staff).
- `create_renewal_invoice` — solo `monthly`; bimestral/quincenal → handoff. Idempotente. Marca `auto_billed_at`.
- `list_linked_brands` — lista marcas vinculadas al número en `client_whatsapp_contacts`. Multi-marca.
- `set_active_brand` — fija `wa_conversations.client_id`. Valida contra `client_whatsapp_contacts`. Multi-marca.

**Helper `noClient(ctx)`**: si `ctx.candidateClientIds.length > 1` retorna `needs_brand_selection=true`, si es 0 retorna `NO_CLIENT`. Todas las tools lo usan cuando `ctx.clientId` es null.

### Formato WhatsApp
`src/lib/whatsapp/formatForWhatsapp.ts` — `sanitizeForWhatsapp(text)`:
- `**bold**` → `*bold*`, `__x__` → `*x*`, `## Heading` → `*Heading*`
- Normaliza bullets (`- ` → `• `)
- Tablas markdown → `Label: Value` por línea (requiere header+separador con `-`+data row; sin data row, pasa tal cual)
- Respeta bloques de código (no toca nada dentro de ` ``` `)

### Multi-marca por número (post-0122)
- Bot: `whatsappReply.ts` deriva `candidateClientIds` de `client_whatsapp_contacts` por `phone_e164`. Si >1 y no hay `conv.client_id`, retorna `needs_brand_selection=true` en todas las tools → bot llama `list_linked_brands` → pregunta al cliente → `set_active_brand`.
- Staff: `WaChat.tsx` muestra chips de todas las marcas vinculadas; la activa con `●`; clic en otra llama `setActiveBrandForConversation`.
- `linkConversationToClient` es ADITIVO (scope a `client_id`). `unlinkConversationFromClient` quita SOLO la marca activa (no toca las otras).

### Bot billing — módulo fiscal compartido
`src/lib/domain/invoice-create.ts`:
- `createIssuedInvoiceWithLink(admin, args)` — crea `invoice` issued + link n1co. Compartido por bot y portal.
- `regenerateInvoiceLinkCore(admin, invoiceId)` — regenera link sin auth gate.
- `ensureScheduledCycleCore(admin, clientId)` — crea/retorna cycle scheduled, archiva stales.

`src/lib/ai/billingHelpers.ts` — adapta el core para el bot:
- `sendPaymentLinkForClient(clientId, invoiceId?)` — encuentra factura unpaid, regenera link, retorna URL.
- `createExtraContentInvoiceForClient(clientId, contentType, qty)` — precios fijos en `EXTRA_CONTENT_PRICES`.
- `createExtraCambiosInvoiceForClient(clientId, packages)` — $25 por paquete de 5 cambios.
- `createRenewalInvoiceForClient(clientId)` — solo monthly; `needsHuman:true` si no.

### Plantillas aprobadas (`src/lib/whatsapp/templates.ts`)
Registry tipado `WA_TEMPLATES`. Cada entry declara `name` + `language` (debe coincidir EXACTO con lo aprobado por Meta, ej. `es_MX`) + `paramKeys` en orden.
- `REVIEW_READY` → `revision_cliente_lista` (es_MX). Disparada por `enqueueReviewReadyNotification(requirementId)` desde `movePhase` cuando `toPhase='revision_cliente'` (PhaseSheet, MovePhaseModal).

### Inbox UI
- `/whatsapp` (admin/supervisor/operator) — sidebar reactiva (realtime + poll 20s + visibility refetch) + chat con vincular/cambiar/desvincular marca, pausar/reanudar bot, panel de lead si aplica.
- `/whatsapp/leads` — bandeja dedicada con stats (total / activos / escalados / convertidos / % conversión / valor estimado), filtros (status, asignado, búsqueda), acciones por fila (escalar / convertir-a-cliente / descartar / reasignar), export CSV.
- `/admin/whatsapp` (solo admin) — tabs Clientes / Leads para editar prompt + tools por audience. Stats de consumo del mes actual y anterior + breakdown por cliente. Sección **`WaBotFailedJobs`**: últimos 20 `ai_jobs` con `status='failed'` (respuestas del bot, plantillas y recordatorios de factura) con cliente, factura, intentos y error. Es la única superficie donde el equipo ve que algo del bot no salió — un recordatorio de factura se envía at-most-once, así que si falla el cliente no recibe aviso.

### Env vars añadidas (Vercel Production)
- `WHATSAPP_VERIFY_TOKEN` — verificación GET del webhook.
- `WHATSAPP_APP_SECRET` — validar firma `X-Hub-Signature-256`.
- `WHATSAPP_TOKEN` — Bearer token Graph API (System User permanente).
- `WHATSAPP_PHONE_NUMBER_ID` — para construir POST a `/v22.0/{id}/messages`.
- `WHATSAPP_WABA_ID` — para gestión de templates.
- `ANTHROPIC_API_KEY` — Claude API.
- `ANTHROPIC_MODEL` — default override (ej. `claude-sonnet-4-6`).
- `ANTHROPIC_MATRIX_MODEL` — opcional: modelo de la generación de matrices (bloque 3; default `claude-sonnet-4-6`). **Propia a propósito**: cambiar `ANTHROPIC_MODEL` para el bot no altera las matrices.
- `CRON_SECRET` — Bearer que Vercel Cron envía automáticamente al endpoint.
- `AI_JOBS_TRIGGER_SECRET` — header `x-trigger-secret` para invocaciones internas (webhook → runner, server action → runner).

### Convención de números
- Internamente: `phone_e164` (con `+`).
- A Meta Graph API: sin `+` (helper `sendWhatsappText` y `sendWhatsappTemplate` lo strip).
- URL canónica de webhook: `https://www.fullefm.site/api/whatsapp/webhook` (con `www`). Meta NO sigue redirects; el dominio raíz `fullefm.site` redirige a `www`.

### Trazabilidad de costos
- `ai_jobs.cost_usd_cents` calculado por handler según pricing Sonnet 4.6 ($3/M in, $15/M out, $0.30/M cache). Fórmula en `whatsappReply.ts` usa constantes `USD_PER_MTOK_*` y `/1_000_000` → céntimos enteros. **NO agregar un `*100` extra**: la conversión USD→céntimos ya está incluida (bug histórico corregido en migración 0123).
- `WaBotUsageStats` (src/components/whatsapp/) — tarjetas mes actual/anterior + tabla por cliente. Muestra dólares con `cost_usd_cents / 100` (conversión céntimos→dólares correcta; NO tocar). TZ America/El_Salvador para corte mensual.

## Matrices de contenido (bloques 1, 2 y 3 — 2026-09)

Planificación mensual por cliente: temas del mes + piezas (tipo, título, tema, objetivo, copy, guión, estilo visual, hashtags, CTA, deadline) agrupadas en una matriz por período objetivo. Migración `0129_content_matrices.sql` — **aplicada el 2026-09-17**.

- Spec: `docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md` (ver su sección final "Desviaciones implementadas" y "Pendiente para bloques 2–3": manda sobre el texto original). Plan: `docs/superpowers/plans/2026-09-16-creador-de-matrices-bloque-1.md`.
- **Dominio puro** `src/lib/domain/matrix.ts`: `computeTargetPeriods` (ciclo vigente + N-1 siguientes), `resolveMatrixLimits` (cupos desde el ciclo o, sin ciclo, estimados desde el plan; con ciclo, `credits` = créditos restantes **más** los ya consumidos por requerimientos del ciclo que cuentan en `computeTotals` — 1 unidad del `content_type` por requerimiento con `paid_from_credit_id`, no anulado ni arrastrado — porque esos requerimientos ya suman en `cycleTotals` y sin devolver su crédito marcarían "fuera de plan" de más, también bajo pool; `remainingCredits` guarda los créditos aún disponibles tal cual), `computeMatrixUsage` (uso por tipo + pool unificado + piezas fuera de plan, orden canónico via `compareMatrixItems`; por tipo y en el pool expone `credits` — efectivos: tono, "fuera de plan", tipos activos — y `availableCredits` — disponibles: lo que muestra el chip "+N créd." de `MatrixChips`; nunca usar uno por el otro), `proposeDeadline` (primera semana con presupuesto libre; recibe `today` para no proponer semanas ya cerradas ni una fecha pasada), `pickCycleForPeriod` (desempate entre ciclos que comparten `period_start`), `MATRIX_TEXT_LIMITS` (topes de caracteres por campo, usados a la vez como `maxLength` en la UI, como validación en las acciones y en los checks `*_len_chk` de 0129 — `char_length` cuenta code points y la app `.length` UTF-16, así que la base nunca es más estricta; si se cambia un tope, cambiarlo en los tres lados), `validateForApproval`/`validateItemPatch` (piezas sin título o fuera del período, tipos/temas/objetivos válidos).
- **Distribución semanal** compartida con el resto del pipeline: `buildEffectiveDistribution` en `weekly-distribution.ts` acepta `weeks` (8 para ciclos bimestrales vía `weeksForBillingPeriod`).
- **Loaders** `src/lib/data/matrices.ts`: lanzan ante error de consulta (la página muestra el error boundary en vez de datos truncados). `loadMatricesList` devuelve `{ rows, truncated, since }` acotado a los últimos 365 días (`MATRICES_LIST_LIMIT` filas). `loadClientMatrices(db, client, currentCycle)` alimenta la tarjeta del perfil.
- **Acciones** `src/app/actions/matrices.ts`: todas exigen rol admin/supervisor (`requireManager`). Los períodos que manda el navegador se validan contra `computeTargetPeriods` del cliente (`validateTargetPeriod`), nunca se confía en lo recibido. Al crear o duplicar, `linkMatrixRequirement` registra el requerimiento `matriz_contenido` en el ciclo vigente usando el cliente **autenticado** (no el admin client) para que el trigger de pago aplique como a un registro manual, con `requested_via='staff'`; el `update ... is('matrix_requirement_id', null)` hace el vínculo a prueba de carrera (doble clic / reintentos concurrentes) y limpia el requerimiento huérfano si nadie ganó la carrera. **Vínculo anulado**: si `matrix_requirement_id` apunta a un requerimiento `voided` (o que ya no existe), `linkMatrixRequirement` suelta el vínculo con un update condicional (`.eq('matrix_requirement_id', thatId)`) y registra uno nuevo; `loadMatrixEditorData` trae `voided` en `linkedRequirement` y el editor muestra la franja "El requerimiento de matriz vinculado fue anulado." con "Reintentar". `retryMatrixRequirementLink` rechaza matrices cerradas. `deleteMatrix` borra primero la matriz en borrador (las piezas caen por cascade) y solo entonces intenta limpiar el requerimiento vinculado — lo conserva si está anulado (rastro de auditoría), dejó de estar en fase `pendiente`, tiene crédito pagado, su ciclo no es `current` (nunca se borra historia de un ciclo archivado/pendiente de renovación), o tiene cualquier fila dependiente (`time_entries`, `requirement_messages`, `review_assets`, `requirement_cambio_logs`, `ai_jobs`). Quitar temas en `updateMatrix` suelta las piezas por `id` (lee `id, topic` y filtra en JS): `.in('topic', …)` se rompe con temas que llevan comillas porque postgrest-js no las escapa.
- **Guardado por campo sin revalidatePath**: `updateItem` y `updateMatrix` (salvo cuando cambia el `title`, visible en el `TopNav`) NO llaman `revalidatePath` — en esta versión de Next 16, `revalidatePath` dentro de una server action re-renderiza la página actual completa sea cual sea el path, así que un guardado de campo dispararía un refresh de toda la página del editor en cada tecleo perdido de foco. El editor aplica localmente la fila que devuelve la acción.
- **Editor** (`MatrixEditor.tsx` + `MatrixHeader`/`MatrixTopicsBar`/`MatrixItemsTable`/`MatrixItemSheet`): mantiene todo el estado en cliente inicializado desde props, sin `router.refresh()`; usa refs `confirmed*` (última fila confirmada por el servidor, para el rollback) y una secuencia por campo (`item:<id>:<campo>`, `matrix:<campo>`) para que una respuesta vieja nunca pise ni revierta un guardado más nuevo del mismo campo. Si un guardado de texto falla, lo escrito se conserva en `failedItemDrafts`/`failedMatrixDrafts` (no se pierde) y el campo muestra "· sin guardar"; enfocarlo de nuevo carga el borrador fallido para reintentar al salir. Con cualquier borrador fallido pendiente aparece una franja persistente "Hay cambios sin guardar…" con botón **"Descartar cambios sin guardar"** (pide confirmación) que limpia todos los borradores fallidos y el error de guardado visible. `MatrixHeader`/`MatrixTopicsBar`/`MatrixItemSheet` solo retienen su borrador local mientras el campo está enfocado y lo sueltan en `onBlur`; un clic en "Descartar" dispara ese blur antes del `onClick`, así que no hace falta remontarlos (`key`) para que vuelvan a mostrar el valor confirmado — cuidado si se les agrega un `key` compartido entre hermanos: React 19 los trata como una lista keyed y con claves repetidas se queda con una sola fibra por clave (bug real detectado y corregido en este bloque). Un `beforeunload` avisa si se intenta salir con cambios sin guardar. Cerrar la matriz (`status='closed'`) limpia esos borradores y el error automáticamente: los campos quedan de solo lectura y un reintento ya no es posible.
- El motivo real de un vínculo fallido al crear o duplicar se pasa del formulario al editor vía `sessionStorage` (`matrixLinkError.ts`) — el servidor no tiene `sessionStorage`, así que se lee después de montar para no desincronizar el HTML del servidor y la hidratación.
- La matriz se ancla al **ciclo de facturación** (`period_start`/`period_end`), no al mes calendario.
- Cupos excedidos = aviso ("fuera de plan"), **nunca bloqueo**. Bajo pool unificado los tippables (`TIPPABLE_CONTENT_TYPES`: `estatico`, `video_corto`, `reel`, `short`) comparten un chip de cupo; `historia` queda fuera del pool, con límite propio.
- **Solo clientes creables** (`MATRIX_CREATABLE_CLIENT_STATUSES`/`canCreateMatrixForClient` en `matrix.ts`: `active`, `paused`, `overdue`) pueden recibir una matriz nueva — un cliente `inactive_payment`/`inactive_manual` no. Se filtra en `MatricesPageClient` (diálogo) y en `ClientMatricesCard` (oculta "+ Crear matriz" y muestra el aviso), y se re-valida en servidor en `createMatrix`/`duplicateMatrix` (`assertClientCreatable`). `loadMissingMatrices` ya solo lista clientes `active`.
- Tarjeta `ClientMatricesCard` (perfil del cliente, solo admin/supervisor) y páginas `/matrices` (lista) y `/matrices/[id]` (editor).
- Bloques 2 (conversión automática) y 3 (asistencia con IA) implementados: ver las subsecciones siguientes.

### Bloque 2 — conversión automática (2026-09)

Las piezas de una matriz **aprobada** se registran solas como requerimientos del pipeline, `lead_days` antes de su fecha de entrega. Migración `0130_matrix_items_assignment.sql` — **aplicada el 2026-09-17**.

- Spec: `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md`. Plan: `docs/superpowers/plans/2026-09-17-creador-de-matrices-bloque-2.md`.

#### El barrido diario (`/api/matrices/convert`)

- Ruta `src/app/api/matrices/convert/route.ts`, `runtime = 'nodejs'`, `maxDuration = 60`. Cron en `vercel.json`: **`0 12 * * *`** → 12:00 UTC = **6:00 AM en El Salvador** (GMT-6), antes de que entre el equipo y sin colisionar con los crons existentes. Vercel Cron manda **GET**, así que `GET` delega en `POST`. Auth: `Authorization: Bearer $CRON_SECRET` **o** header `x-trigger-secret: $AI_JOBS_TRIGGER_SECRET` (el mismo par que usa el runner de IA); sin ninguno de los dos → 401. Se dispara a mano con `curl -X POST -H "x-trigger-secret: …" …/api/matrices/convert`. **La ruta tiene que estar en `SECRET_AUTH_API_PREFIXES` de `src/proxy.ts`**: el middleware exige sesión de Supabase para todo lo demás y responde **307 a `/login`**, así que el cron recibiría un redirect —que Vercel da por bueno— y el barrido no correría nunca, sin un solo log. Le pasaba también a `/api/billing/due-reminders` (corregido a la vez). Al agregar un cron a `vercel.json`, agregarlo también a esa lista.
- **Ventana**: piezas con `deadline` entre `hoy - CATCHUP_DAYS` (30 días de recuperación hacia atrás, por si el cron no corrió) y `hoy + 30` (`WINDOW_DAYS`, cota barata en SQL porque el tope de `lead_days` es 30). El filtro fino — `deadline <= hoy + lead_days` de **su** matriz — lo hace `shouldConvert`/`selectItemsToConvert` en el dominio, ya en memoria.
- **El filtro de matriz aprobada va en SQL a propósito** (`matrix:content_matrices!inner(...)` + `.eq('matrix.status','approved')`): si se filtrara en JS, las piezas viejas de matrices en borrador o cerradas se acumularían en la cabeza del ranking y, pasado `SCAN_LIMIT`, el barrido dejaría de encontrar piezas convertibles **sin dar error**.
- **Topes**: `SCAN_LIMIT = 300` filas leídas, `CONVERT_LIMIT = 80` piezas por corrida (las más urgentes primero, orden canónico de `compareMatrixItems`). Lo que no entró se convierte mañana.
- **Presupuesto de tiempo `TIME_BUDGET_MS = 45_000`** (15 s por debajo de `maxDuration`): cada conversión son 4–6 viajes a la base y 80 piezas pueden pasarse de los 60 s. Si la plataforma matara la función **entre el insert del requerimiento y el update de la pieza**, quedaría un requerimiento vivo con la pieza todavía `planned` y el barrido de mañana crearía un **segundo** requerimiento (el índice único de 0129 no lo ataja: el id es distinto). Por eso se corta limpio y se deja el resto para la corrida siguiente (`stopped_early`/`remaining` en la respuesta).
- **Secuencial a propósito**, no en paralelo: dos piezas del mismo ciclo calcularían el cupo sobre el mismo estado y ambas nacerían dentro de plan.
- **Caché por corrida** (`createConvertCache`): ciclo vigente por cliente y requerimientos aprobados por `billing_cycle_id`. Un lote de 80 piezas suele ser de un puñado de clientes. **Un cliente sin ciclo vigente NO se cachea**: si una renovación crea el ciclo a mitad de corrida, cachear el `null` dejaría bloqueadas "sin ciclo vigente" todas las piezas restantes de ese cliente.
- Un `throw` inesperado de una pieza se captura y cuenta como `skipped`: no puede tumbar la corrida y perder los contadores. La respuesta trae `scanned/selected/converted/blocked/skipped/stopped_early/remaining/truncated/details` (máximo 50 detalles) y se loguea; una corrida con piezas elegibles y **cero** conversiones emite `console.error`.
- **Los motivos de `skipped` se loguean** (`console.error`, hasta 10 distintos por corrida). `details` solo viaja en la respuesta HTTP y en un cron no la lee nadie: sin ese log, una pieza que falla por algo que no bloquea (RLS, un check, un uuid inválido) se reintentaría cada mañana, gastaría un cupo del lote y **no dejaría rastro en ninguna pantalla** mientras el resto de la corrida fuera bien.
- **No desplegar a las 12:00 UTC.** Un deploy a media corrida mata la función y puede dejar el requerimiento creado con la pieza todavía `planned` — el caso del `TIME_BUDGET_MS`, que estrecha la ventana pero no la cierra. Para encontrar esos huérfanos (el requerimiento no lleva marca que lo distinga de uno manual, así que se cruzan por cliente + título + fecha):

```sql
select r.id, r.title, r.deadline, m.client_id, i.id as item_id
from requirements r
join billing_cycles bc on bc.id = r.billing_cycle_id
join content_matrix_items i on i.title = r.title and i.deadline = r.deadline and i.status = 'planned'
join content_matrices m on m.id = i.matrix_id and m.client_id = bc.client_id
where r.voided = false
  and not exists (select 1 from content_matrix_items x where x.requirement_id = r.id);
```

> Cada fila es un requerimiento sin pieza que lo reclame: o se anula en el pipeline, o se vincula a mano (`update content_matrix_items set status='converted', requirement_id=…, converted_at=now() where id=…`) antes de que el barrido cree el duplicado.

#### Los tres estados de pieza (`content_matrix_items.status`)

`planned` → `converted` (con `requirement_id` + `converted_at`) o `blocked` (con `blocked_reason` + `blocked_at`). Etiquetas en `MATRIX_ITEM_STATUS_LABELS` (`Planificada`/`Convertida`/`Bloqueada`).

- **Una pieza `blocked` NUNCA se reintenta sola.** `shouldConvert` exige `status === 'planned'`, así que el barrido ni la mira. La única salida es el botón **"Convertir ahora"** (`convertItemNow`), que sí acepta `planned` y `blocked`. Es deliberado: reintentar a diario una pieza de un cliente impago generaría ruido todos los días sin resolver nada.
- **"Convertir ahora" también aparece en las piezas `planned` que se le escaparon al barrido**: `isStalePlanned` (dominio) marca las que vencieron hace más de `CATCHUP_DAYS` en una matriz aprobada — matriz aprobada tarde, o pieza replanificada cuando su fecha ya había pasado. Sin el botón quedarían muertas en la tabla (el barrido ya no las mira) y "Volver a planificar" las devolvería a ese mismo limbo. Las `planned` **dentro** de la ventana no lo llevan a propósito: de eso se encarga el barrido y un clic de más convertiría antes de tiempo, consumiendo cupo del ciclo vigente.
- **Solo `P0001` y `23503` bloquean.** `P0001` es el candado de pago (`requirements_check_week_payment_trg`: semana impaga, cliente suspendido — el mensaje ya viene en español y se guarda tal cual, recortado a 500 caracteres) y `23503` es la FK del ciclo inexistente. **Cualquier otro error de insert (red, timeout, 5xx) devuelve `skipped` y se reintenta mañana**, precisamente porque a una `blocked` ya no la vuelve a mirar el barrido: marcarla por un fallo transitorio la dejaría muerta hasta que alguien la viera a mano.

#### El ciclo de destino y el cupo

- El requerimiento entra **SIEMPRE al ciclo vigente (`status='current'`) del cliente en el momento de convertir**, no al ciclo del período de la matriz. Consecuencia visible: una pieza cuya conversión cae antes de que arranque el período de su matriz consume cupo del ciclo **anterior**. `convertsBeforePeriodStart(item, matrix)` (dominio) detecta el caso y `MatrixItemsTable` muestra la advertencia en la fila.
- **`over_limit` se calcula con la cadena completa**, idéntica a la del registro manual: `effectiveLimits` → `applyContentLimitsWithOverride` → **`applyUnifiedPool`**. El `applyUnifiedPool` no es opcional: en un plan con pool unificado los límites por tipo valen 0 en el snapshot y **toda** pieza nacería `over_limit: true`.
- Los requerimientos del ciclo se leen con `.eq('approval_status','approved')`: `computeTotals` no filtra por aprobación y sin eso las solicitudes `pending` del portal contarían como cupo ya consumido.
- **Estar fuera de cupo no bloquea ni consume créditos**: el insert no lleva `paid_from_credit_id`, solo `over_limit: true`. Misma política que el bloque 1 (aviso, nunca bloqueo).
- El requerimiento nace con `approval_status: 'approved'`, `requested_via: 'staff'`, `priority: 'media'`, `includes_story: false`, `registered_by_user_id` = `matrix.approved_by ?? matrix.created_by` (o el usuario autenticado en "Convertir ahora"), y copia de la pieza `content_type`, `title`, `deadline`, `assigned_to` y `estimated_time_minutes`. Se le añade el log inicial de fase con `insertInitialPhaseLog`, igual que un registro manual.

#### El núcleo compartido y el rollback

`src/lib/data/matrix-convert.ts` — `convertMatrixItem(db, itemId, opts)` lo usan **igual** el barrido (con el cliente admin) y `convertItemNow` (con el cliente **autenticado**, para que el trigger de pago aplique como en un registro manual).

- El paso final marca la pieza con un update **condicional** (`.in('status', ['planned','blocked'])`). Si otro proceso ganó la carrera, se **deshace** el requerimiento recién creado.
- **El rollback va SIEMPRE con el cliente admin**, aunque la conversión haya corrido con el autenticado: `requirements` tiene RLS y **no existe ninguna policy `for delete`**, así que un delete autenticado devolvería 0 filas **sin error** y dejaría un requerimiento huérfano consumiendo cupo en silencio. `requirement_phase_logs` cae por cascade.
- Si el rollback falla, el requerimiento queda huérfano: se loguea con `console.error`, el motivo se devuelve como `Requerimiento huérfano: revisar en el pipeline.` y el caso se distingue en el resumen de la corrida. En el caché el requerimiento se **conserva** (sigue vivo y sigue consumiendo cupo, la pieza siguiente del mismo ciclo debe contarlo).

#### Acciones manuales del editor

- **`convertItemNow(itemId)`** — "Convertir ahora". Admin/supervisor (`requireManager`). Devuelve el `ConvertOutcome` tal cual para que la fila muestre el motivo si vuelve a bloquearse.
- **`replanItem(itemId)`** — "Volver a planificar". Exige que el requerimiento vinculado esté **anulado o ya no exista**; con uno vivo devuelve "El requerimiento sigue activo: anúlalo primero en el pipeline." **Esa guarda es imprescindible**: sin ella el barrido de mañana crearía un segundo requerimiento para la misma pieza (el índice único no lo ataja porque el id nuevo es distinto). Y replanificar significa exactamente eso: la pieza vuelve a `planned` y **el barrido la volverá a convertir** (el botón lo dice: "Volver a planificar (se convertirá de nuevo)"). Funciona también en matriz **cerrada** — a diferencia de `updateItem` — porque el caso real es "anulé el requerimiento y quiero dejar la pieza planificada", y el barrido ignora las matrices cerradas.

#### Edición de una pieza ya convertida

`updateItem` **congela** en la pieza los cinco campos que se copiaron al requerimiento: `title`, `content_type`, `deadline`, `assigned_to` y `estimated_time_minutes`. Se editan en el requerimiento; renombrar en la matriz dejaría la tarjeta del pipeline con el título viejo sin que nada indicara la divergencia. **El resto del brief sigue editable** (tema, objetivo, copy, guion, estilo visual, hashtags, CTA) y el requerimiento lo lee **en vivo**: `MatrixBriefSection` (montado en `PhaseSheet`) consulta `content_matrix_items` por `requirement_id` desde el navegador, así que cambiar el guion en la matriz y recargar la ficha basta para verlo. La RLS de esa tabla es de admin/supervisor: para un operador la query devuelve 0 filas (no error) y la sección simplemente no se renderiza; el portal del cliente no monta el componente.

#### Responsable y estimado

- `assigned_to` (`uuid[]`) y `estimated_time_minutes` se editan en `MatrixItemSheet` (checkboxes de usuarios + horas/minutos). `MATRIX_MAX_ASSIGNEES = 20` y `MATRIX_ESTIMATE_MAX_MINUTES = 10080` (7 días) se validan en `validateItemPatch` — el UUID también se valida con regex, porque un id cualquiera llegaría a Postgres y el usuario vería el `invalid input syntax for type uuid` crudo en vez de un mensaje en español. El tope de minutos está además en el check de 0130: si se cambia, cambiarlo en los dos lados.
- Lista vacía → se guarda `null`, para que la base tenga una sola forma de "vacío".
- **Aprobar ahora exige responsable y estimado** en toda pieza: `validateForApproval` añade los problemas `sin_responsable` y `sin_estimado`. **Las piezas ya `converted` quedan exentas** (`continue`): tienen esos campos congelados en el editor, así que exigirlos sería un problema imposible de arreglar.
- `addItem` prerrellena los responsables por defecto igual que `RequirementModal` (`default_assignee = true`, sin `client`/`agent`) y **filtra `deactivated_at is null`**: `deleteUser` desactiva sin limpiar `default_assignee` y el usuario desaparece de `/users`, así que el flag ya no se puede apagar; sin el filtro cada pieza nueva nacería asignada a alguien dado de baja y ese id acabaría copiado en el requerimiento real. Mismo filtro en `assignableUsers` del loader. `duplicateItem` y `duplicateMatrix` **sí** copian ambos campos: sin ellos la copia — el caso de uso principal — no se podría aprobar sin rellenarlos a mano.

#### Loader: `convertedInCycleIds` y `linkedVoidedItemIds`

`loadMatrixEditorData` devuelve dos listas nuevas (arrays, no `Set`: cruzan server → client):

- **`convertedInCycleIds`** — piezas `converted` cuyo requerimiento está en el ciclo leído **y cuenta en `computeTotals`** (ni `voided` ni `carried_over`). **El editor DEBE pasárselo a `computeMatrixUsage`**: sin el parámetro, toda pieza `converted` se descuenta de los chips, y como el servidor sí la cuenta vía `cycleTotals`, el chip del servidor y el del cliente divergirían en cuanto se editara cualquier cosa. Con el parámetro, una `converted` que **no** está en la lista (se convirtió a otro ciclo, o su requerimiento se anuló) se sigue contando como planificada, para que no desaparezca por los dos lados. Sin el parámetro `computeMatrixUsage` mantiene el comportamiento del bloque 1.
- **`linkedVoidedItemIds`** — piezas convertidas cuyo requerimiento fue anulado o borrado (`?? true`: requerimiento inexistente = anulado). La fila muestra "Requerimiento anulado" y ofrece "Volver a planificar". Se consulta **por ids y sin filtrar por ciclo ni por `approval_status`**: una pieza convertida al ciclo anterior — caso previsto por el diseño — no aparece en `cycleRequirements`, y filtrando por ahí se marcaría como anulada sin serlo.

#### Superficies de seguimiento

- **Editor**: columna de estado en `MatrixItemsTable` (con motivo del bloqueo truncado + texto completo para lector de pantalla), campo **"Anticipación (días)"** en `MatrixHeader` (0–30; un `type="number"` vacío se **descarta** en vez de guardar `lead_days = 0`, que convertiría todas las piezas el mismo día de su entrega) y el contador "N por convertir · N bloqueadas".
- **Lista `/matrices`**: columna "Convertidas" (`converted_count / item_count`) y chip rojo "N bloqueada(s)" junto al estado. Los conteos los calcula `countItemStatuses` en `loadMatricesList` **por lotes de 100 matrices y paginado dentro de cada lote**: PostgREST recorta en `db-max-rows` **sin devolver error**, así que el paginado avanza por el largo **real** de cada página y para cuando una vuelve vacía — cortar en "página más corta que la pedida" daría conteos por debajo de lo real, otra vez en silencio, en cuanto `db-max-rows` fuera menor que `STATUS_PAGE_SIZE`.
- **Notificación `matrix_blocked`** (derivada en `/api/notifications`, solo admin/supervisor, sin tabla): una entrada **por matriz** con piezas `blocked`, con el conteo del grupo y el `blocked_at` más reciente como fecha; nace `read: false` como el resto de los avisos derivados e insiste hasta que alguien destrabe o replanifique. Clic → `/matrices/{id}`. Suma en la campana vía la rama `matrix_blocked` de `unreadCount` en `useNotifications`.
  - **Excluye las matrices `closed`**: es un estado terminal (sin transición de salida y con las escrituras sobre sus piezas rechazadas), así que su aviso nadie podría resolverlo. Las `draft` sí entran: son accionables (aprobar y convertir).
  - Orden `blocked_at desc nulls last, id desc` — el desempate por `id` no es cosmético: el barrido bloquea muchas piezas en la misma transacción y sin él el corte del `limit` sería no determinista. Es el orden que replica el índice de 0130.
  - **"N+" cuando el resultado vino truncado**: se piden `MATRIX_BLOCKED_LIMIT + 1` (501) filas y `partial = raw.length > MATRIX_BLOCKED_LIMIT`; la fila centinela se recorta antes de agrupar. Con `limit(500)` y `>= 500` un resultado **completo** de exactamente 500 filas sería indistinguible de uno truncado y **todos** los grupos saldrían como "N+". Truncado marca los conteos como mínimos porque el orden es global por fecha, no por matriz: cualquier grupo puede tener piezas más allá del corte.
  - El `?? updated_at` al fechar cada fila es un **resto defensivo**: el backfill de 0130 rellena `blocked_at` en las filas viejas, así que en una base migrada no quedan nulos.

#### Fuera de alcance del bloque 2

`needs_production` no dispara nada; sin reintento automático de bloqueadas; el editor abierto no se refresca solo cuando corre el barrido (el sondeo del bloque 3 solo corre mientras hay generación viva); el portal del cliente no ve el brief; no se agrupan piezas en una producción.

### Bloque 3 — asistencia con IA (2026-09)

Un botón **"Generar con IA"** en una matriz en borrador propone los temas del mes y redacta todas las piezas (título, tema, objetivo, copy, guion, estilo visual, hashtags, CTA, producción y estimado) dentro del cupo del plan; "Regenerar" rehace una pieza. Nada llega al pipeline sin la aprobación del bloque 1. Migración `0131_brand_profiles_and_matrix_ai.sql` — **aplicada el 2026-09-20**.

- Spec: `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md` (manda sobre el plan). Plan: `docs/superpowers/plans/2026-09-17-creador-de-matrices-bloque-3.md`.

#### Perfil de marca (la compuerta)

- Tabla `client_brand_profiles` (0131). Dominio puro `src/lib/domain/brand.ts`: `BRAND_TEXT_LIMITS` (tres lados: `maxLength`, acción y checks), `validateBrandPatch` (valida el tipo de cada elemento de los arrays: entrada no confiable) y **`hasUsableBrandProfile`**: hay perfil cuando `tone`, `audience`, `value_proposition` y `offerings` tienen texto (los espacios no cuentan). **Sin perfil usable no se genera**, y se re-evalúa en la acción, en el padre y en el hijo.
- `loadBrandProfile` (`src/lib/data/brand.ts`) lanza ante error y coacciona `sample_copies` a strings en el borde (el check solo garantiza que es array). `updateBrandProfile` (`src/app/actions/brand.ts`): cliente autenticado, `requireManager`, sin `revalidatePath`.
- Tarjeta `ClientBrandProfileCard` en el perfil del cliente, montada como `ClientMatricesCard` (loader en paralelo con `.catch()`, gateo por rol al cargar). El editor de matrices lee el perfil en `matrices/[id]/page.tsx` —**aparte** de `loadMatrixEditorData`, que el padre llama dos veces por corrida y ya lo lee por su cuenta— y pasa `brandReady` (`null` si no se pudo leer: el botón queda deshabilitado con el motivo, el editor no se cae).

#### Los dos jobs

| Job | Qué hace |
|---|---|
| `matrix_generate` (padre) | Planifica temas y reparto, crea las filas de las piezas (título, tipo, tema, objetivo, fecha, responsable, estimado; texto vacío) y encola un hijo por pieza. |
| `matrix_item_write` (hijo) | Redacta **una** pieza (`copy`, `script`, `visual_style`, `hashtags`, `cta`, `objective`, `needs_production`) y marca `ai_written_at`. Es también el job de "Regenerar". |

- **Prioridad 8** en ambos (`MATRIX_JOB_PRIORITY`), por debajo de `whatsapp_template` (4), `whatsapp_reply` (5) e `invoice_due_reminder` (7). Sin prefijo `whatsapp_` (el runner elige el cliente Supabase por ese prefijo). Cada handler se crea su propio `createAdminClient()` **tipado** y lee los ids de `input_json` (`{ matrixId }` / `{ itemId, instructions? }`): `ctx.supabase` no está tipado y `AiJobRow` (escrito a mano) no tiene las columnas nuevas. Todo job lleva `client_id`, `triggered_by` y `content_matrix_id`; el hijo además `content_matrix_item_id` y, si lo encoló el padre, `parent_job_id`.
- **Candados**: los índices únicos parciales de 0131. Se inserta **fila por fila tragando el `23505` por código**, sin pre-chequeo. En el padre, 23505 = "Ya hay una generación en curso para esta matriz."; en el hijo = "esa pieza ya está en cola", **no es un error** (hace idempotente el re-encolado y el doble clic en "Regenerar"). Un hijo **sin** `content_matrix_item_id` escaparía al índice (en btree los nulos no colisionan).
- **"Sin redactar" = `ai_written_at` nulo y el brief vacío**: los cinco campos de texto (`copy`, `script`, `visual_style`, `hashtags`, `cta`, `BRIEF_TEXT_FIELDS`) nulos o de solo espacios. Una sola definición, **`isUnwritten`** (`src/lib/domain/matrix-ai.ts`), que reusan `pendingChildWork`, `generationGate` e `isUnwrittenItem` (el editor). Mirar solo el `copy` hacía que "Generar con IA" reescribiera los guiones (o hashtags, o CTA) que alguien había escrito a mano en piezas sin copy.
- **Idempotencia por invariantes, no "correr una vez"** — lo que hace inofensivo al watchdog de 0124: (a) existen piezas hasta cubrir el cupo faltante y (b) toda pieza sin redactar tiene un hijo. Si (a) está cubierta pero (b) no (el padre murió entre el insert y el encolado), encola los que faltan y termina **sin llamar al modelo** (`reason: 'hijos_reencolados'`). `pendingChildWork` cuenta **cualquier** hijo previo de la pieza —vivo, fallido o completado—: un hijo fallido o truncado **no** se reintenta solo (insistir con el mismo prompt da lo mismo y quema tokens); la salida es "Regenerar".
- **Padre, puntos que no se tuercen**: `loadMatrixEditorData(admin, …)` es la **única** fuente de cupo, distribución, período, `today` y responsables (la misma que pintan los chips). `missingByType` usa `credits` (efectivos), **nunca** `availableCredits`. Bajo pool unificado la IA reparte entre los cuatro tippables y **no genera historias** (`PlanForm` las pone a cero al activar el pool). `sanitizeGeneratedPlan` (`src/lib/domain/matrix-ai.ts`) es el **único filtro** entre el modelo y la base (`validateItemPatch` no está en este camino: el handler escribe con el admin client); bajo pool recorta también el **total**. Los temas se guardan solo si la matriz no tenía: se releen justo antes y el update exige **`topics_json` vacío y `status = 'draft'`** y devuelve la fila (cero filas → no se reporta como escrito): sin el estado, aprobar la matriz mientras el modelo pensaba dejaba escribir temas en una matriz aprobada. El faltante se **recalcula después de la llamada al modelo** y el plan se recorta (entre la foto y el insert el barrido, un registro manual o una solicitud aprobada pudieron consumir cupo: "nunca fuera de plan" es mejor esfuerzo). Fechas con `assignDeadlines` (con `sharedTypes` para el pool, las piezas ya existentes como semilla y `today`); `assigned_to` con los `default_assignee` (sin eso ninguna pieza generada se podría aprobar). Hijos ordenados por `deadline` y `min(5, ceil(hijos/3))` runners con `max=3&wait=0`. Plan vacío tras sanear → `completed` con `reason: 'sin_plan_valido'`.
- **Hijo**: pieza inexistente, matriz inexistente o `closed`, cliente inexistente o sin perfil → `completed` con `{ written: false, skipped: <motivo> }` (**nunca un throw**: quemaría los tres intentos). Una pieza `blocked` **sí** se redacta. **Re-comprueba la pieza antes de llamar al modelo y otra vez justo antes de escribir** (`childWriteSkipReason`, `matrix-ai.ts`), porque un hijo puede esperar minutos al cron o a un rescate del watchdog: `ai_written_at >= created_at` del job → `skipped: 'ya_redactada'` (un intento anterior ya escribió; se compara con `compareTimestamps` de `src/lib/domain/timestamps.ts`, **nunca como strings**: `…Z` de JS frente a `+00:00` con microsegundos de Postgres); hijo **del padre** (`ctx.job.parent_job_id`) sobre una pieza que ya no está sin redactar → `skipped: 'editada_a_mano'`. Un "Regenerar" (sin padre) **sí** sobrescribe: es lo que se pidió. Esos dos motivos (`CHILD_SKIPS_KEEPING_BRIEF`) dejan la pieza con su brief, así que la ruta de progreso los cuenta como **hechos**, no como fallos, y no salen en `failedItems`. Mientras la pieza está en `writingItemIds`, `MatrixItemSheet` bloquea los campos que la IA reescribe (el que se está editando se suelta al salir de él). Escribe **solo** lo que devuelve `sanitizeGeneratedBrief`, que descarta toda clave ajena al brief: una pieza `converted` no puede perder sus cinco campos congelados aunque el modelo los invente. El prompt pide **rangos de trabajo** por campo (`BRIEF_WORKING_RANGES` en `src/lib/ai/matrix/prompts.ts`: copy 200–600, guion de video 600–1500 y de estático/historia 150–500, estilo visual 150–400, hashtags 40–250, CTA 20–120; los topes duros de `MATRIX_TEXT_LIMITS` quedan solo como referencia) para que el peor caso quepa holgado en `max_tokens: 1500` (`prompts.test.ts` lo fija). **Una respuesta truncada** (`stop_reason: 'max_tokens'`, decidido por `briefOutcome`) termina **una sola vez** con `{ written: false, skipped: 'respuesta_truncada' }`: ni escribe un brief a medias (marcaría `ai_written_at` y el padre no la re-encolaría nunca) ni lanza (el runner repetiría el mismo corte dos veces más a precio completo). Un brief vacío **sin** truncar sí lanza.

#### Acciones (`src/app/actions/matrixAi.ts`)

- **`generateMatrix(matrixId)`**: `requireManager`; matriz en `draft`; perfil usable; y la compuerta **`generationGate`** (`matrix-ai.ts`): abre si falta cupo **o** si `pendingChildWork` devuelve alguna pieza (una matriz llenada a mano con piezas sin brief, o un padre que murió antes de encolar). Con el cupo cubierto lee los `matrix_item_write` de la matriz con el admin client. El rechazo dice por qué (todo redactado; lo pendiente ya en cola; o lo pendiente terminó sin texto y sale con "Regenerar"). Encola con el **admin client** (`ai_jobs` no tiene policy de insert).
- **`regenerateItem(itemId, instructions?)`**: instrucciones recortadas y con tope de `MATRIX_INSTRUCTIONS_MAX` (300, `.length`) **en el servidor**; `draft` o `approved`, **nunca `closed`**; perfil usable; 23505 → `{ ok: true, queued: false }`.

#### Runner, modelo y costo

- **`RUNNER_BUDGET_MS = 45_000`** en `runJobs`: antes de reclamar el siguiente job, si se pasó el presupuesto corta y devuelve `stoppedEarly` (la ruta de `ai-jobs/process` lo expone por *spread*). El reloj arranca al entrar, antes del `waitForUpcomingMs`. Sin esto la plataforma mataba la función a media llamada al modelo y el job perdía un intento sin haber fallado. Es solo el corte para **reclamar**: el `maxDuration` de la ruta es **180** para que un job reclamado a los 44,9 s termine (no más: cerca de 300 s el watchdog de 0124 lo reclamaría dos veces).
- **Zombis agotados**: un `matrix_generate` o `matrix_item_write` que muere `processing` en su último intento ya no lo rescata el watchdog de 0124 (exige `attempts < max_attempts`), y como los índices únicos de 0131 cubren `processing`, dejaba "Planificando…"/"Ya hay una generación en curso" o "Redactando…" para siempre ("Regenerar" chocaba con el 23505 en silencio). `sweepExhaustedZombies` (`src/lib/ai/zombies.ts`) los marca `failed` al arrancar cada corrida del runner — `locked_at` de más de 10 min, `attempts >= max_attempts` —; el editor los muestra entonces como fallo del padre o de la pieza y vuelve a dejar generar.
- **Efecto del watchdog sobre el orden**: registrar los dos tipos cambia `KNOWN_JOB_TYPES` (`p_job_types` de `claim_ai_job`), y el watchdog de 0124 ordena `(status = 'processing') desc` **antes** que `priority`: un `matrix_generate` colgado se rescata antes que un `whatsapp_reply` recién encolado, incluso en el disparo de baja latencia del webhook. La prioridad 8 no protege de eso. El arreglo (no rescatar colgados con `waitForUpcomingMs > 0`) queda fuera de alcance; anotado en `runner.ts`.
- Modelo en `src/lib/ai/matrix/model.ts`: **`ANTHROPIC_MATRIX_MODEL`** `|| 'claude-sonnet-4-6'` — variable **propia**: `ANTHROPIC_MODEL` es la del bot de WhatsApp y cambiarla no debe alterar las matrices. Padre `max_tokens 4000`/`temperature 0.7`, hijo `1500`/`0.8`. Sin `ANTHROPIC_API_KEY` el handler lanza (queda en `WaBotFailedJobs`).
- **Costo acumulado, no sobrescrito** (`accumulateJobCost`, `src/lib/ai/matrix/cost.ts`): `coalesce(actual, 0) + nuevo` en `cost_usd_cents` y `tokens_*`, porque un job rescatado por el watchdog paga dos llamadas. Misma fórmula que `whatsappReply.ts` (`/1_000_000`, `Math.ceil(usd * 100)`, **sin** el `*100` de la 0123); no lee `cache_creation_input_tokens` (~1.25× por debajo). **Un costo que no se pudo registrar deja rastro**: error del update, cero filas afectadas (el `on delete cascade` de 0131 se lleva la fila del job si se borra la pieza o la matriz a media llamada) o error de la lectura previa → `console.error`, sin lanzar.

#### Progreso en vivo (`GET /api/matrices/[id]/generation?since=<ISO>`)

- Route handler y no server action (el sondeo necesita `AbortSignal`). **Sesión normal: NO va en `SECRET_AUTH_API_PREFIXES`** (esos son los crons). Re-valida admin/supervisor; lee `ai_jobs` con el **admin client** (su única policy de `select` es `is_admin()`, un supervisor no pasa) y las tablas de matrices con el de sesión.
- **Solo el padre más reciente** decide `phase` (`planning`/`writing`/`idle`/`failed`), `error` y `reason`; los contadores `total`/`done`/`failed` son de **sus** hijos (un hijo `completed` sin escribir cuenta como fallido); los `matrix_item_write` sueltos de "Regenerar" solo alimentan `writingItemIds`. Además: `itemJobs` (el **último** hijo de cada pieza: la entrada de `generationGate`), `failedItems` (piezas cuyo último hijo falló o terminó sin escribir, con el `skipped` o el `error_text`), `topics` + `matrixUpdatedAt`, `items` con `updated_at > since` y **`watermark`**. La forma (`GenerationProgress`) vive en `src/lib/domain/matrix-generation.ts`.
- **`watermark` la calcula el servidor** (el `updated_at` de la última fila devuelta, o el `since` recibido) y el cliente la devuelve **tal cual**: el padre inserta todas las piezas en una sentencia (comparten `updated_at`) y un `since` del reloj del navegador perdería el lote entero. El `since` se valida con un ISO-8601 estricto.
- **Un error al leer `ai_jobs` es un 500, nunca se traga**: con `data` nulo la respuesta saldría `idle`, indistinguible de "terminado", y el sondeo se apagaría. El cliente conserva su último estado y reintenta.

#### El editor: sondeo y fusión

- `useMatrixGeneration` (`src/hooks/`), con la forma de `useNotifications`: una consulta **al montar** en toda matriz no cerrada (auto-reparable: "cerré la pestaña a media generación y volví") y sondeo cada 3 s mientras **`isGenerationLive`** — padre planificando **o** `writingItemIds` no vacío; **nunca `phase` sola** (un "Regenerar" tras un padre fallido corre con `phase: 'failed'`, y `writing` puede venir con `total: 0`). `AbortController`, pausa con la pestaña oculta, 500/red → espera creciente (tope 30 s), 4xx → se apaga. La marca de agua se siembra con el `updated_at` máximo de las filas del render, viaja con `encodeURIComponent` (el `+00:00` llegaría como espacio y la ruta devolvería la matriz entera) y se conserva si no vinieron filas. Al terminar una generación vista viva, **una** consulta sin `since` asienta la carrera de la marca de agua con hijos en paralelo.
- **Regla de fusión** (`src/lib/domain/matrix-generation.ts`, con tests), sobre la máquina de estados del bloque 1 sin debilitarla:
  - `beginFieldSave` lleva un **contador por campo en vuelo** (+1 al empezar, −1 en un `finally`). `latestSeqByField` no sirve: guarda lo *iniciado* y nunca se limpia. Un campo en vuelo o con borrador fallido no se toca en pantalla (`MatrixItemSheet.commitText` suelta el borrador local **antes** de que llegue la respuesta: sin la regla, el sondeo revertiría lo recién escrito).
  - Cada cambio local (guardado, "Convertir ahora"/"Volver a planificar", cambio de temas) marca el campo con una secuencia; una respuesta **enviada antes** no toca ese campo ni en pantalla ni en la fila confirmada. Es lo que protege "Convertir ahora", que no devuelve la fila.
  - **Lápidas**: una pieza borrada en el editor no resucita con un sondeo en vuelo; si el borrado falla y se revierte, la lápida se quita.
  - **Toda fila aceptada va a `confirmedItems`** (el destino del rollback) y **nunca retrocede**: con una fila más vieja que la confirmada, manda la confirmada. Sin esto, un fallo posterior no revertiría nada (pieza nueva) o revertiría en pantalla el texto de la IA (fila vieja).
  - **Los temas** del sondeo van a `matrix` **y** a `confirmedMatrix` (con `matrixUpdatedAt` contra la versión confirmada). Sin esto la barra seguiría con la lista vieja y el siguiente cambio de temas mandaría a `updateMatrix` una lista **sin** los de la IA: el servidor los borraría y soltaría el `topic` de todas las piezas generadas. Mientras un guardado de temas vuela, el `topic` de toda pieza espera.
  - `addItem`/`duplicateItem` no duplican una pieza que el sondeo trajo antes. "Descartar cambios sin guardar" y cerrar la matriz devuelven los campos descartados a la versión confirmada (que pudo avanzar con la IA).
- **UI**: "Generar con IA" solo en borrador, **deshabilitado con el motivo a la vista** (`aria-describedby`, enlace "Completar el perfil de marca" si falta). El motivo sale de `generateBlockReason`, que recorre lo mismo que la acción y en el mismo orden: perfil → **`generationGate` —la misma función, alimentada con `itemJobs`—** → padre vivo (el mismo texto que el 23505); nada de copiar la regla en el cliente. `MatrixGenerationStrip`: "Planificando…", "Generando… N de M" (nunca "0 de 0"), el aviso de pool, el fallo del padre en rojo (en borrador), y el resumen o el motivo del final solo si esta pestaña vio la generación. Por pieza: "Redactando…", "No se pudo redactar" con su motivo o "Sin redactar", con "Regenerar" (solo con perfil usable y matriz no cerrada; a una pieza con texto solo se le marca el fallo si se regeneró en esta pestaña, para no ofrecer pisar lo que alguien completó a mano). Panel lateral: "Redactar con IA" con instrucciones (300, contador) y el motivo si está deshabilitado. Los motivos (`sin_plan_valido`, `respuesta_truncada`, …) pasan por `generationReasonLabel`: un slug sin mapear cae en un mensaje genérico, **nunca** en el slug crudo.

#### Fuera de alcance del bloque 3

Sin tope de gasto ni pantalla de consumo de IA fuera de WhatsApp (el costo queda por job en `ai_jobs`); no hay "regenerar todo"; no genera imágenes, no publica, no elige fechas (las pone `proposeDeadline`), no escribe en matrices cerradas ni expone nada al portal.
