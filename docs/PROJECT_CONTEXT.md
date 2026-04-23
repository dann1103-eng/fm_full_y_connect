# FM CRM — Project Context

**Última actualización:** 2026-04-23 · commit `97801ac`
**Rama activa:** `qa-reports-logo-upload` (features en curso)

CRM interno para **FM Communication Solutions**. Gestiona clientes, planes, ciclos de facturación, requerimientos de contenido, pipeline de producción, revisiones, facturación, tiempo, renovaciones, chat interno y calendario de operaciones.

---

## 1. Stack

- **Next.js 16.2.4** (App Router con Turbopack) · **React 19.2.4** · **TypeScript**
- **Tailwind v4** (`@import "tailwindcss"`, `@theme`, `@layer utilities`) · **shadcn/ui** · **@base-ui/react** 1.4.0
- **Supabase** (Postgres + Auth + Storage + Realtime) — proyecto `witcgfylutplgfxvzoab`
  - `@supabase/ssr` 0.10.2 · `@supabase/supabase-js` 2.103.3
- **@dnd-kit/core** 6.3.1 — DnD del pipeline
- **react-big-calendar** 1.19.4 + `withDragAndDrop` — calendario
- **@react-pdf/renderer** 4.5.1 — generación de PDFs (facturas, reportes)
- **date-fns 4.1.0** (timezone-safe), **next-themes** 0.4.6, **@paper-design/shaders-react** (fondo login)
- **Vitest v2** (42 tests)
- **ESLint 9** con reglas React 19 estrictas

> **OJO:** Next.js 16 tiene breaking changes frente a versiones previas. Antes de escribir código nuevo consultar `node_modules/next/dist/docs/`. `AGENTS.md` en la raíz lo enfatiza.

### Scripts
```bash
npm run dev          # localhost:3000 (Turbopack)
npm run lint         # eslint — baseline: 9 errores pre-existentes react-hooks/set-state-in-effect
npm run build        # verificación final (types + build)
npm run test         # vitest
```

---

## 2. Estructura de rutas (`src/app/`)

### `(auth)/login/` — pantalla de login con shader Warp.

### `(app)/` — layout con sidebar; requiere sesión. Páginas:

| Ruta | Descripción |
|---|---|
| `dashboard/` | Panel principal — tarjetas por cliente con progreso de ciclo (respeta override). |
| `clients/` · `clients/[id]/` · `clients/[id]/edit/` · `clients/[id]/report/` | CRUD de clientes, pestañas (detalles, pipeline, revisión, chat, PDF report). |
| `pipeline/` | Kanban global multi-cliente con DnD. |
| `plans/` | Catálogo de planes (límites por tipo de contenido). |
| `calendario/` | Calendario RBC — personal + general (admin/supervisor). |
| `inbox/[conversationId]/` | Chat interno por DM/grupo. |
| `tiempo/` | Time entries (administrativo + producción). |
| `reports/` | Timesheet, productividad, etc. |
| `renewals/` | Panel de ciclos por vencer. |
| `billing/invoices/` · `billing/quotes/` · `billing/settings/` | Módulo de facturación con PDF. |
| `users/` | Gestión de usuarios (admin). |
| `profile/` | Perfil, avatar, prefs. |

---

## 3. Server Actions (`src/app/actions/`)

| Archivo | Responsable de |
|---|---|
| `agencySettings.ts` | Ajustes de agencia (datos fiscales, etc.). |
| `calendar.ts` | `rescheduleEvent` (DnD), `createInternalMeeting`, validación de conflictos de horario. |
| `company-settings.ts` | Company-level config. |
| `content-review.ts` | Subir versiones, firmar URLs, eliminar versiones, marcar pines. |
| `contentPackage.ts` | Asignación/reorganización de content packages. |
| `deleteClient.ts` | Cascade delete en orden (`logs → reqs → cycles → client`). |
| `fetchRequirementCycleStats.ts` · `fetchTimesheet.ts` | Lectura agregada para dashboard y reports. |
| `inbox.ts` · `requirement-messages.ts` | Mensajería interna (DMs, grupos, mensajes por requerimiento). |
| `invoices.ts` · `quotes.ts` | CRUD de facturas/cotizaciones + PDF. |
| `plans.ts` | CRUD de planes. |
| `profile.ts` | Avatar + datos personales. |
| `renewals.ts` | Cerrar/abrir ciclos, rollover. |
| `time.ts` | Time entries (admin/prod/reuniones). |
| `updateUserDefaultAssignee.ts` · `updateUserRole.ts` · `users.ts` | Admin de usuarios. |

---

## 4. Domain logic (`src/lib/domain/`)

| Módulo | Propósito |
|---|---|
| `calendar.ts` | `requirementToCalendarEvent`, `timeEntryToCalendarEvent`, `isScheduledKind`. Un evento "scheduled" tiene hora (`reunion`, `produccion`, `reunion_interna`); `arte` solo deadline. |
| `content-icons.ts` | Mapa tipo → ícono. |
| `cycles.ts` (+ test) | Cálculo de ciclo actual, rollover previo. |
| `dates.ts` (+ test) | Helpers timezone-safe (date-fns). |
| `deadline.ts` | Lógica de deadline + overdue. |
| `invoices.ts` | Totales, impuestos, IVA. |
| `permissions.ts` | Roles: `admin`, `supervisor`, `operator`, `client`. |
| `phaseTimer.ts` | Cronómetro por fase del pipeline. |
| `pipeline.ts` | `PipelineItem` interface + `migrateOpenPipelineItems`. Fuente de verdad del pipeline. |
| `plans.ts` | `limitsToRecord`, `effectiveLimits`, `applyContentLimitsWithOverride`, `CONTENT_TYPE_LABELS`. |
| `requirement.ts` · `requirementCycle.ts` | Reglas de requerimiento y su ciclo. |
| `social.ts` | Plataformas sociales. |
| `time.ts` · `timesheet.ts` | Agregaciones de tiempo. |
| `weekly-distribution.ts` (+ test) | Distribución semanal de contenido. |

---

## 5. Hooks (`src/hooks/`)

- **`useCalendarEvents.ts`** — Carga eventos (requirements + time entries) del rango visible. Expone `refetch()` que bumpea un `refetchKey` state usado como dep del effect. **Crítico**: el DnD del calendario depende de este refetch porque `revalidatePath` server-side no sincroniza el estado local.
- **`useInboxPolling.ts`** — Fallback de polling cuando Realtime falla.
- **`useNotifications.ts`** + **`useNotificationToasts.ts`** — Notificaciones globales (sonido único, dedupe de toasts al refrescar).

---

## 6. Módulo Calendario — lecciones aprendidas

**Archivos**: `src/app/(app)/calendario/page.tsx`, `CalendarPageClient.tsx`, `NewInternalEventModal.tsx`, `src/hooks/useCalendarEvents.ts`, `src/app/actions/calendar.ts`, migración `0051_calendar_events.sql`.

**Aspectos críticos**:

1. **DnD solo para eventos con hora** — `draggableAccessor={(e) => isPrivileged && isScheduledKind(e.kind)}`. Arte (sólo deadline) no se arrastra.
2. **Imágenes dentro de eventos bloqueaban el DnD nativo** — `<img>` dispara HTML5 drag antes que el handler de RBC. Solución en `globals.css`:
   ```css
   .calendar-wrapper .rbc-event img {
     -webkit-user-drag: none;
     user-select: none;
     pointer-events: none;
   }
   ```
3. **Persistencia post-drop** — `rescheduleEvent` hace `revalidatePath('/calendario')` pero el hook tiene estado local. Llamar `refetch()` dentro de `handleEventDrop` tras éxito.
4. **CSS `@layer utilities` pierde especificidad** contra el CSS sin capa de RBC. Usar `!important` en los overrides de `.rbc-month-row`, `.rbc-timeslot-group`, etc.
5. **Rango horario 6am–6pm** — props `min={workDayMin}`, `max={workDayMax}`, `scrollToTime`.
6. **No hay forma de verificar DnD con eventos sintéticos** — RBC usa listeners `mousedown`/`mousemove` a nivel `document` (`Selection.js`). Pruebas reales con mouse.
7. **Conflictos de horario** — `calendar.ts` rechaza reuniones/producciones con overlap de usuarios asignados en la misma fecha/hora.

---

## 7. Módulo Revisión

- Bucket: `review-files` (privado).
- Extensión correcta en descarga: **extraer ext de `storage_path` y componer `baseName.ext`** antes de `createSignedUrl({ download })`. Sin esto el browser genera archivos `.nov` aleatorios.
- Multi-archivo por versión (`review_version_files`), pines con menciones, realtime via Supabase channels.

---

## 8. Supabase — dos clientes

```ts
// Server (components / actions):
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()   // async

// 'use client':
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()          // sync
```

---

## 9. Migraciones (51 totales)

Relevantes recientes:

| # | Contenido |
|---|---|
| 0044 | `content_review` (assets, versions, pins). |
| 0045 | Bucket `review-files`. |
| 0047 | Menciones en comentarios de pines. |
| 0048 | Módulo de facturación (invoices, quotes, settings). |
| 0049 | Versiones multi-archivo (`review_version_files`). |
| 0050 | `inbox_realtime` — publicación de mensajes. |
| 0051 | `calendar_events` — `time_entries.scheduled_at`, `scheduled_attendees`, `scheduled_duration_minutes`. |

Aplicar manualmente en Supabase Dashboard.

---

## 10. Reglas ESLint que muerden

- **`react-hooks/purity`** — prohibido `Date.now()` dentro de render/hooks; usar `new Date().getTime()`.
- **`react-hooks/set-state-in-effect`** — no `setState` síncrono en el cuerpo de `useEffect`. Derivado → `useMemo`. Async → `setState` solo en `.then()`/callbacks.
- `redirect()` de `next/navigation` lanza — siempre última línea en Server Actions.
- **Baseline actual**: 9 errores pre-existentes de `react-hooks/set-state-in-effect` distribuidos entre componentes legacy. **No introducir nuevos**.

---

## 11. Roles / RLS

Roles en tabla `users.role`: `admin`, `supervisor`, `operator`, `client`. RLS habilitado en todas las tablas. Calendario personal visible para todos; general sólo admin/supervisor.

---

## 12. UI — convenciones

- Paleta: teal `#00675c`, rojo `#b31b25`, gris `#595c5e`, borde `#dfe3e6`, fondo `#f5f7f9`.
- `glass-panel` definido en `globals.css`.
- Todo el texto UI y los mensajes de error en **español**. Commits en español: `feat:`, `fix:`, `docs:`, `perf:`.

---

## 13. Commits recientes (últimos 10)

```
97801ac fix: DnD del calendario ya persiste la nueva hora en la UI
160a727 fix: descarga de revisión conserva la extensión del archivo original
41c1566 fix: calendario 6am-6pm + fix DnD (native image-drag bloqueaba RBC)
295fbdc fix: DnD calendario, tamaño de slots, vistas limitadas y override dashboard
507d5c6 fix: mejoras de UX — calendario, /tiempo, renovaciones, revisión, emojis y chat
1b3d117 feat: pestaña de calendario con eventos de requerimientos y reuniones
141a5f2 docs: actualizar contexto del proyecto para nuevas sesiones
8e6c91d feat: versiones multi-archivo en revisión, hover en pines y DMs en tiempo real
a936147 fix: override de plan, modo oscuro en chat flotante y tab de revisión
bf2d5a3 fix: burbuja de chat más compacta, mensajes en tiempo real y toast más confiable
```

---

## 14. Verificación local

- **Login dev**: `danielmancia111203@gmail.com` / `usuario123`.
- **Supabase DNS** intermitente desde esta red — reintentar si `ENOTFOUND witcgfylutplgfxvzoab.supabase.co`.
- **HMR dep-size error** al cambiar número de deps en un `useEffect` — reiniciar `npm run dev`.
- **DnD del calendario** no se puede verificar con MouseEvent sintéticos; requiere prueba manual.

---

## 15. Pendientes / próximas mejoras

- Normalizar los 9 errores de `react-hooks/set-state-in-effect` pre-existentes.
- Consolidar patrón `refetch` en hooks que dependan de Server Actions con `revalidatePath`.
- Verificación automatizada del DnD (posiblemente vía Playwright con mouse real).
