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

## Migraciones aplicadas (0001–0124)
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
- `src/app/api/ai-jobs/process/route.ts` — endpoint POST/GET autenticado por `CRON_SECRET` (Vercel Cron header) o `AI_JOBS_TRIGGER_SECRET` (trigger interno desde webhook + server actions).
- `vercel.json` — cron cada minuto a `/api/ai-jobs/process?max=10&wait=15000` como fallback de procesamiento.
- Webhook WhatsApp y `enqueueReviewReadyNotification` disparan el runner con fire-and-forget tras encolar (low-latency).
- Handlers registrados en `src/lib/ai/runner.ts`: `whatsapp_reply`, `whatsapp_template`.
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
- `CRON_SECRET` — Bearer que Vercel Cron envía automáticamente al endpoint.
- `AI_JOBS_TRIGGER_SECRET` — header `x-trigger-secret` para invocaciones internas (webhook → runner, server action → runner).

### Convención de números
- Internamente: `phone_e164` (con `+`).
- A Meta Graph API: sin `+` (helper `sendWhatsappText` y `sendWhatsappTemplate` lo strip).
- URL canónica de webhook: `https://www.fullefm.site/api/whatsapp/webhook` (con `www`). Meta NO sigue redirects; el dominio raíz `fullefm.site` redirige a `www`.

### Trazabilidad de costos
- `ai_jobs.cost_usd_cents` calculado por handler según pricing Sonnet 4.6 ($3/M in, $15/M out, $0.30/M cache). Fórmula en `whatsappReply.ts` usa constantes `USD_PER_MTOK_*` y `/1_000_000` → céntimos enteros. **NO agregar un `*100` extra**: la conversión USD→céntimos ya está incluida (bug histórico corregido en migración 0123).
- `WaBotUsageStats` (src/components/whatsapp/) — tarjetas mes actual/anterior + tabla por cliente. Muestra dólares con `cost_usd_cents / 100` (conversión céntimos→dólares correcta; NO tocar). TZ America/El_Salvador para corte mensual.
