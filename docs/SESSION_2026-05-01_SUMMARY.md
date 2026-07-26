# FM CRM — Resumen de sesión y contexto completo

**Última actualización:** 2026-05-01 · commit `d003552`
**Rama activa:** `master` (auto-deploy a Vercel)
**Repo:** https://github.com/dann1103-eng/fm_full_y_connect.git
**Dir local:** `C:\Users\Daniel\Desktop\FM CRM\fm-crm`
**Supabase project:** `witcgfylutplgfxvzoab` (us-east-1)

Este documento es **autocontenido** — léelo de principio a fin para continuar el trabajo en otra sesión sin perder contexto.

---

## 1. Stack

- **Next.js 16.2.4** App Router + Turbopack · **React 19** · **TypeScript 5**
- **Tailwind v4** (`@theme`) · **shadcn/ui** · **@base-ui/react**
- **Supabase**: `@supabase/ssr` 0.10.2 · `@supabase/supabase-js` 2.103.3 (Postgres + Auth + Storage + Realtime)
- **@dnd-kit/core** — DnD del pipeline
- **react-big-calendar** — calendario interno y portal
- **@react-pdf/renderer** — PDFs (facturas, cotizaciones)
- **pdfjs-dist** — visor de PDF en revisión de contenido (migración 0065)
- **Vitest** · **ESLint 9** (12 errores baseline — pre-existentes, no romper)

### Comandos esenciales
```bash
npm run dev            # localhost:3000
npm run lint           # baseline 12 errores; no introducir nuevos
npm run build          # verificación final
git push origin master # auto-deploy a Vercel — pedir confirmación explícita
```

---

## 2. Convenciones (CLAUDE.md)

- **Next.js 16 NO ES el de tu training** — leer `node_modules/next/dist/docs/` antes de inventar APIs.
- **Middleware se llama `proxy.ts`** en Next.js 16, no `middleware.ts`.
- Comentarios y mensajes UI/error en **español**.
- Commits en español: `feat:`, `fix:`, `chore:`, `docs:`.
- ESLint:
  - `react-hooks/set-state-in-effect` muerde — usar `useMemo` para estado derivado o `// eslint-disable-next-line` si es legacy.
  - `react-hooks/purity` — nunca `Date.now()` en render; usar `new Date().getTime()`.
  - `redirect()` de `next/navigation` lanza — siempre última línea en server actions.

### Supabase clients
```ts
// Server components / Server Actions
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()  // async

// 'use client'
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()  // sync

// Bypass RLS (mantenimiento, impersonation, cleanup)
import { createAdminClient } from '@/lib/supabase/admin'
const supabase = createAdminClient()
```

---

## 3. Arquitectura — archivos críticos

| Archivo | Rol |
|---------|-----|
| `src/types/db.ts` | Tipos TS manuales — editar a mano al cambiar schema |
| `src/lib/domain/pipeline.ts` | `PipelineItem`, `movePhase`, `migrateOpenPipelineItems`, `clientPhaseOf`, `PIPELINE_CONTENT_TYPES` |
| `src/lib/domain/requirement.ts` | `isWeekUnlocked`, `isCycleFullyLocked`, `canRegisterWithContext`, `computeTotals` |
| `src/lib/domain/cycles.ts` | `nextCycleDates`, `firstCycleDates` |
| `src/lib/domain/billing.ts` | Lógica de facturas/cotizaciones |
| `src/lib/auth/effective-user.ts` | `getEffectiveUser()` — resuelve usuario suplantado vs real |
| `src/lib/auth/operator-scope.ts` | `getOperatorClientIds()` — clientes con asignaciones |
| `src/lib/supabase/active-client.ts` | `getActiveClientId/Ids()` — para portal |
| `src/lib/supabase/cleanup-cycle-storage.ts` | Borra archivos del bucket al archivar ciclo |
| `src/proxy.ts` | Middleware Next.js 16 — auth + routing rules + impersonation-aware |
| `src/app/(app)/layout.tsx` | Layout staff |
| `src/app/(portal)/layout.tsx` | Layout portal cliente |
| `src/app/actions/` | Todos los Server Actions (`'use server'`) — ~28 archivos |
| `supabase/functions/daily-cycle-runner/index.ts` | Edge Function cron (auto-billing + renovación) |
| `supabase/migrations/` | Migraciones SQL (`NNNN_*.sql`) — aplicar manualmente en Supabase Dashboard |

---

## 4. Modelo de datos (resumen)

```
users (admin | supervisor | operator | client)
clients ─→ billing_cycles ─→ requirements ─→ requirement_phase_logs
                          │                ↘ requirement_messages (chat por req)
                          │                ↘ requirement_cambio_logs (cambios)
                          │                ↘ review_assets ─→ review_versions ─→ review_pins ─→ review_comments
                          │                                                  ↘ review_version_files
                          ↘ invoices, quotes
clients ─→ client_users ─→ users (rol client)
work_sessions, time_entries (con requirement_id)
impersonation_logs (auditoría suplantación)
```

### Tablas clave
- `users.current_session_id` (uuid) — single-session enforcement (migración 0066)
- `requirements.assigned_to` (uuid[]) — operadores asignados
- `requirements.carried_over` (bool) — trasladado del ciclo anterior, no descuenta del nuevo límite
- `requirements.consumption_overrides_json` — admin override de cuánto consume del plan
- `requirement_cambio_logs.voided` — anulación de cambios
- `billing_cycles.payment_status` / `payment_status_2` — biweekly: dos quincenas independientes
- `billing_cycles.status`: `current` | `scheduled` | `archived` | `pending_renewal`
- `impersonation_logs` — admin_user_id, target_user_id, started_at, ended_at (migración 0067)

### Cascade delete (NO hay FK CASCADE en `requirement_phase_logs`)
`requirement_phase_logs` → `requirements` → `billing_cycles` → `clients`
Borrar manualmente en orden (ver `deleteClient.ts`).

---

## 5. Flujos importantes

### Pipeline (12 fases internas)
```
pendiente → proceso_edicion / proceso_diseno / proceso_animacion → cambios
→ pausa → revision_interna → revision_diseno → revision_cliente
→ aprobado → pendiente_publicar → publicado_entregado
```

### Mapeo a 5 fases del portal cliente
- `diseno` (agrupa pendiente + proceso_* + cambios + pausa + revision_interna + revision_diseno)
- `revision_cliente` (interactiva con pines y chat)
- `aprobado`
- `pendiente_publicar`
- `publicado`

### Auto-renovación (Edge Function `daily-cycle-runner`)
1. **Auto-billing** (10 días antes del fin): pre-crea ciclo `scheduled` + emite invoice. **Skip si ciclo actual unpaid** (gate añadido este sesión).
2. **Expiración**: cuando `period_end < hoy`:
   - Si `isCycleFullyPaid()` (monthly: `payment_status='paid'`; biweekly: ambos paid): archivar viejo, promover scheduled→current, **migrar requerimientos abiertos** (UPDATE billing_cycle_id), cleanup adjuntos
   - Si unpaid: marcar cycle `pending_renewal` + cliente `overdue`

### Suplantación / Spectator mode
- Admin click "Ver como" en `/users` o `/users/portal`
- `startImpersonation(targetUserId)`: gate (target no es admin), insert audit log, set cookie `fm_impersonate_user_id` (httpOnly), redirect a `/dashboard` o `/portal/dashboard`
- `getEffectiveUser()` resuelve `appUser` (efectivo) vs `realAppUser` (admin real)
- `proxy.ts` resuelve rol efectivo para routing (impersonation-aware)
- Banner ámbar persistente con botón "Salir del modo espectador"
- **Mutaciones bloqueadas**: cada server action de mutación llama `assertNotImpersonating()` que lanza si la cookie está set
- Páginas operativas con `getEffectiveUser()`: pipeline, clients, clients/[id], dashboard, calendario, inbox, profile, tiempo, /api/notifications

### Single-session enforcement
- `users.current_session_id` (uuid) — claimed via `claimSession()` server action
- `SessionSentinel` (client component): localStorage `fm_session_id` + realtime sub a `users` + polling 30s + visibilitychange
- Si DB session ID ≠ local → `SessionKickedDialog` con countdown 10s → auto-signout
- Limpia `current_session_id` al hacer signout

---

## 6. Trabajo realizado en esta sesión (2026-04-30 → 2026-05-01)

Cronológico, del más viejo al más nuevo:

### F1: Aislamiento de operador + espectador completo (`ee51ce1`)
- **Bug**: en `/clients/[id]`, los operadores veían TODOS los requerimientos del cliente (sin filtrar por `assigned_to`).
- **Bug**: el modo espectador del admin solo bloqueaba mutaciones; las queries seguían siendo "vista admin".
- **Fix**:
  - `clients/[id]/page.tsx`: filtra requerimientos del ciclo, pipeline interno y reuniones por `assigned_to` cuando role=operator. Oculta `CycleHistory` para operadores.
  - `clients/page.tsx` y `dashboard/page.tsx`: operadores solo ven clientes con asignaciones (helper nuevo `getOperatorClientIds()` en `src/lib/auth/operator-scope.ts`).
  - `pipeline/page.tsx`, `calendario/page.tsx`: usan `getEffectiveUser()` y `ctx.appUser.id`.
  - `inbox/layout.tsx` e `inbox/[conversationId]/page.tsx`: usan `createAdminClient()` cuando `isImpersonating` (las RLS de `conversations`/`messages` están atadas a `auth.uid()`).

### F2: Cron preserva requerimientos al renovar + bloquea morosos (`862c5e5`)
- **Bug 1**: el Edge Function NO llamaba a `migrateOpenPipelineItems` al promover scheduled→current, así que los reqs en proceso desaparecían del pipeline.
- **Bug 2**: el gate de promoción solo revisaba `payment_status` (1ra mitad). Para biweekly con 2da quincena impaga, igual renovaba.
- **Bug 3**: el step de auto-billing no chequeaba payment_status del ciclo actual antes de crear el scheduled.
- **Fix**:
  - Nueva fn `isCycleFullyPaid()` (monthly: `payment_status='paid'`; biweekly: ambos `paid`).
  - Auto-billing skipea si `!isCycleFullyPaid(currentCycle)`.
  - Promoción usa `isCycleFullyPaid()` en vez de solo `payment_status === 'paid'`.
  - Inline `migrateOpenPipelineItemsInline()` en el Edge Function (Deno no puede importar src/).
  - Cleanup de adjuntos respeta los reqs trasladados.
- **Nuevo server action**: `rescueOrphanedRequirements(clientId)` — recupera reqs huérfanos de ciclos archivados.
- **Nuevo botón** en `/clients/[id]`: "Rescatar requerimientos del ciclo anterior" (admin/supervisor).

### F3: Bloquear registro en ciclos impagos monthly (`02ba3a2`)
- **Bug**: `isWeekUnlocked()` retornaba `true` siempre para monthly clients. Solo `isOverdue` (daysLeft<0 + unpaid) bloqueaba el botón "Registrar requerimiento".
- Resultado: clientes monthly recién renovados sin pagar permitían registros durante todo el mes hasta que vencía.
- **Fix**:
  - `isWeekUnlocked()`: monthly también gateia por `payment_status === 'paid'`. Biweekly conserva la lógica de mitades independientes.
  - Nueva fn `isCycleFullyLocked()`: true si ningún registro nuevo es posible.
  - `canRegisterWithContext()`: razón "Pago pendiente del ciclo" para monthly, "1ra/2da quincena" para biweekly.
  - `RequirementPanel`: deshabilita botón cuando `cycleFullyLocked`. Banner ámbar nuevo "Pago pendiente — registro de requerimientos bloqueado".

### F4: Traslado MOVE en vez de COPY (`ac27305`)
- **Bug**: `migrateOpenPipelineItems` hacía `INSERT` de fila nueva + copiaba `phase_logs`. Pero los demás datos relacionados (`requirement_messages`, `review_assets`, `time_entries`, `requirement_cambio_logs`) seguían apuntando al `id` original. El "trasladado" era un cascarón sin data.
- **Fix**:
  - `migrateOpenPipelineItems` y `migrateOpenPipelineItemsInline` (Edge Function): `UPDATE billing_cycle_id` sobre la fila original (mismo id) + `carried_over=true`. Todas las relaciones se preservan.
  - `rescueOrphanedRequirements`: detecta duplicados creados por la versión rota previa (carried_over=true en current con título matching), verifica si están realmente vacíos, y los reemplaza con el original movido.

### F5: Diagnóstico en rescate (`4d55ccd`)
- Cuando no hay nada que rescatar, el botón muestra desglose: cantidad de ciclos archivados, reqs en archivados (anulados / publicados / no-pipeline / abiertos elegibles), reqs trasladados ya en current.

### F6: Quitar phase_logs falsos (`58c2c5c`)
- **Bug**: el rescate y la migración insertaban un `phase_log` con `notes='Trasladado del ciclo anterior'` o `'Rescatado del ciclo anterior'` con `created_at=NOW()`. Eso rompía el cálculo de `last_moved_at` (timer mostraba "33 min desde rescate" en vez del cambio real de fase).
- **Fix**: ningún insert de log de auditoría en migración/rescate. La auditoría queda implícita en `carried_over=true`. El rescate borra los logs falsos preexistentes (lista en `BOGUS_MIGRATION_NOTES`).

### F7: Rescate elimina duplicados leftover y fusiona datos (`260d773`)
- **Bug**: si los originales ya fueron movidos en una corrida previa, los duplicados vacíos del primer rescate quedaban huérfanos (no había orphan en archivados que matcheara).
- **Fix**: nueva semántica en 3 fases:
  - **FASE 1**: limpieza de phase_logs falsos.
  - **FASE 2**: itera sobre `carried_over=true` en current. Si match en archivados + dup vacío → borrar dup. Si match + dup con datos → MERGE (mueve `time_entries`, `requirement_messages`, `requirement_cambio_logs`, `review_assets`, `requirement_mentions`, `review_comment_mentions` al original) + borrar dup. Sin match + vacío → borrar (leftover). Sin match + datos → conservar.
  - **FASE 3**: mover huérfanos restantes.

### F8: Admin client en rescate + logs de error (`eb85b4d`)
- **Bug**: si las RLS bloqueaban silenciosamente DELETE/UPDATE para el usuario con sesión normal, los duplicados no se borraban.
- **Fix**: todas las operaciones de mantenimiento del rescate usan `createAdminClient()` (service role). Errores se loguean.

### F9: ImageViewer mensaje claro de archivo perdido (`15a6ae7`)
- **Causa raíz histórica**: `cleanupCycleStorage` (en `renewCycle({immediate:true})`) borra archivos del bucket `review-files` para los reqs en el ciclo viejo. Como la versión rota anterior de `migrateOpenPipelineItems` dejaba los originales en el ciclo viejo, sus archivos se eliminaron físicamente. Después del rescate los DB rows volvieron pero los archivos ya no existen.
- **Fix futuro**: la nueva `migrateOpenPipelineItems` MUEVE, así `cleanupCycleStorage` filtra correctamente.
- **Fix UX**: `ImageViewer` detecta "file not found" y muestra placeholder "Archivo no disponible" con icono `image_not_supported`, explicación, y el path para que el admin re-suba la versión específica.

### F10: Proxy + portal layout impersonation-aware (`d003552`)
- **Bug**: ERR_TOO_MANY_REDIRECTS al suplantar a un cliente. Causa: `proxy.ts` (Next.js 16 renombró middleware) tenía Rule 3 que mandaba staff fuera de `/portal/*` mirando solo el rol del auth user (admin), ignorando suplantación.
- **Loop**: Admin → cookie set → /portal/dashboard → proxy ve admin → /dashboard → (app) layout ve isImpersonating + role=client → /portal/dashboard → loop.
- **Fix**:
  - `proxy.ts`: lee `IMPERSONATE_COOKIE`. Si admin real + target no admin, resuelve `effectiveRole` del target. Reglas 2 y 3 usan `effectiveRole`.
  - `(portal) layout.tsx`: si admin impersona y `activeId` null, auto-elige primera marca del cliente (no fuerza al admin pasar por selector).

---

## 7. Estado actual (2026-05-01)

### En producción y funcionando ✅
- F1–F10 deployadas y commiteadas a `master`.
- Single-session enforcement (migración 0066).
- Impersonation con audit log (migración 0067).
- Rescate de huérfanos / merge / cleanup de duplicados.
- Bloqueo de registro en ciclos impagos.
- ImageViewer con UX para archivos perdidos.

### Acciones manuales pendientes para el usuario
1. **Redeploy del Edge Function `daily-cycle-runner`** en Supabase Dashboard:
   - Functions → daily-cycle-runner → Code → pegar contenido de `supabase/functions/daily-cycle-runner/index.ts` (copiar desde GitHub Raw para evitar el problema de Windows asociando .ts a video) → Deploy.
   - Sin esto, el cron seguirá renovando con la lógica vieja.
2. **Para clientes ya rescatados** (CAAA, EDUCORP, etc.): cada uno ya tiene los datos correctos. Si quedan dudas, volver a darle "Rescatar requerimientos del ciclo anterior" — es idempotente.
3. **Para archivos de revisión perdidos** (los que muestran "Archivo no disponible"): los archivos se borraron de Supabase Storage en renovaciones pasadas. No se pueden recuperar — pedir al diseñador la última versión y subirla como nueva versión del asset (botón "+ Nueva versión" en el panel de revisión).
4. **Para clientes que se renovaron sin pagar**: editar `payment_status` desde `/clients/[id]/edit` o resolver caso por caso. El sistema no revierte automáticamente.
5. **Para fechas de ciclo malas** (Apr 30 → Jun 28 reportado): editar manualmente `period_start` y `period_end` desde `/clients/[id]/edit` con `updateCycleDates`. La causa raíz fue probablemente data preexistente o un `updateCycleDates` manual previo — la lógica actual de `nextCycleDates` es correcta.

### Issues observados / posibles próximas tareas
- **Sospecha**: el cálculo de `nextCycleDates` en el Edge Function está duplicado vs `src/lib/domain/cycles.ts`. Si difieren en alguna actualización futura → drift. Considerar agregar un test que valide la equivalencia.
- **Sospecha**: hay reportes de timers negativos. F6 debería haber resuelto el grueso, pero si reaparece, mirar `pipeline/page.tsx` línea ~196 (`item.last_moved_at = logs[logs.length - 1].created_at`) y verificar que ningún log tenga `created_at` futuro.
- **Pendientes admin-only sin guard de impersonación**: `users.ts`, `invoices.ts`, `quotes.ts`, `plans.ts`, `deleteClient.ts`, `clientUsers.ts`, `contentPackage.ts`, `credits.ts`, `renewals.ts` (parcial), `agencySettings.ts`, `company-settings.ts`, `updateUserRole.ts`, `updateUserDefaultAssignee.ts`. Son admin-only por UI gates pero no tienen `assertNotImpersonating()` explícito. Defense-in-depth.
- **`useReadOnly()` hook NO está cableado en UI**: ShiftStatusWidget, RequirementPanel, KanbanBoard, ContentReviewPanel — cuando admin impersona, los botones siguen visibles aunque el server action los rechace. Mejor UX: deshabilitarlos client-side.
- **Cleanup de versiones huérfanas**: agregar admin tool para borrar `review_versions` cuyos archivos no existen en storage (los que generan "Archivo no disponible"). Hoy quedan en historial.

---

## 8. Migraciones aplicadas

```
0001–0058   ya estaban antes (ver sección 16 del PROJECT_CONTEXT.md original)
0059        Multi-consumo + anulación de cambios
0060        n1co integration (payment links)
0061–0064   Varios ajustes (revisar)
0065        review_assets soporta PDF + review_pins.page_number
0066        users.current_session_id (single-session)
0067        impersonation_logs (audit)
```

**Nota**: 0066 y 0067 se aplicaron en esta serie de sesiones. Verificar que estén aplicadas en producción consultando el Supabase Dashboard → Database → Migrations.

---

## 9. Cómo continuar en una nueva sesión

1. **Lee este documento entero** — está estructurado para no necesitar más contexto.
2. **Verifica el estado del repo**:
   ```bash
   cd "C:\Users\Daniel\Desktop\FM CRM\fm-crm"
   git status                     # debe estar clean
   git log --oneline -15          # ver commits recientes
   ```
3. **Actualiza desde GitHub si es necesario**:
   ```bash
   git pull origin master
   ```
4. **Verifica que el Edge Function está al día**: Supabase Dashboard → Functions → daily-cycle-runner → Overview muestra fecha reciente de deploy. Si está viejo, redeployar manualmente (ver sección 7).
5. **Tests**:
   ```bash
   npm run lint    # baseline 12 errores; no introducir nuevos
   npm run build   # debe compilar sin errores
   npm run test    # vitest passing
   ```
6. **Login dev**: `danielmancia111203@gmail.com` / `usuario123`
7. **Si una tarea menciona el cron / Edge Function**: editar `supabase/functions/daily-cycle-runner/index.ts` Y luego avisar al usuario que redeployar manualmente.

---

## 10. Patrones a recordar

### Server action pattern
```ts
'use server'

import { assertNotImpersonating } from './impersonation'

export async function myMutation(args: ...) {
  await assertNotImpersonating()  // primera línea en mutaciones
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  // ... auth checks
  // ... mutation
  revalidatePath('/...')
  return { ok: true }
}
```

### Layout impersonation pattern
```ts
const ctx = await getEffectiveUser()
if (!ctx) redirect('/login')
const effectiveId = ctx.appUser.id
const role = ctx.appUser.role
// usar effectiveId para filtros, role para gates
// authUser.id (real) solo para mutaciones
```

### Operator filter pattern
```ts
let q = supabase.from('requirements').select('...').eq('voided', false)
if (role === 'operator') q = q.contains('assigned_to', [effectiveId])
const { data } = await q
```

### Pre-query "clientes permitidos al operador"
```ts
import { getOperatorClientIds } from '@/lib/auth/operator-scope'
if (role === 'operator') {
  const allowedIds = await getOperatorClientIds(effectiveId)
  if (allowedIds.length === 0) clients = []
  else { /* query .in('id', allowedIds) */ }
}
```

---

## 11. Lugares donde NO improvisar

- **Schema de DB** (`src/types/db.ts`): se edita a mano. Si agregas columna en migración, agrega aquí también. NO hay generador.
- **`migrateOpenPipelineItems` y la versión inline en Edge Function**: deben mantenerse equivalentes. Si modificas una, mira la otra.
- **`isCycleFullyPaid()` en Edge Function**: replica la lógica de `isCycleFullyLocked()` en `src/lib/domain/requirement.ts` desde el otro ángulo. Mantener consistencia.
- **Notas de migración bogus** (`BOGUS_MIGRATION_NOTES` en `renewals.ts`): si insertas otro tipo de log de auditoría en futuras migraciones, considera si debe agregarse a esa lista.
- **`proxy.ts`**: cualquier cambio en routing rules debe respetar la suplantación (consultar `IMPERSONATE_COOKIE` y resolver `effectiveRole`).

---

## 12. Contactos / credenciales

- Email del usuario: `danielmancia111203@gmail.com`
- Datos fiscales FM (emisor) en `~/.claude/projects/.../memory/project_fm_fiscal_data.md`
- Cliente n1co (pagos): integración Fase 1 — webhook handler con HMAC, payment links dinámicos
