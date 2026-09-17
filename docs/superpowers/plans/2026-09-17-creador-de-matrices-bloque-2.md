# Creador de matrices · Bloque 2 (conversión automática) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una pieza de una matriz aprobada se convierta sola en requerimiento del pipeline `lead_days` antes de su fecha de entrega, con el brief visible en la ficha del requerimiento y las piezas que fallan marcadas como bloqueadas con aviso.

**Architecture:** Selección pura y testeada en `src/lib/domain/matrix.ts`; núcleo de conversión con acceso a datos en `src/lib/data/matrix-convert.ts` (usado igual por el cron con cliente admin y por la acción manual con cliente autenticado, porque el candado de pago es un trigger de base de datos); ruta `/api/matrices/convert` disparada por cron diario de Vercel; UI en el editor de matrices y una sección de brief en la ficha del pipeline.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Supabase JS v2 · vitest · Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md` (revisión 3, aprobada). Leerla completa antes de empezar: manda sobre cualquier ambigüedad de este plan. Contexto del bloque 1: `CLAUDE.md` sección "Matrices de contenido (bloque 1 — 2026-09)" y el spec del bloque 1 (sus secciones finales "Desviaciones implementadas" y "Pendiente para bloques 2–3").

**Reglas del repo (de `CLAUDE.md` y `AGENTS.md`):**
- Next.js 16 tiene cambios de API respecto a lo que "sabes": ante la duda, leer `node_modules/next/dist/docs/` y los archivos vecinos.
- Tipos de base de datos a mano en `src/types/db.ts`. Migraciones numeradas en `supabase/migrations/`, **se aplican a mano** en el Dashboard de Supabase (no las apliques tú).
- Server actions: `createClient` de `@/lib/supabase/server` (async). Admin: `createAdminClient` de `@/lib/supabase/admin`. `.delete()`/`.update()` **no lanzan**: siempre revisar `{ error }`.
- Texto de UI y errores en español. Commits en español terminando con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **No hacer `git push`.**
- ESLint: nada de `setState` síncrono en el cuerpo de `useEffect`; `next/image` en vez de `<img>`.
- Falla conocida y ajena: `src/lib/domain/cycles.test.ts > isRenewalDue`. Ignorarla.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0130_matrix_items_assignment.sql` (crear) | Columnas `assigned_to` y `estimated_time_minutes` en piezas |
| `src/types/db.ts` (modificar) | Esas dos columnas + `kind: 'matrix_blocked'` en `NotificationItem` |
| `src/lib/domain/matrix.ts` (modificar) | `CATCHUP_DAYS`, `shouldConvert`, `selectItemsToConvert`, `convertsBeforePeriodStart`, nuevos motivos de aprobación, `computeMatrixUsage` con `convertedInCycleIds` |
| `src/lib/domain/matrix.test.ts` (modificar) | Pruebas de todo lo anterior |
| `src/lib/data/matrix-convert.ts` (crear) | Núcleo `convertMatrixItem` + caché de cupo por ciclo |
| `src/lib/data/matrices.ts` (modificar) | `convertedInCycleIds`, usuarios asignables en el loader del editor |
| `src/app/api/matrices/convert/route.ts` (crear) | Barrido diario |
| `vercel.json` (modificar) | Cron `0 12 * * *` |
| `src/app/actions/matrices.ts` (modificar) | `convertItemNow`, `replanItem`, ajustes en `updateItem`/`addItem`/duplicados/`setMatrixStatus` |
| `src/components/matrices/MatrixItemSheet.tsx` (modificar) | Responsable y estimado; deshabilitado por campo |
| `src/components/matrices/MatrixItemsTable.tsx` (modificar) | Columna de estado, acciones, aviso de ciclo |
| `src/components/matrices/MatrixHeader.tsx` (modificar) | `lead_days` + contadores |
| `src/components/matrices/MatrixEditor.tsx` (modificar) | Estado y llamadas nuevas |
| `src/components/pipeline/MatrixBriefSection.tsx` (crear) | Sección "Brief de la matriz" |
| `src/components/pipeline/PhaseSheet.tsx` (modificar) | Monta la sección |
| `src/app/api/notifications/route.ts` (modificar) | `matrix_blocked` |
| `src/components/layout/NotificationsDropdown.tsx` (modificar) | Render del aviso |
| `CLAUDE.md` (modificar) | Documentación |

---

### Task 1: Migración 0130 y tipos

**Files:**
- Create: `supabase/migrations/0130_matrix_items_assignment.sql`
- Modify: `src/types/db.ts`

- [x] **Step 1: Crear la migración**

Contenido exacto (idempotente, una transacción, `lock_timeout` como 0129):

```sql
-- 0130_matrix_items_assignment.sql
-- Creador de matrices · Bloque 2. Responsable y tiempo estimado por pieza: la matriz planifica
-- también el quién y el cuánto, y la conversión automática los copia al requerimiento.
-- Spec: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md

begin;
set local lock_timeout = '5s';

alter table public.content_matrix_items
  add column if not exists assigned_to uuid[],
  add column if not exists estimated_time_minutes integer;

-- Constraint con nombre explícito (convención de 0129), idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_matrix_items_est_minutes_chk'
      and conrelid = 'public.content_matrix_items'::regclass
  ) then
    alter table public.content_matrix_items
      add constraint content_matrix_items_est_minutes_chk
      check (estimated_time_minutes is null or estimated_time_minutes between 1 and 10080);
  end if;
end $$;

commit;
```

**No la apliques.** El usuario la corre a mano en el Dashboard.

- [x] **Step 2: Tipos**

En `src/types/db.ts`, bloque `content_matrix_items`: añadir a `Row` `assigned_to: string[] | null` y `estimated_time_minutes: number | null`; a `Insert` y `Update` los mismos con `?`.

- [x] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errores.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0130_matrix_items_assignment.sql src/types/db.ts
git commit -m "feat(matrices): migración 0130 — responsable y tiempo estimado por pieza" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Dominio — selección de piezas convertibles

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `matrix.test.ts` (imports arriba del archivo):

```ts
import { shouldConvert, selectItemsToConvert, convertsBeforePeriodStart, CATCHUP_DAYS } from './matrix'
import type { ConvertibleItem, ConvertibleMatrix } from './matrix'

const approvedMatrix: ConvertibleMatrix = { id: 'm1', status: 'approved', lead_days: 7 }

function citem(id: string, deadline: string, status: ConvertibleItem['status'] = 'planned', matrix_id = 'm1'): ConvertibleItem & { created_at: string } {
  return { id, matrix_id, deadline, status, created_at: `2026-10-01T00:00:${id.padStart(2, '0')}Z` }
}

describe('shouldConvert', () => {
  const today = '2026-10-10'
  it('convierte dentro de la ventana y justo en el borde', () => {
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-15' }, approvedMatrix, today)).toBe(true)
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-17' }, approvedMatrix, today)).toBe(true) // today + 7
  })
  it('no convierte lo que aún está lejos', () => {
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-18' }, approvedMatrix, today)).toBe(false)
  })
  it('convierte vencidas hasta CATCHUP_DAYS atrás, no más', () => {
    expect(shouldConvert({ status: 'planned', deadline: '2026-09-10' }, approvedMatrix, today)).toBe(true)  // -30
    expect(shouldConvert({ status: 'planned', deadline: '2026-09-09' }, approvedMatrix, today)).toBe(false) // -31
    expect(CATCHUP_DAYS).toBe(30)
  })
  it('solo piezas planned de matrices approved', () => {
    expect(shouldConvert({ status: 'converted', deadline: '2026-10-12' }, approvedMatrix, today)).toBe(false)
    expect(shouldConvert({ status: 'blocked', deadline: '2026-10-12' }, approvedMatrix, today)).toBe(false)
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-12' }, { ...approvedMatrix, status: 'draft' }, today)).toBe(false)
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-12' }, { ...approvedMatrix, status: 'closed' }, today)).toBe(false)
  })
  it('lead_days 0 solo convierte el mismo día o antes', () => {
    const m = { ...approvedMatrix, lead_days: 0 }
    expect(shouldConvert({ status: 'planned', deadline: today }, m, today)).toBe(true)
    expect(shouldConvert({ status: 'planned', deadline: '2026-10-11' }, m, today)).toBe(false)
  })
})

describe('selectItemsToConvert', () => {
  const today = '2026-10-10'
  const matrices = new Map<string, ConvertibleMatrix>([
    ['m1', approvedMatrix],
    ['m2', { id: 'm2', status: 'approved', lead_days: 14 }],
    ['m3', { id: 'm3', status: 'draft', lead_days: 7 }],
  ])
  it('ordena por fecha y respeta el lead_days de cada matriz', () => {
    const items = [
      citem('1', '2026-10-16'),
      citem('2', '2026-10-12'),
      citem('3', '2026-10-20', 'planned', 'm2'), // dentro de los 14 de m2
      citem('4', '2026-10-20'),                   // fuera de los 7 de m1
    ]
    expect(selectItemsToConvert(items, matrices, today).map((i) => i.id)).toEqual(['2', '1', '3'])
  })
  it('descarta piezas de matrices no aprobadas o ausentes del mapa', () => {
    const items = [citem('1', '2026-10-12', 'planned', 'm3'), citem('2', '2026-10-12', 'planned', 'mX')]
    expect(selectItemsToConvert(items, matrices, today)).toEqual([])
  })
  it('aplica el tope', () => {
    const items = [citem('1', '2026-10-11'), citem('2', '2026-10-12'), citem('3', '2026-10-13')]
    expect(selectItemsToConvert(items, matrices, today, 2).map((i) => i.id)).toEqual(['1', '2'])
  })
})

describe('convertsBeforePeriodStart', () => {
  it('avisa cuando la conversión cae antes del inicio del período', () => {
    expect(convertsBeforePeriodStart({ deadline: '2026-10-17' }, { period_start: '2026-10-15', lead_days: 7 })).toBe(true)
  })
  it('no avisa a mitad de período ni con lead_days 0', () => {
    expect(convertsBeforePeriodStart({ deadline: '2026-10-30' }, { period_start: '2026-10-15', lead_days: 7 })).toBe(false)
    expect(convertsBeforePeriodStart({ deadline: '2026-10-15' }, { period_start: '2026-10-15', lead_days: 0 })).toBe(false)
  })
})
```

- [x] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL (`shouldConvert is not a function`, etc.).

- [x] **Step 3: Implementar**

Añadir a `src/lib/domain/matrix.ts` (sección nueva al final, antes de los tipos de `ActionResult`):

```ts
// ── Conversión a requerimientos (bloque 2) ──────────────────────────────────

/** Días vencidos que el barrido todavía recoge. Más viejo que esto, solo a mano. */
export const CATCHUP_DAYS = 30

export interface ConvertibleItem {
  id: string
  matrix_id: string
  deadline: DateString
  status: MatrixItemStatus
}

export interface ConvertibleMatrix {
  id: string
  status: MatrixStatus
  lead_days: number
}

/** ¿Toca convertir esta pieza hoy? Solo piezas `planned` de matrices `approved`. */
export function shouldConvert(
  item: Pick<ConvertibleItem, 'status' | 'deadline'>,
  matrix: Pick<ConvertibleMatrix, 'status' | 'lead_days'>,
  today: DateString,
): boolean {
  if (matrix.status !== 'approved' || item.status !== 'planned') return false
  if (item.deadline > addDaysString(today, matrix.lead_days)) return false
  return item.deadline >= addDaysString(today, -CATCHUP_DAYS)
}

/** Piezas elegibles, las más urgentes primero. `limit` recorta el lote. */
export function selectItemsToConvert<T extends ConvertibleItem & { created_at: string }>(
  items: T[],
  matrices: Map<string, ConvertibleMatrix>,
  today: DateString,
  limit?: number,
): T[] {
  const eligible = items.filter((it) => {
    const m = matrices.get(it.matrix_id)
    return m ? shouldConvert(it, m, today) : false
  })
  eligible.sort(compareMatrixItems)
  return limit === undefined ? eligible : eligible.slice(0, limit)
}

/**
 * ¿La pieza se convertirá antes de que arranque el período de su matriz? Entonces el
 * requerimiento entrará al ciclo vigente de ese momento —el anterior— y consumirá su cupo.
 */
export function convertsBeforePeriodStart(
  item: Pick<ContentMatrixItem, 'deadline'>,
  matrix: Pick<ContentMatrix, 'period_start' | 'lead_days'>,
): boolean {
  return addDaysString(item.deadline, -matrix.lead_days) < matrix.period_start
}
```

Importar `MatrixItemStatus` y `ContentMatrix` en el bloque de tipos si aún no están.

- [x] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): dominio de selección de piezas convertibles" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Dominio — aprobación y conteo con piezas convertidas

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [x] **Step 1: Pruebas que fallan**

```ts
describe('validateForApproval con responsable y estimado', () => {
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14' }
  const base = { title: 'Ok', deadline: '2026-10-20', status: 'planned' as const, assigned_to: ['u1'], estimated_time_minutes: 60 }
  it('exige responsable y estimado', () => {
    const r = validateForApproval([
      { id: 'a', ...base, assigned_to: null },
      { id: 'b', ...base, assigned_to: [] },
      { id: 'c', ...base, estimated_time_minutes: null },
      { id: 'd', ...base },
    ], period)
    expect(r.problems).toEqual([
      { itemId: 'a', reason: 'sin_responsable' },
      { itemId: 'b', reason: 'sin_responsable' },
      { itemId: 'c', reason: 'sin_estimado' },
    ])
  })
  it('un solo problema por pieza, el título manda', () => {
    const r = validateForApproval([{ id: 'a', ...base, title: '', assigned_to: null }], period)
    expect(r.problems).toEqual([{ itemId: 'a', reason: 'sin_titulo' }])
  })
  it('exime a las piezas ya convertidas', () => {
    const r = validateForApproval([{ id: 'a', ...base, status: 'converted', assigned_to: null, estimated_time_minutes: null }], period)
    expect(r.ok).toBe(true)
  })
})

describe('computeMatrixUsage con convertedInCycleIds', () => {
  it('una convertida al ciclo del período no cuenta como planificada; una convertida a otro ciclo sí', () => {
    const items = [item('1', 'estatico', '2026-10-17', 'converted'), item('2', 'estatico', '2026-10-18', 'converted')]
    const u = computeMatrixUsage(items, baseML, ['1'])
    expect(u.byType.estatico.planned).toBe(1)
  })
  it('sin el parámetro se comporta como antes', () => {
    const items = [item('1', 'estatico', '2026-10-17', 'converted')]
    expect(computeMatrixUsage(items, baseML).byType.estatico.planned).toBe(0)
  })
})
```

(`item(...)` y `baseML` ya existen en el archivo desde el bloque 1.)

- [x] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL.

- [x] **Step 3: Implementar**

1. `ApprovalProblemReason` gana `'sin_responsable' | 'sin_estimado'`; `APPROVAL_PROBLEM_LABELS` gana `sin_responsable: 'Sin responsable'` y `sin_estimado: 'Sin tiempo estimado'`.
2. `validateForApproval` cambia de firma y de cuerpo:

```ts
export function validateForApproval(
  items: Pick<ContentMatrixItem, 'id' | 'title' | 'deadline' | 'status' | 'assigned_to' | 'estimated_time_minutes'>[],
  period: PeriodRange,
): { ok: boolean; empty: boolean; problems: ApprovalProblem[] } {
  if (items.length === 0) return { ok: false, empty: true, problems: [] }
  const problems: ApprovalProblem[] = []
  for (const it of items) {
    // Una pieza ya convertida tiene esos campos bloqueados en el editor: exigirlos sería
    // un problema imposible de arreglar.
    if (it.status === 'converted') continue
    if (!it.title.trim()) problems.push({ itemId: it.id, reason: 'sin_titulo' })
    else if (!inPeriod(it.deadline, period)) problems.push({ itemId: it.id, reason: 'fecha_fuera_de_periodo' })
    else if (!it.assigned_to || it.assigned_to.length === 0) problems.push({ itemId: it.id, reason: 'sin_responsable' })
    else if (!it.estimated_time_minutes) problems.push({ itemId: it.id, reason: 'sin_estimado' })
  }
  return { ok: problems.length === 0, empty: false, problems }
}
```

3. `computeMatrixUsage` gana un tercer parámetro opcional:

```ts
export function computeMatrixUsage(
  items: UsageItem[],
  ml: MatrixLimits,
  /** Ids de piezas `converted` cuyo requerimiento SÍ está en el ciclo leído (array, no Set: cruza server → client). */
  convertedInCycleIds?: readonly string[],
): MatrixUsage {
  const inCycle = new Set(convertedInCycleIds ?? [])
  // Sin el parámetro, toda `converted` se asume dentro del ciclo (comportamiento del bloque 1).
  // Con él, la que NO está en la lista se sigue contando como planificada: se convirtió a otro
  // ciclo y si no, desaparecería de los chips por los dos lados.
  const counts = (it: UsageItem) =>
    it.status !== 'converted' ? true : (convertedInCycleIds !== undefined && !inCycle.has(it.id))
  // Usar `counts(it)` donde antes iba `it.status !== 'converted'`: tanto al sumar `planned`
  // como en el recorrido ordenado que marca `overPlanItemIds`.
```

- [x] **Step 4: Arreglar los llamadores y las pruebas existentes**

1. `setMatrixStatus` (`src/app/actions/matrices.ts`): ampliar el `select` a `id, title, deadline, status, assigned_to, estimated_time_minutes`.
2. `MatrixEditor.tsx`: ya pasa filas completas, no cambia.
3. **Pruebas existentes de `validateForApproval`** (`src/lib/domain/matrix.test.ts`, bloque `describe('validateForApproval', …)`): hoy pasan literales `{ id, title, deadline }`. Con la firma nueva **no compilan** (`tsconfig` incluye los tests) y además cambiarían de resultado (una pieza sin `assigned_to` pasaría a reportar `sin_responsable`). Actualizar cada literal añadiendo `status: 'planned'`, `assigned_to: ['u1']` y `estimated_time_minutes: 60`, salvo donde la prueba quiera comprobar justo lo contrario. El resultado esperado de esas pruebas **no** debe cambiar.

- [x] **Step 5: Correr todo el dominio**

Run: `npx vitest run src/lib/domain` · `npx tsc --noEmit -p tsconfig.json`
Expected: solo la falla conocida de `cycles.test.ts`; 0 errores de tipos.

- [x] **Step 6: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts src/app/actions/matrices.ts src/components/matrices/MatrixEditor.tsx
git commit -m "feat(matrices): aprobación exige responsable y estimado; conteo con piezas convertidas" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Núcleo de conversión

**Files:**
- Create: `src/lib/data/matrix-convert.ts`

Sin pruebas unitarias (toca la base). Se verifica con `tsc`, lint y el recorrido manual de la Task 12.

- [x] **Step 1: Escribir el módulo**

Leer antes `src/lib/data/matrices.ts` (helpers `Db`, `fail`, `loadCurrentCycle`) y `src/app/actions/matrices.ts` (`linkMatrixRequirement`, `discardUnlinkedRequirement`) para copiar el estilo.

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { BillingCycle, ContentMatrix, ContentMatrixItem, Requirement } from '@/types/db'
import { effectiveLimits, applyContentLimitsWithOverride, applyUnifiedPool } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
import type { Db } from './matrices'

export type ConvertOutcome =
  | { kind: 'converted'; requirementId: string }
  | { kind: 'blocked'; reason: string }
  // `skipped` cubre tres casos y el motivo los distingue: otro proceso ganó, matriz no aprobada,
  // o fallo transitorio (se reintenta al día siguiente, sin marcar la pieza).
  | { kind: 'skipped'; reason: string }

/** Requerimientos del ciclo ya leídos en esta corrida, por `billing_cycle_id`. */
export type CycleRequirementsCache = Map<string, Requirement[]>

const REASON_BUSY = 'La pieza ya no está disponible para convertir.'
const REASON_NOT_APPROVED = 'La matriz no está aprobada.'
const NO_CYCLE = 'El cliente no tiene ciclo vigente.'
const BLOCKED_REASON_MAX = 500

type ItemWithMatrix = ContentMatrixItem & { matrix: ContentMatrix }

export async function convertMatrixItem(
  db: Db,
  itemId: string,
  opts: { registeredByUserId?: string; cache?: CycleRequirementsCache } = {},
): Promise<ConvertOutcome> {
  // 1. Pieza + matriz
  const { data: raw, error: readErr } = await db
    .from('content_matrix_items')
    .select('*, matrix:content_matrices!inner(*)')
    .eq('id', itemId)
    .maybeSingle()
  if (readErr) return { kind: 'skipped', reason: readErr.message }
  if (!raw) return { kind: 'skipped', reason: REASON_BUSY }
  const item = raw as unknown as ItemWithMatrix
  const matrix = item.matrix
  if (item.status === 'converted') return { kind: 'skipped', reason: REASON_BUSY }
  if (matrix.status !== 'approved') return { kind: 'skipped', reason: REASON_NOT_APPROVED }

  // 2. Ciclo vigente del cliente (decisión de diseño: SIEMPRE el vigente, no el del período)
  const { data: cycles, error: cycleErr } = await db
    .from('billing_cycles').select('*')
    .eq('client_id', matrix.client_id).eq('status', 'current')
    .order('created_at', { ascending: false }).limit(1)
  if (cycleErr) return { kind: 'skipped', reason: cycleErr.message }
  const cycle = (cycles?.[0] as BillingCycle | undefined) ?? null
  if (!cycle) return await markBlocked(db, itemId, NO_CYCLE)

  // 3. Fuera de cupo — misma cadena que el registro manual, pool unificado incluido.
  let cycleReqs = opts.cache?.get(cycle.id)
  if (!cycleReqs) {
    const { data, error } = await db.from('requirements').select('*')
      .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
    if (error) return { kind: 'skipped', reason: error.message }
    cycleReqs = (data ?? []) as Requirement[]
    opts.cache?.set(cycle.id, cycleReqs)
  }
  const totals = computeTotals(cycleReqs)
  const limits = applyUnifiedPool(
    applyContentLimitsWithOverride(
      effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json),
      (cycle.content_limits_override_json ?? null) as Record<string, number> | null,
    ),
    cycle.limits_snapshot_json,
    totals,
  )
  const overLimit = (totals[item.content_type] ?? 0) >= (limits[item.content_type] ?? 0)

  // 4. Requerimiento
  const registeredBy = opts.registeredByUserId ?? matrix.approved_by ?? matrix.created_by
  const { data: req, error: insertErr } = await db.from('requirements').insert({
    billing_cycle_id: cycle.id,
    content_type: item.content_type,
    title: item.title || 'Contenido de matriz',
    deadline: item.deadline,
    assigned_to: item.assigned_to && item.assigned_to.length > 0 ? item.assigned_to : null,
    estimated_time_minutes: item.estimated_time_minutes,
    registered_by_user_id: registeredBy,
    priority: 'media',
    over_limit: overLimit,
    approval_status: 'approved',
    includes_story: false,
    requested_via: 'staff',
    notes: null,
  }).select('*').single()
  // El trigger requirements_check_week_payment_trg rechaza aquí si la semana no está pagada o el
  // cliente está suspendido; su mensaje ya viene en español y se guarda tal cual.
  if (insertErr || !req) return await markBlocked(db, itemId, insertErr?.message ?? 'No se pudo registrar el requerimiento.')

  // 5. Log inicial de fase (igual que el registro manual)
  await insertInitialPhaseLog(db, { requirementId: req.id, movedBy: registeredBy })

  // 6. Marcar la pieza (condicional: si otro proceso ganó, deshacer)
  const { data: updated, error: updErr } = await db.from('content_matrix_items')
    .update({ status: 'converted', requirement_id: req.id, converted_at: new Date().toISOString(), blocked_reason: null })
    .eq('id', itemId).in('status', ['planned', 'blocked'])
    .select('id')
  if (updErr || !updated || updated.length === 0) {
    await rollbackRequirement(req.id, cycle.id, opts.cache)
    return { kind: 'skipped', reason: updErr?.message ?? REASON_BUSY }
  }

  opts.cache?.set(cycle.id, [...cycleReqs, req as Requirement])
  return { kind: 'converted', requirementId: req.id }
}

/** Marca la pieza como bloqueada. Solo si sigue `planned`/`blocked`. */
async function markBlocked(db: Db, itemId: string, reason: string): Promise<ConvertOutcome> {
  const clean = reason.slice(0, BLOCKED_REASON_MAX)
  const { error } = await db.from('content_matrix_items')
    .update({ status: 'blocked', blocked_reason: clean })
    .eq('id', itemId).in('status', ['planned', 'blocked'])
  if (error) console.error('[matrix-convert] no se pudo marcar bloqueada', itemId, error.message)
  return { kind: 'blocked', reason: clean }
}

/**
 * Borra el requerimiento recién creado. SIEMPRE con el cliente admin: `requirements` tiene RLS y
 * no existe policy `for delete`, así que un delete autenticado devolvería 0 filas sin error y
 * dejaría un requerimiento huérfano consumiendo cupo. `requirement_phase_logs` cae por cascade.
 */
async function rollbackRequirement(reqId: string, cycleId: string, cache?: CycleRequirementsCache): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('requirements').delete().eq('id', reqId)
  if (error) console.error('[matrix-convert] rollback falló', reqId, error.message)
  const cached = cache?.get(cycleId)
  if (cached) cache.set(cycleId, cached.filter((r) => r.id !== reqId))
}
```

- [x] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` y `npx eslint src/lib/data/matrix-convert.ts`
Expected: 0 errores. Si `requested_via` o `estimated_time_minutes` dieran error de tipos, revisar `src/types/db.ts` (ambos existen desde el bloque 1 y la migración 0114).

- [x] **Step 3: Commit**

```bash
git add src/lib/data/matrix-convert.ts
git commit -m "feat(matrices): nucleo de conversion de pieza a requerimiento" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Barrido diario (ruta + cron)

**Files:**
- Create: `src/app/api/matrices/convert/route.ts`
- Modify: `vercel.json`

- [x] **Step 1: La ruta**

Copiar la estructura de `src/app/api/billing/due-reminders/route.ts` (leerla primero: auth, `runtime`, `GET` delegando en `POST`).

```ts
/**
 * Cron diario que convierte piezas de matrices aprobadas en requerimientos del pipeline,
 * `lead_days` antes de su fecha de entrega.
 *
 * Diseño: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) o `x-trigger-secret`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertMatrixItem, type CycleRequirementsCache } from '@/lib/data/matrix-convert'
import { selectItemsToConvert, CATCHUP_DAYS, type ConvertibleMatrix } from '@/lib/domain/matrix'
import { today, addDaysString } from '@/lib/domain/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cota barata en SQL: el tope de lead_days es 30. */
const WINDOW_DAYS = 30
const SCAN_LIMIT = 300
const CONVERT_LIMIT = 80

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  const triggerSecret = process.env.AI_JOBS_TRIGGER_SECRET
  const auth = request.headers.get('authorization')
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (triggerSecret && request.headers.get('x-trigger-secret') === triggerSecret) return true
  return false
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const t = today()

  const { data, error } = await admin
    .from('content_matrix_items')
    .select('id, matrix_id, deadline, status, created_at, matrix:content_matrices!inner(id, status, lead_days)')
    .eq('status', 'planned')
    .eq('matrix.status', 'approved')
    .gte('deadline', addDaysString(t, -CATCHUP_DAYS))
    .lte('deadline', addDaysString(t, WINDOW_DAYS))
    .order('deadline', { ascending: true })
    .limit(SCAN_LIMIT)

  if (error) {
    console.error('[matrices/convert] query', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  type Row = { id: string; matrix_id: string; deadline: string; status: 'planned'; created_at: string; matrix: ConvertibleMatrix }
  const rows = (data ?? []) as unknown as Row[]
  const matrices = new Map<string, ConvertibleMatrix>(rows.map((r) => [r.matrix_id, r.matrix]))
  const selected = selectItemsToConvert(rows, matrices, t, CONVERT_LIMIT)

  const cache: CycleRequirementsCache = new Map()
  const details: Array<{ id: string; kind: string; reason?: string }> = []
  let converted = 0, blocked = 0, skipped = 0

  // Secuencial a propósito: en paralelo dos piezas del mismo ciclo calcularían el cupo sobre el
  // mismo estado y ambas nacerían dentro de plan.
  for (const it of selected) {
    const r = await convertMatrixItem(admin, it.id, { cache })
    if (r.kind === 'converted') converted++
    else if (r.kind === 'blocked') blocked++
    else skipped++
    if (details.length < 50) details.push({ id: it.id, kind: r.kind, reason: 'reason' in r ? r.reason : undefined })
  }

  console.log(`[matrices/convert] ${t} scanned=${rows.length} selected=${selected.length} converted=${converted} blocked=${blocked} skipped=${skipped}`)
  return NextResponse.json({ ok: true, today: t, scanned: rows.length, selected: selected.length, converted, blocked, skipped, details })
}

// Vercel Cron manda GET.
export async function GET(request: Request) {
  return POST(request)
}
```

**Si el filtro sobre el embed aliaseado fallara** (PostgREST devuelve error de columna), usar la forma sin alias: `content_matrices!inner(id, status, lead_days)` y `.eq('content_matrices.status', 'approved')`, que es la que ya usa `src/lib/ai/tools.ts`.

- [x] **Step 2: Cron en `vercel.json`**

Añadir al array `crons` (dejando los dos existentes intactos):

```json
    {
      "path": "/api/matrices/convert",
      "schedule": "0 12 * * *"
    }
```

12:00 UTC son las 6:00 AM en El Salvador, antes de que entre el equipo.

- [x] **Step 3: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint "src/app/api/matrices/convert/route.ts"` y `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"`
Expected: sin errores.

- [x] **Step 4: Commit**

```bash
git add "src/app/api/matrices/convert/route.ts" vercel.json
git commit -m "feat(matrices): barrido diario que convierte piezas en requerimientos" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Server actions de conversión

**Files:**
- Modify: `src/app/actions/matrices.ts`
- Modify: `src/lib/domain/matrix.ts` (ItemPatch + validación)
- Test: `src/lib/domain/matrix.test.ts`

- [x] **Step 1: `convertItemNow` y `replanItem`**

Al final de `src/app/actions/matrices.ts`, respetando `requireManager` y el estilo del archivo:

```ts
// ── Conversión (bloque 2) ────────────────────────────────────────────────────

export async function convertItemNow(itemId: string): Promise<ActionResult<{ outcome: ConvertOutcome }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }

  // Con el cliente autenticado a propósito: el trigger de pago debe aplicar igual que en un
  // registro manual. El rollback interno usa el admin client (ver matrix-convert.ts).
  const outcome = await convertMatrixItem(ctx.supabase, itemId, { registeredByUserId: ctx.userId })

  const { data: it } = await ctx.supabase.from('content_matrix_items')
    .select('matrix_id, matrix:content_matrices!inner(client_id)').eq('id', itemId).maybeSingle()
  // `as unknown as` como el resto del repo para embeds (el cliente tipado no los infiere).
  const row = it as unknown as { matrix_id: string; matrix?: { client_id?: string } } | null
  if (row?.matrix?.client_id) revalidateMatrix(row.matrix.client_id, row.matrix_id)
  return { ok: true, outcome }
}

export async function replanItem(itemId: string): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: existing, error: readErr } = await supabase.from('content_matrix_items')
    .select('id, matrix_id, status, requirement_id').eq('id', itemId).maybeSingle()
  if (readErr) return { ok: false, error: dbError(readErr, 'No se pudo leer la pieza.') }
  if (!existing) return { ok: false, error: 'Pieza no encontrada.' }
  if (existing.status !== 'converted') return { ok: false, error: 'La pieza no está convertida.' }

  // Guarda imprescindible: sin ella, el barrido de mañana crearía un SEGUNDO requerimiento para
  // la misma pieza (el índice único no lo ataja porque el id nuevo es distinto).
  if (existing.requirement_id) {
    const { data: req, error: reqErr } = await supabase.from('requirements')
      .select('id, voided').eq('id', existing.requirement_id).maybeSingle()
    if (reqErr) return { ok: false, error: dbError(reqErr, 'No se pudo leer el requerimiento.') }
    if (req && !req.voided) {
      return { ok: false, error: 'El requerimiento sigue activo: anúlalo primero en el pipeline.' }
    }
  }

  const { data: item, error } = await supabase.from('content_matrix_items')
    .update({ status: 'planned', requirement_id: null, converted_at: null, blocked_reason: null })
    .eq('id', itemId).eq('status', 'converted').select('*').maybeSingle()
  if (error) return { ok: false, error: dbError(error, 'No se pudo volver a planificar.') }
  if (!item) return { ok: false, error: 'La pieza cambió; recarga la página.' }

  const m = await loadMatrixForItemWrite(ctx, existing.matrix_id)
  if (!('error' in m)) revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true, item: item as ContentMatrixItem }
}
```

Importar `convertMatrixItem` y el tipo `ConvertOutcome` desde `@/lib/data/matrix-convert`.

**Decisión explícita:** `replanItem` **sí** funciona en una matriz cerrada (a diferencia de
`updateItem`). El caso real es "anulé el requerimiento y quiero dejar la pieza como planificada";
el barrido ignora las matrices cerradas, así que no se reconvierte sola.

- [x] **Step 2: `updateItem` — textos sí, los cuatro campos congelados no**

Sustituir el rechazo global actual (`if (existing.status === 'converted') return …`) por:

```ts
  if (existing.status === 'converted') {
    const frozen = (['content_type', 'deadline', 'assigned_to', 'estimated_time_minutes'] as const)
      .filter((k) => (patch as Record<string, unknown>)[k] !== undefined)
    if (frozen.length > 0) {
      return { ok: false, error: 'La pieza ya se convirtió: el tipo, la fecha, el responsable y el estimado se editan en el requerimiento.' }
    }
  }
```

- [x] **Step 3: `ItemPatch` y validación de los campos nuevos (con pruebas)**

En `src/lib/domain/matrix.ts`, `ItemPatch` suma `'assigned_to' | 'estimated_time_minutes'`. En `validateItemPatch`:

```ts
  if (patch.assigned_to !== undefined && patch.assigned_to !== null) {
    if (!Array.isArray(patch.assigned_to) || patch.assigned_to.some((v) => typeof v !== 'string')) {
      return { ok: false, error: 'Responsable inválido.' }
    }
  }
  if (patch.estimated_time_minutes !== undefined && patch.estimated_time_minutes !== null) {
    const n = patch.estimated_time_minutes
    if (!Number.isInteger(n) || n < 1 || n > 10080) {
      return { ok: false, error: 'El tiempo estimado debe estar entre 1 minuto y 7 días.' }
    }
  }
```

Pruebas (primero, viéndolas fallar): `assigned_to: 'u1'` inválido, `assigned_to: [1]` inválido, `assigned_to: null` y `['u1']` válidos, `estimated_time_minutes: 0`, `10081` y `1.5` inválidos, `60` y `null` válidos.

En `updateItem`, copiar ambos al objeto `update` cuando vengan definidos.

- [x] **Step 4: `addItem`, duplicados y `setMatrixStatus`**

- `addItem`: antes del insert, leer los responsables por defecto y guardarlos.

```ts
  const { data: defaults } = await ctx.supabase.from('users').select('id')
    .eq('default_assignee', true).not('role', 'in', '(client,agent)')
  const assignedTo = (defaults ?? []).map((u) => u.id)
```

e incluir `assigned_to: assignedTo.length > 0 ? assignedTo : null` en el insert.
- `duplicateItem` y `duplicateMatrix`: añadir `assigned_to` y `estimated_time_minutes` a las columnas que copian.
- `setMatrixStatus`: el select debe traer `id, title, deadline, status, assigned_to, estimated_time_minutes` (si ya se hizo en la Task 3, verificarlo).

- [x] **Step 5: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint src/app/actions/matrices.ts src/lib/domain/matrix.ts` y `npx vitest run src/lib/domain/matrix.test.ts`
Expected: sin errores; pruebas en verde.

- [x] **Step 6: Commit**

```bash
git add src/app/actions/matrices.ts src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): acciones de convertir ahora y volver a planificar" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Loader del editor

**Files:**
- Modify: `src/lib/data/matrices.ts`

- [x] **Step 1: `convertedInCycleIds` y usuarios asignables**

En `MatrixEditorData`:

```ts
  /** Piezas `converted` cuyo requerimiento está en el ciclo leído (array: cruza server → client). */
  convertedInCycleIds: string[]
  /** Piezas convertidas cuyo requerimiento fue anulado o borrado. */
  linkedVoidedItemIds: string[]
  assignableUsers: Array<{ id: string; full_name: string; default_assignee: boolean }>
```

En `loadMatrixEditorData`, tras calcular `items` y `cycleRequirements`:

```ts
  // Solo requerimientos que cuentan en computeTotals: si uno se anuló, su pieza debe volver a
  // contarse como planificada en los chips, no desaparecer.
  const countedIds = new Set(cycleRequirements.filter((r) => !r.voided && !r.carried_over).map((r) => r.id))
  const convertedInCycleIds = items
    .filter((i) => i.status === 'converted' && i.requirement_id && countedIds.has(i.requirement_id))
    .map((i) => i.id)
  const usage = computeMatrixUsage(items, limits, convertedInCycleIds)
```

Y `linkedVoidedItemIds` (piezas convertidas cuyo requerimiento fue anulado o ya no existe), con una
query **por ids, sin filtrar por ciclo ni por `approval_status`**: una pieza convertida al ciclo
anterior —el caso que el propio diseño contempla— no aparece en `cycleRequirements`, y filtrando por
ahí se marcaría como anulada sin serlo.

```ts
  const convertedReqIds = items
    .filter((i) => i.status === 'converted' && i.requirement_id)
    .map((i) => i.requirement_id as string)
  let linkedVoidedItemIds: string[] = []
  if (convertedReqIds.length > 0) {
    const { data: reqRows, error: reqErr } = await db.from('requirements').select('id, voided').in('id', convertedReqIds)
    if (reqErr) fail(L, reqErr)
    const alive = new Map((reqRows ?? []).map((r) => [r.id as string, r.voided as boolean]))
    linkedVoidedItemIds = items
      .filter((i) => i.status === 'converted' && i.requirement_id && (alive.get(i.requirement_id) ?? true))
      .map((i) => i.id)   // `?? true`: si el requerimiento ya no existe, cuenta como anulado
  }
```

Ambos campos van en `MatrixEditorData`:

```ts
  convertedInCycleIds: string[]
  /** Piezas convertidas cuyo requerimiento fue anulado o borrado: el editor ofrece replanificar. */
  linkedVoidedItemIds: string[]
```

Y una query más en el `Promise.all` inicial:

```ts
    db.from('users').select('id, full_name, default_assignee').not('role', 'in', '(client,agent)').order('full_name'),
```

con su comprobación de error (`fail(L, …)`) y el mapeo a `assignableUsers` usando `u.full_name || 'Sin nombre'`.

- [x] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` y `npx eslint src/lib/data/matrices.ts`
Expected: sin errores (el editor todavía no usa los campos nuevos; eso es la Task 8).

- [x] **Step 3: Commit**

```bash
git add src/lib/data/matrices.ts
git commit -m "feat(matrices): loader expone piezas convertidas del ciclo y usuarios asignables" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Panel lateral — responsable, estimado y bloqueo por campo

**Files:**
- Modify: `src/components/matrices/MatrixItemSheet.tsx`
- Modify: `src/components/matrices/MatrixEditor.tsx`

- [x] **Step 1: Props nuevas y bloqueo por campo**

Leer el archivo completo antes de tocarlo. Cambios:

1. `Props` gana `assignableUsers: Array<{ id: string; full_name: string }>`.
2. Hoy `MatrixEditor` pasa `readOnly={readOnly || selected?.status === 'converted'}`. Cambiarlo: `readOnly` vuelve a significar solo "matriz cerrada", y el panel calcula `const frozen = readOnly || item.status === 'converted'` para tipo, fecha, responsable y estimado, dejando los textos gobernados por `readOnly`.
3. Debajo del bloque de tipo/fecha/tema/objetivo, dos campos nuevos:

```tsx
<div>
  <span className={labelCls}>Responsable *</span>
  <div className="bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 space-y-1.5 max-h-32 overflow-y-auto">
    {assignableUsers.map((u) => {
      const checked = (item.assigned_to ?? []).includes(u.id)
      return (
        <label key={u.id} className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={checked} disabled={frozen} className="rounded accent-fm-primary"
            onChange={() => {
              const cur = item.assigned_to ?? []
              onPatch({ assigned_to: checked ? cur.filter((id) => id !== u.id) : [...cur, u.id] })
            }} />
          <span className="text-sm text-fm-on-surface">{u.full_name}</span>
        </label>
      )
    })}
  </div>
</div>
<div className="grid grid-cols-2 gap-3">
  <div>
    <label htmlFor="matrix-item-est-h" className={labelCls}>Horas *</label>
    <input id="matrix-item-est-h" type="number" min="0" max="168" value={estHours} disabled={frozen} className={inputCls}
      onChange={(e) => setEstHours(e.target.value)} onBlur={commitEstimate} />
  </div>
  <div>
    <label htmlFor="matrix-item-est-m" className={labelCls}>Minutos *</label>
    <input id="matrix-item-est-m" type="number" min="0" max="59" value={estMins} disabled={frozen} className={inputCls}
      onChange={(e) => setEstMins(e.target.value)} onBlur={commitEstimate} />
  </div>
</div>
{frozen && item.status === 'converted' && (
  <p className="text-[11px] text-fm-on-surface-variant">Ya convertida: el tipo, la fecha, el responsable y el estimado se editan en el requerimiento.</p>
)}
```

Colocar este bloque **después** del párrafo `id="matrix-item-deadline-hint"` (tiene `-mt-2` y se
apoya en el grid anterior; meter campos en medio lo descuadra).

`estHours`/`estMins` son estado local inicializado desde `item.estimated_time_minutes` (el cuerpo ya se monta con `key={item.id}`, así que no hace falta efecto de sincronización). `commitEstimate` calcula `h*60+m` y llama `onPatch({ estimated_time_minutes: total > 0 ? total : null })` solo si cambió.

4. `MatrixEditor` pasa `assignableUsers={data.assignableUsers}` y ajusta `readOnly` como en el punto 2.

- [x] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` y `npx eslint src/components/matrices`
Expected: sin errores.

- [x] **Step 3: Commit**

```bash
git add src/components/matrices/MatrixItemSheet.tsx src/components/matrices/MatrixEditor.tsx
git commit -m "feat(matrices): responsable y tiempo estimado por pieza en el panel lateral" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Tabla de piezas y cabecera

**Files:**
- Modify: `src/components/matrices/MatrixItemsTable.tsx`
- Modify: `src/components/matrices/MatrixHeader.tsx`
- Modify: `src/components/matrices/MatrixEditor.tsx`

- [x] **Step 1: Estado y acciones en la tabla**

Leer el componente antes. Añadir a `Props`: `matrix: ContentMatrix`, `linkedVoidedItemIds: string[]` (piezas convertidas cuyo requerimiento está anulado), `busyItemId: string | null`, `onConvertNow: (id: string) => void`, `onReplan: (id: string) => void`.

Por fila (escritorio y tarjeta móvil):

- Distintivo de estado: Planificada (neutro), Convertida (verde), Bloqueada (rojo), con `MATRIX_ITEM_STATUS_LABELS` nuevo en `matrix.ts` (`planned: 'Planificada'`, `converted: 'Convertida'`, `blocked: 'Bloqueada'`).
- Si `converted` y hay `requirement_id`: enlace `<Link href={\`/pipeline?req=${item.requirement_id}\`}>Ver requerimiento</Link>` — **verificar primero** cómo navega el pipeline a un requerimiento concreto (grep `searchParams` en `src/app/(app)/pipeline/page.tsx`); si no hay un parámetro soportado, enlazar a `/pipeline` sin más y mostrar el título.
- Si `blocked`: el motivo recortado a ~80 caracteres con `title` completo, y botón "Convertir ahora" (deshabilitado mientras `busyItemId === item.id`).
- Si está en `linkedVoidedItemIds`: aviso "Requerimiento anulado" y botón "Volver a planificar (se convertirá de nuevo)".
- Aviso de ciclo: si `convertsBeforePeriodStart(item, matrix)`, un icono o texto discreto con `title="Se convertirá antes de que inicie el período: consumirá el cupo del ciclo anterior."`.

- [x] **Step 2: Cabecera**

En `MatrixHeader`: campo numérico "Anticipación (días)" con `min=0 max=30`, que guarda en `onBlur` vía `onLeadDays(n)` (nuevo prop) → `updateMatrix({ lead_days })`; deshabilitado si la matriz está cerrada. Al lado, contadores "N por convertir · N bloqueadas". `MatrixHeader` **no recibe `items` hoy**: pasarle los dos contadores ya calculados desde `MatrixEditor` (props `plannedCount` y `blockedCount`) en lugar de la lista completa.

- [x] **Step 3: Cableado en `MatrixEditor`**

- `onConvertNow`: llama `convertItemNow`, y según `outcome.kind` actualiza el item en el estado (recargando la pieza con `updateItem`-style no aplica: la acción no devuelve la fila, así que lo más simple es `router.refresh()` **solo aquí**, que es una acción estructural, o volver a pedir la fila). Elegir una y comentar por qué.
- `onReplan`: llama `replanItem` y aplica `r.item`.
- `linkedVoidedItemIds`: ya viene del loader (Task 7). El editor lo mantiene en estado y lo quita de la lista cuando `replanItem` devuelve la pieza replanificada.
- **`computeMatrixUsage` en el cliente**: `MatrixEditor` recalcula el uso con `useMemo(() => computeMatrixUsage(items, data.limits), [items, data.limits])`. Hay que pasarle también `data.convertedInCycleIds` y añadirlo a las dependencias; si no, el chip del servidor y el del cliente divergen en cuanto se edita algo.

- [x] **Step 4: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint src/components/matrices` y `npm run build`
Expected: sin errores.

- [x] **Step 5: Commit**

```bash
git add src/components/matrices src/lib/data/matrices.ts src/lib/domain/matrix.ts
git commit -m "feat(matrices): estado de conversion en la tabla y anticipacion en la cabecera" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9B: Avance de conversión en la lista `/matrices`

**Files:**
- Modify: `src/lib/data/matrices.ts` (`loadMatricesList`)
- Modify: `src/components/matrices/MatricesTable.tsx`

- [x] **Step 1: Desglose por estado en el loader**

`loadMatricesList` hoy devuelve `item_count` y `capacity` por matriz. Añadir a `MatrixListRow`
`converted_count: number` y `blocked_count: number`. El embed actual cuenta filas
(`items:content_matrix_items(count)`); para contar por estado, la forma simple y con precedente es
leer los estados de las piezas de las matrices listadas en una sola query y agregar en JS:

```ts
  const ids = rows.map((r) => r.id)
  const byMatrix = new Map<string, { converted: number; blocked: number }>()
  if (ids.length > 0) {
    const { data: statuses, error } = await db.from('content_matrix_items')
      .select('matrix_id, status').in('matrix_id', ids)
    if (error) fail(L, error)
    for (const s of (statuses ?? []) as Array<{ matrix_id: string; status: MatrixItemStatus }>) {
      const acc = byMatrix.get(s.matrix_id) ?? { converted: 0, blocked: 0 }
      if (s.status === 'converted') acc.converted++
      else if (s.status === 'blocked') acc.blocked++
      byMatrix.set(s.matrix_id, acc)
    }
  }
```

(Con el tope de 1000 matrices de la lista y ~15 piezas por matriz, es una query acotada.)

- [x] **Step 2: Columna y distintivo**

En `MatricesTable`, columna "Convertidas" con `converted_count / item_count` y, si
`blocked_count > 0`, un distintivo rojo "N bloqueada(s)" junto al estado. Mantener el resto de la
tabla como está.

- [x] **Step 3: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint src/lib/data/matrices.ts src/components/matrices` y `npm run build`
Expected: sin errores.

- [x] **Step 4: Commit**

```bash
git add src/lib/data/matrices.ts src/components/matrices/MatricesTable.tsx
git commit -m "feat(matrices): avance de conversion en la lista de matrices" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Brief de la matriz en la ficha del requerimiento

**Files:**
- Create: `src/components/pipeline/MatrixBriefSection.tsx`
- Modify: `src/components/pipeline/PhaseSheet.tsx`

- [ ] **Step 1: El componente**

`'use client'`, recibe `requirementId: string`. Carga con el cliente del navegador (`@/lib/supabase/client`) dentro de un `useEffect` con bandera `cancelled` (patrón ya usado en `MatrixContentCard`):

```ts
const { data } = await supabase
  .from('content_matrix_items')
  .select('id, matrix_id, topic, objective, copy, script, visual_style, hashtags, cta, matrix:content_matrices!inner(id, title)')
  .eq('requirement_id', requirementId)
  .maybeSingle()
```

Para un operador la RLS devuelve 0 filas (no error) → el componente no renderiza nada. Si hay fila, muestra una sección con título "Brief de la matriz", enlace a `/matrices/{matrix_id}`, y los campos no vacíos con sus etiquetas (Tema, Objetivo con `MATRIX_OBJECTIVE_LABELS`, Copy, Guion, Estilo visual, Hashtags, Llamado a la acción), respetando saltos de línea (`whitespace-pre-wrap`).

- [ ] **Step 2: Montarlo**

En `PhaseSheet`, debajo de las notas del requerimiento: `<MatrixBriefSection requirementId={...} />`. Verificar el nombre real de la prop del id en ese componente.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint src/components/pipeline` y `npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/MatrixBriefSection.tsx src/components/pipeline/PhaseSheet.tsx
git commit -m "feat(matrices): brief de la matriz en la ficha del requerimiento" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Aviso de piezas bloqueadas

**Files:**
- Modify: `src/app/api/notifications/route.ts`
- Modify: `src/types/db.ts`
- Modify: `src/components/layout/NotificationsDropdown.tsx`
- Modify: `src/hooks/useNotifications.ts` (o donde viva `unreadCount`; localizarlo con grep)

- [ ] **Step 1: Tipos**

En `NotificationItem` (`src/types/db.ts`): añadir `'matrix_blocked'` al union de `kind` y los campos `matrix_id?`, `matrix_title?`, `matrix_client_name?`, `matrix_blocked_count?`.

- [ ] **Step 2: Derivar el aviso**

En `route.ts`, junto al bloque de `cambio_pending` y con la misma forma (solo `isAdminOrSupervisor`):

```ts
const { data: blockedItems } = await supabase
  .from('content_matrix_items')
  .select('id, matrix_id, updated_at, matrix:content_matrices!inner(id, title, client:clients!inner(name))')
  .eq('status', 'blocked')
  .order('updated_at', { ascending: false })
  .limit(100)
```

Agrupar por `matrix_id` y emitir un item por matriz con `read: false`, `created_at` = el `updated_at` más reciente del grupo, e `id: \`matrix-blocked-${matrixId}\``.

- [ ] **Step 3: Render y contador**

1. En `NotificationsDropdown`, añadir el caso `matrix_blocked`: icono `grid_view`, texto "N pieza(s) bloqueada(s) · {cliente}" con el título de la matriz debajo, y clic → `/matrices/{matrix_id}`. Seguir el patrón exacto de `cambio_pending`.
2. En `useNotifications.ts`, `unreadCount` suma por `kind` con ramas explícitas: **añadir la rama `matrix_blocked`** (cuenta 1 por item, como `cambio_pending`). Sin eso el aviso sale en la lista pero no suma en la campana.
3. En `route.ts`, acordarse de **añadir `matrixBlockedItems` al array final de merge** (junto a `overdueItems`, `cambioPendingItems`, etc.).

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json`, `npx eslint "src/app/api/notifications/route.ts" src/components/layout` y `npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/notifications/route.ts" src/types/db.ts src/components/layout/NotificationsDropdown.tsx
git commit -m "feat(matrices): aviso de piezas bloqueadas en la campana" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Documentación y verificación final

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Documentar**

En la tabla de migraciones, fila `0130` marcada **pendiente de aplicar** (mismo formato que usó 0129 antes de aplicarse). En la sección "Matrices de contenido", subsección nueva "Bloque 2 — conversión automática" con: el barrido (`/api/matrices/convert`, cron `0 12 * * *`, ventana `lead_days`/`CATCHUP_DAYS`, tope 80 y caché de cupo por ciclo), los tres estados de pieza, que **las bloqueadas no se reintentan solas**, que el requerimiento entra **siempre al ciclo vigente** (y la advertencia `convertsBeforePeriodStart`), `over_limit` sin consumir créditos, el rollback con cliente admin y por qué, la guarda de `voided` en `replanItem`, el brief en `PhaseSheet` y que los textos de una pieza convertida siguen editables.

- [ ] **Step 2: Verificación automática completa**

Run, en orden:
```bash
npx vitest run
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build
```
Expected: pruebas solo con la falla conocida de `cycles.test.ts`; 0 errores de tipos; lint sin errores nuevos (comparar contra 49 problemas / 11 errores de la base); build exitoso con las rutas `/matrices`, `/matrices/[id]` y `/api/matrices/convert`.

- [ ] **Step 3: Recorrido manual (requiere 0130 aplicada por el usuario)**

Con admin o supervisor, anotando el resultado de cada punto:

1. Abrir una matriz aprobada, ver la columna de estado y la anticipación en la cabecera.
2. Panel lateral: marcar responsable y poner estimado; intentar aprobar una matriz con una pieza sin responsable → la lista de problemas lo marca.
3. Llamar el barrido a mano y ver el requerimiento en Pendiente con responsable, estimado y fecha; la fila pasa a Convertida con enlace:
   ```bash
   curl -s -X POST -H "x-trigger-secret: $AI_JOBS_TRIGGER_SECRET" https://www.fullefm.site/api/matrices/convert
   ```
   (en local, `http://localhost:3000/...`).
4. Abrir la ficha del requerimiento en el pipeline: se ve "Brief de la matriz"; cambiar el guion en la matriz y recargar → el brief cambió.
5. Cliente con la semana impaga: la pieza queda Bloqueada con el mensaje del trigger, sale el aviso en la campana y "Convertir ahora" muestra el mismo motivo. Marcar el pago y volver a pulsar → convierte.
6. Anular el requerimiento → la fila muestra "Requerimiento anulado"; "Volver a planificar" la devuelve a Planificada. Intentarlo con un requerimiento vivo → error explicando que hay que anularlo primero.
7. Correr el barrido dos veces seguidas → la segunda no crea nada.

- [ ] **Step 4: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: documenta el bloque 2 del creador de matrices" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

No hacer `git push` ni merge sin confirmación explícita del usuario, y solo después de que 0130 esté aplicada.

---

## Fuera de alcance de este plan

`needs_production` no dispara nada; sin reintento automático de bloqueadas; el editor abierto no se refresca solo cuando corre el barrido; el portal del cliente no ve el brief; agrupar piezas en una producción; IA (bloque 3).
