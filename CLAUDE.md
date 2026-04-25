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

clients.max_cambios        — límite de cambios por requerimiento (default 2)
requirements.title         — requerido en UI, DEFAULT '' en DB (legacy rows ok)
requirements.cambios_count — contador, sin decremento por diseño
requirements.phase         — fase actual en pipeline (12 valores posibles)
requirements.review_started_at — timestamp al entrar a revision_cliente
requirement_messages.visible_to_client — true = visible en el portal del cliente
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
| `requirement-attachments` | Público | `upload-req-attachment.ts` |
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
- Edge Function `daily-cycle-runner` (cron `0 6 * * *`) maneja auto-billing y cierre de ciclos

## Calendario
- `CalendarPageClient` (interno): MutationObserver para dark mode, DnD habilitado, rich event cards
- `PortalCalendarioClient` (cliente): read-only, misma clase `calendar-wrapper` para CSS dark mode
- Colores de eventos: `KIND_COLORS` (light) / `KIND_COLORS_DARK` (dark) — ambos en `calendar.ts`
- El wrapper debe tener clase `calendar-wrapper` para que apliquen los estilos dark de `globals.css`

## Patrones UI
- Colores primarios: teal `#00675c` / rojo `#b31b25` / gris `#595c5e`
- CSS classes: `glass-panel`, `fm-primary`, `fm-on-surface`, `fm-surface-container-*`, etc. — todas en Tailwind como custom tokens
- Dark mode: clase `dark` en `<html>` gestionada por `next-themes` via `ThemeProvider`
- CSS class `glass-panel` definida en `globals.css`
- Admin check: `supabase.from('users').select('role').eq('id', user.id).single()` → `role === 'admin'`
- Todo el texto UI y los mensajes de error van en **español**
- Commits en español: `feat:`, `fix:`, `docs:`, `chore:`
- Material Symbols (iconos): `<span className="material-symbols-outlined">icon_name</span>`

## Migraciones aplicadas (0001–0058)
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
