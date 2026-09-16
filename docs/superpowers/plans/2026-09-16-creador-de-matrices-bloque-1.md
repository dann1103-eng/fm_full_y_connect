# Creador de matrices · Bloque 1 (matrices manuales) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que admin y supervisor planifiquen la matriz de contenido mensual de un cliente dentro del CRM (tabla de piezas con copy, guión, estilo, fechas y cupos del plan), con estados borrador/aprobada/cerrada y vínculo automático al requerimiento de tipo matriz del ciclo vigente.

**Architecture:** Dos tablas nuevas (`content_matrices`, `content_matrix_items`) con RLS para admin/supervisor. Lógica pura en `src/lib/domain/matrix.ts` (períodos objetivo, cupos efectivos, marca fuera de plan, fecha propuesta, transiciones) con pruebas vitest. Server actions en `src/app/actions/matrices.ts`, loaders en `src/lib/data/matrices.ts`, páginas `/matrices` y `/matrices/[id]` con editor tabla + panel lateral, tarjeta en el perfil del cliente.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind 4 · shadcn/ui (`dialog`, `sheet`) · Supabase (Postgres + RLS) · vitest · date-fns.

**Spec:** `docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md` — leerla completa antes de empezar. Cualquier duda de comportamiento se resuelve ahí.

**Reglas del repo que aplican (de `CLAUDE.md`):**
- Tipos de DB se editan a mano en `src/types/db.ts`.
- Migraciones SQL numeradas en `supabase/migrations/`, se aplican a mano en el dashboard de Supabase.
- Server components / actions: `createClient` de `@/lib/supabase/server` (async). Client components: `@/lib/supabase/client` (sync). Admin: `createAdminClient` de `@/lib/supabase/admin`.
- ESLint: no `setState` síncrono en el body de `useEffect` (derivar con `useMemo`); no `Date.now()` en render.
- Commits en español: `feat|fix|docs|chore: mensaje`. Terminar cada commit con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **No hacer `git push` sin confirmación del usuario.**
- `npm run lint` con 0 errores nuevos y `npm run build` limpio antes del commit final.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/domain/weekly-distribution.ts` (modificar) | Parámetro `weeks` en `augmentDistribution` / `applyOverride` / `addRollover`; nueva `buildEffectiveDistribution` |
| `src/lib/domain/weekly-distribution.test.ts` (modificar) | Pruebas de 8 semanas y paridad |
| `src/lib/domain/matrix.ts` (crear) | Constantes, `computeTargetPeriods`, `resolveMatrixLimits`, `computeMatrixUsage`, `proposeDeadline`, transiciones, validaciones, `shiftDeadline`, `matrixTitleFor` |
| `src/lib/domain/matrix.test.ts` (crear) | Pruebas unitarias del dominio |
| `supabase/migrations/0129_content_matrices.sql` (crear) | Tablas, índices, triggers, RLS |
| `src/types/db.ts` (modificar) | Tipos de tablas, `MatrixStatus`, `MatrixItemStatus`, `MatrixObjective`, `MatrixTopic`, aliases |
| `src/lib/domain/permissions.ts` (modificar) | `canManageMatrices` |
| `src/lib/data/matrices.ts` (crear) | Loaders de servidor: editor, lista, faltantes, tarjeta del cliente |
| `src/app/actions/matrices.ts` (crear) | Server actions (matriz, piezas, estado, vínculo, duplicar, períodos) |
| `src/components/matrices/MatrixChips.tsx` (crear) | Chips de cupo (compartidos por cabecera y tabla) |
| `src/components/matrices/NewMatrixDialog.tsx` (crear) | Diálogo de creación |
| `src/components/matrices/MatricesTable.tsx` (crear) | Lista con filtros |
| `src/components/matrices/MissingMatricesPanel.tsx` (crear) | Clientes sin matriz para el próximo ciclo |
| `src/components/matrices/MatrixEditor.tsx` (crear) | Estado del editor, mutaciones optimistas |
| `src/components/matrices/MatrixHeader.tsx` (crear) | Cabecera: título, estado, chips, acciones, franja de vínculo |
| `src/components/matrices/MatrixTopicsBar.tsx` (crear) | Temas del mes editables |
| `src/components/matrices/MatrixItemsTable.tsx` (crear) | Tabla de piezas (tarjetas en móvil) + selector "Agregar pieza" |
| `src/components/matrices/MatrixItemSheet.tsx` (crear) | Panel lateral de edición de una pieza |
| `src/app/(app)/matrices/page.tsx` (crear) | Página lista |
| `src/app/(app)/matrices/[id]/page.tsx` (crear) | Página editor |
| `src/components/clients/ClientMatricesCard.tsx` (crear) | Tarjeta en el perfil del cliente |
| `src/app/(app)/clients/[id]/page.tsx` (modificar) | Inserta la tarjeta |
| `src/components/layout/Sidebar.tsx` (modificar) | Entrada "Matrices" |
| `src/components/clients/RequirementPanel.tsx` (modificar) | Usa `buildEffectiveDistribution` |
| `CLAUDE.md` (modificar) | Documenta módulo y migración 0129 |

---

### Task 1: Parámetro `weeks` en la distribución semanal

**Files:**
- Modify: `src/lib/domain/weekly-distribution.ts`
- Test: `src/lib/domain/weekly-distribution.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `src/lib/domain/weekly-distribution.test.ts` (los imports existentes ya traen `augmentDistribution`, `applyOverride`, `addRollover`, `EMPTY_LIMITS`):

```ts
import { WEEKS_BIMONTHLY } from '@/types/db'

describe('parámetro weeks (soporte 8 semanas)', () => {
  it('augmentDistribution con 8 semanas reparte ceil(limit/8) en S1..S8', () => {
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, estatico: 8, reel: 3 }
    const result = augmentDistribution({}, ['estatico', 'reel'], limits, WEEKS_BIMONTHLY)
    expect(Object.keys(result)).toEqual([...WEEKS_BIMONTHLY])
    expect(result.S5).toEqual({ estatico: 1, reel: 1 })
    expect(result.S8).toEqual({ estatico: 1, reel: 1 })
  })

  it('augmentDistribution sin weeks mantiene 4 semanas y ceil(limit/4)', () => {
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, estatico: 8 }
    const result = augmentDistribution({}, ['estatico'], limits)
    expect(Object.keys(result)).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(result.S1).toEqual({ estatico: 2 })
  })

  it('applyOverride con 8 semanas conserva S5..S8 y aplica el override ahí', () => {
    const base: WeeklyDistribution = { S1: { estatico: 1 }, S5: { estatico: 1 }, S8: { estatico: 1 } }
    const result = applyOverride(base, { S8: { estatico: 3 } }, WEEKS_BIMONTHLY)
    expect(result.S5).toEqual({ estatico: 1 })
    expect(result.S8).toEqual({ estatico: 3 })
  })

  it('addRollover con 8 semanas reparte 5 → 1,1,1,1,1,0,0,0', () => {
    const base: WeeklyDistribution = {}
    const result = addRollover(base, { estatico: 5 }, WEEKS_BIMONTHLY)
    expect([result.S1, result.S2, result.S3, result.S4, result.S5, result.S6, result.S7, result.S8]
      .map((w) => w?.estatico ?? 0)).toEqual([1, 1, 1, 1, 1, 0, 0, 0])
  })
})
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx vitest run src/lib/domain/weekly-distribution.test.ts`
Expected: FAIL — las funciones ignoran el cuarto/tercer argumento (`Object.keys(result)` da 4 semanas; `result.S5` es `undefined`).

- [ ] **Step 3: Implementar el parámetro `weeks`**

En `src/lib/domain/weekly-distribution.ts` reemplazar la constante y las tres funciones:

```ts
import { WEEKS_BASE } from '@/types/db'
import type { ContentType, WeekKey, WeeklyDistribution } from '@/types/db'

const WEEKS: ReadonlyArray<WeekKey> = WEEKS_BASE

/**
 * Rellena tipos que la distribución base no cubre, usando `ceil(limit/weeks.length)` como fallback.
 * Sólo considera los `pipelineTypes`. `weeks` default S1..S4; pasar `WEEKS_BIMONTHLY` para 8 semanas.
 */
export function augmentDistribution(
  baseDist: WeeklyDistribution,
  pipelineTypes: ContentType[],
  limits: Record<ContentType, number>,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of weeks) {
    result[w] = {}
    for (const type of pipelineTypes) {
      const explicit = baseDist[w]?.[type]
      if (explicit !== undefined) {
        if (explicit > 0) result[w]![type] = explicit
      } else {
        const fallback = Math.ceil(limits[type] / weeks.length)
        if (fallback > 0) result[w]![type] = fallback
      }
    }
  }
  return result
}

export function applyOverride(
  dist: WeeklyDistribution,
  override: WeeklyDistribution | null | undefined,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  if (!override) return dist
  const result: WeeklyDistribution = {}
  for (const w of weeks) {
    const base = dist[w] ?? {}
    const over = override[w] ?? {}
    result[w] = { ...base, ...over }
  }
  return result
}

export function addRollover(
  dist: WeeklyDistribution,
  rollover: Partial<Record<ContentType, number>>,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  const n = weeks.length
  const result: WeeklyDistribution = {}
  for (const w of weeks) result[w] = { ...(dist[w] ?? {}) }

  for (const [type, rawAmount] of Object.entries(rollover) as [ContentType, number][]) {
    const amount = Math.max(0, Math.floor(rawAmount ?? 0))
    if (amount === 0) continue
    const base = Math.floor(amount / n)
    const residue = amount % n
    for (let i = 0; i < n; i++) {
      const add = base + (i < residue ? 1 : 0)
      if (add === 0) continue
      const cur = result[weeks[i]]![type] ?? 0
      result[weeks[i]]![type] = cur + add
    }
  }
  return result
}
```

`buildProrateOverride` y `buildAccumulateOverride` no cambian (siguen usando `WEEKS`; `ReadonlyArray` soporta `.reduce` e indexación).

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/weekly-distribution.test.ts`
Expected: PASS (todas, incluidas las anteriores).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/weekly-distribution.ts src/lib/domain/weekly-distribution.test.ts
git commit -m "feat: distribución semanal acepta 8 semanas via parámetro weeks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `buildEffectiveDistribution` y refactor de `RequirementPanel`

**Files:**
- Modify: `src/lib/domain/weekly-distribution.ts`
- Modify: `src/components/clients/RequirementPanel.tsx:244-263`
- Test: `src/lib/domain/weekly-distribution.test.ts`

- [ ] **Step 1: Escribir la prueba de paridad que falla**

Añadir a `weekly-distribution.test.ts`:

```ts
// Añadir `buildEffectiveDistribution` al import existente de './weekly-distribution' en la cabecera del test.

describe('buildEffectiveDistribution', () => {
  it('equivale a resolve → augment → override → rollover', () => {
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, estatico: 4, reel: 2 }
    // S3/S4 con cero EXPLÍCITO: augmentDistribution solo respeta el 0 explícito; `{}` caería al fallback ceil(4/4)=1.
    const clientDist: WeeklyDistribution = { S1: { estatico: 2 }, S2: { estatico: 2 }, S3: { estatico: 0 }, S4: { estatico: 0 } }
    const result = buildEffectiveDistribution({
      clientDistribution: clientDist,
      planDistribution: { S1: { estatico: 9 } },      // ignorado: gana la del cliente
      pipelineTypes: ['estatico', 'reel'],
      limits,
      cycleOverride: { S4: { reel: 2 } },
      rollover: { estaticos: 3 },                       // 3 → 1,1,1,0
    })
    expect(result.S1).toEqual({ estatico: 3, reel: 1 })  // 2 + rollover 1
    expect(result.S2).toEqual({ estatico: 3, reel: 1 })
    expect(result.S3).toEqual({ estatico: 1, reel: 1 })  // solo rollover
    expect(result.S4).toEqual({ reel: 2 })               // override
  })

  it('sin distribución de cliente ni plan usa el fallback y respeta weeks', () => {
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, short: 8 }
    const result = buildEffectiveDistribution({
      clientDistribution: null,
      planDistribution: null,
      pipelineTypes: ['short'],
      limits,
      weeks: WEEKS_BIMONTHLY,
    })
    expect(result.S8).toEqual({ short: 1 })
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/weekly-distribution.test.ts`
Expected: FAIL — `buildEffectiveDistribution is not a function`.

- [ ] **Step 3: Implementar**

Al final de `src/lib/domain/weekly-distribution.ts` (añadir `PlanLimits` al import de tipos y `rolloverToContentType` desde `./plans`):

```ts
import { rolloverToContentType } from './plans'
import type { PlanLimits } from '@/types/db'

export interface EffectiveDistributionInput {
  clientDistribution: WeeklyDistribution | null | undefined
  planDistribution: WeeklyDistribution | null | undefined
  pipelineTypes: ContentType[]
  /** Límites ya con content_limits_override_json aplicado. */
  limits: Record<ContentType, number>
  cycleOverride?: WeeklyDistribution | null
  rollover?: Partial<PlanLimits> | null
  weeks?: ReadonlyArray<WeekKey>
}

/**
 * Cadena completa: default (cliente → plan) → augment → override del ciclo → rollover.
 * Es la misma secuencia que usaba inline RequirementPanel; centralizada para reuso.
 */
export function buildEffectiveDistribution(input: EffectiveDistributionInput): WeeklyDistribution {
  const weeks = input.weeks ?? WEEKS
  const base = input.clientDistribution ?? input.planDistribution ?? {}
  const augmented = augmentDistribution(base, input.pipelineTypes, input.limits, weeks)
  const overridden = applyOverride(augmented, input.cycleOverride ?? null, weeks)
  return addRollover(overridden, rolloverToContentType(input.rollover), weeks)
}
```

(`plans.ts` solo importa tipos, así que no hay import circular.)

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain`
Expected: PASS — las nuevas y todas las antiguas de `weekly-distribution.test.ts` (el parámetro `weeks` por defecto no cambia el comportamiento).

- [ ] **Step 5: Refactorizar `RequirementPanel` para usar la función**

En `src/components/clients/RequirementPanel.tsx`, reemplazar el bloque de las líneas ~254-263 (desde `const baseDist = resolveDistribution(` hasta `const effectiveDist = addRollover(...)`) por:

```ts
  const effectiveDist = buildEffectiveDistribution({
    clientDistribution: (client as { weekly_distribution_json?: import('@/types/db').WeeklyDistribution | null }).weekly_distribution_json,
    planDistribution: client.plan?.default_weekly_distribution_json,
    pipelineTypes,
    limits: limitsForDist,
    cycleOverride: (cycle as { weekly_distribution_override_json?: import('@/types/db').WeeklyDistribution | null }).weekly_distribution_override_json,
    rollover: cycle.rollover_from_previous_json,
  })
```

Cambiar el import de la línea 19 a `import { buildEffectiveDistribution } from '@/lib/domain/weekly-distribution'`. Luego quitar de los imports de `@/lib/domain/requirement` y `@/lib/domain/plans` los símbolos que queden sin uso (`resolveDistribution`, `rolloverToContentType`): verificar con `grep -n "resolveDistribution\|rolloverToContentType" src/components/clients/RequirementPanel.tsx` y borrar solo si no hay otro uso.

- [ ] **Step 6: Lint y verificación rápida**

Run: `npm run lint`
Expected: 0 errores nuevos (si aparece "defined but never used", quitar ese import).

- [ ] **Step 7: Commit**

```bash
git add src/lib/domain/weekly-distribution.ts src/lib/domain/weekly-distribution.test.ts src/components/clients/RequirementPanel.tsx
git commit -m "refactor: buildEffectiveDistribution centraliza la cadena de distribución semanal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Dominio — constantes, períodos objetivo y título

**Files:**
- Create: `src/lib/domain/matrix.ts`
- Create: `src/lib/domain/matrix.test.ts`

> Los tipos `MatrixStatus`, `MatrixObjective`, `MatrixTopic`, `ContentMatrixItem` se crean en la Task 9. Para que este módulo compile antes, la Task 9 puede adelantarse **solo en su Step 1** (tipos base) si el ejecutor lo prefiere; si no, `npx vitest` igual corre (vitest no bloquea por tipos) y `tsc` se valida en la Task 9.

- [ ] **Step 1: Escribir las pruebas que fallan**

`src/lib/domain/matrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeTargetPeriods, matrixTitleFor, periodLabel } from './matrix'

describe('computeTargetPeriods', () => {
  it('con ciclo vigente mensual encadena 4 períodos', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-10-15', period_end: '2026-11-14' },
      billingDay: 15, billingPeriod: 'monthly', today: '2026-10-20',
    })
    expect(r).toHaveLength(4)
    expect(r[0]).toMatchObject({ periodStart: '2026-10-15', periodEnd: '2026-11-14', isCurrent: true })
    expect(r[1]).toMatchObject({ periodStart: '2026-11-15', periodEnd: '2026-12-14', isCurrent: false })
    expect(r[3].periodStart).toBe('2027-01-15')
  })

  it('ajusta a fin de mes (31 ene → 27 feb → 27 mar)', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-01-31', period_end: '2026-02-27' },
      billingDay: 31, billingPeriod: 'monthly', today: '2026-02-01', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-02-28', periodEnd: '2026-03-27' })
  })

  it('quincenal: 14 días por período', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-09-01', period_end: '2026-09-14' },
      billingDay: 1, billingPeriod: 'biweekly', today: '2026-09-05', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-09-15', periodEnd: '2026-09-28' })
  })

  it('bimestral: 60 días por período', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-09-01', period_end: '2026-10-30' },
      billingDay: 1, billingPeriod: 'bimonthly', today: '2026-09-05', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-10-31', periodEnd: '2026-12-29' })
  })

  it('sin ciclo vigente parte del billing_day', () => {
    const r = computeTargetPeriods({ currentCycle: null, billingDay: 15, billingPeriod: 'monthly', today: '2026-09-16', count: 2 })
    expect(r[0]).toMatchObject({ periodStart: '2026-09-15', periodEnd: '2026-10-14', isCurrent: true })
    expect(r[1].periodStart).toBe('2026-10-15')
  })
})

describe('periodLabel / matrixTitleFor', () => {
  it('etiqueta corta con año', () => {
    expect(periodLabel('2026-10-15', '2026-11-14')).toBe('15 oct al 14 nov 2026')
  })
  it('título usa el mes dominante', () => {
    expect(matrixTitleFor('2026-10-15', '2026-11-14')).toBe('Matriz octubre 2026')
    expect(matrixTitleFor('2026-10-20', '2026-11-19')).toBe('Matriz noviembre 2026')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL — `Failed to resolve import "./matrix"`.

- [ ] **Step 3: Crear el módulo con constantes y períodos**

`src/lib/domain/matrix.ts`:

```ts
import type {
  BillingCycle, BillingPeriod, ContentMatrixItem, ContentType, MatrixObjective,
  MatrixStatus, MatrixTopic, Plan, Requirement, WeeklyDistribution,
} from '@/types/db'
import { WEEKS_BASE, WEEKS_BIMONTHLY } from '@/types/db'
import { effectiveLimits, applyContentLimitsWithOverride, limitsToRecord, TIPPABLE_CONTENT_TYPES, CONTENT_TYPES } from './plans'
import { computeTotals, weekIndexInCycle, dominantCycleMonth } from './requirement'
import { firstCycleDates, nextCycleDates, currentCycleDates } from './cycles'
import { addDaysString, daysBetween, type DateString } from './dates'
import { formatDeadlineDate } from './deadline'

// ── Constantes ──────────────────────────────────────────────────────────────

/** Tipos que se planifican en una matriz (producción, reunión y matriz no). */
export const MATRIX_CONTENT_TYPES: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short']

export const MATRIX_OBJECTIVES: MatrixObjective[] = ['venta', 'alcance', 'educacion', 'comunidad', 'otro']

export const MATRIX_OBJECTIVE_LABELS: Record<MatrixObjective, string> = {
  venta: 'Venta', alcance: 'Alcance', educacion: 'Educación', comunidad: 'Comunidad', otro: 'Otro',
}

export const MATRIX_STATUS_LABELS: Record<MatrixStatus, string> = {
  draft: 'Borrador', approved: 'Aprobada', closed: 'Cerrada',
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const ZERO_TOTALS: Record<ContentType, number> = {
  historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 0,
}

// ── Períodos objetivo ───────────────────────────────────────────────────────

export interface TargetPeriod {
  periodStart: DateString
  periodEnd: DateString
  label: string
  isCurrent: boolean
}

export interface TargetPeriodsInput {
  currentCycle: { period_start: DateString; period_end: DateString } | null
  billingDay: number
  billingPeriod: BillingPeriod
  today: DateString
  count?: number
}

/** "15 oct al 14 nov 2026" */
export function periodLabel(periodStart: DateString, periodEnd: DateString): string {
  return `${formatDeadlineDate(periodStart)} al ${formatDeadlineDate(periodEnd)} ${periodEnd.slice(0, 4)}`
}

/** "Matriz octubre 2026" — mes con más días dentro del período. */
export function matrixTitleFor(periodStart: DateString, periodEnd: DateString): string {
  const { year, month } = dominantCycleMonth(periodStart, periodEnd)
  return `Matriz ${MONTHS_ES[month]} ${year}`
}

/**
 * Ciclo vigente + N-1 siguientes. Sin ciclo vigente, se calcula desde billing_day
 * (ancla mensual de `currentCycleDates`, aproximación intencional para quincenal).
 */
export function computeTargetPeriods(input: TargetPeriodsInput): TargetPeriod[] {
  const count = input.count ?? 4
  const opts = { billingPeriod: input.billingPeriod }
  let cur: { periodStart: DateString; periodEnd: DateString }
  if (input.currentCycle) {
    cur = { periodStart: input.currentCycle.period_start, periodEnd: input.currentCycle.period_end }
  } else {
    const { periodStart } = currentCycleDates(input.billingDay, input.today)
    cur = firstCycleDates(periodStart, opts)
  }
  const out: TargetPeriod[] = []
  for (let i = 0; i < count; i++) {
    out.push({ ...cur, label: periodLabel(cur.periodStart, cur.periodEnd), isCurrent: i === 0 })
    cur = nextCycleDates(cur.periodEnd, opts)
  }
  return out
}
```

(Los imports de `BillingCycle`, `Plan`, `Requirement`, `ContentMatrixItem`, `WeeklyDistribution`, `WEEKS_*`, `effectiveLimits`, etc. se usan en las Tasks 4–7; ESLint marcará "unused" hasta entonces — es aceptable dentro de la misma rama de trabajo, pero si se quiere lint limpio por commit, añadirlos en la task que los usa.)

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: PASS (9 pruebas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): dominio base — constantes, períodos objetivo y título

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Dominio — `resolveMatrixLimits`

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [ ] **Step 1: Pruebas que fallan**

Añadir a `matrix.test.ts`:

```ts
import { resolveMatrixLimits } from './matrix'
import type { BillingCycle, Plan, Requirement } from '@/types/db'

const PLAN_LIMITS = { historias: 4, estaticos: 4, videos_cortos: 2, reels: 2, shorts: 4, producciones: 1, reuniones: 1, matrices_contenido: 1 }
const plan = { id: 'p1', limits_json: PLAN_LIMITS, unified_content_limit: null } as unknown as Plan
const poolPlan = { id: 'p2', limits_json: { ...PLAN_LIMITS, historias: 0, estaticos: 0, videos_cortos: 0, reels: 0, shorts: 0 }, unified_content_limit: 10 } as unknown as Plan

function cycleWith(extra: Partial<BillingCycle>): BillingCycle {
  return {
    id: 'c1', limits_snapshot_json: PLAN_LIMITS, rollover_from_previous_json: null,
    content_limits_override_json: null, ...extra,
  } as unknown as BillingCycle
}
function req(content_type: Requirement['content_type'], extra: Partial<Requirement> = {}): Requirement {
  return { id: Math.random().toString(), content_type, voided: false, carried_over: false, includes_story: false, consumption_overrides_json: null, ...extra } as unknown as Requirement
}

describe('resolveMatrixLimits', () => {
  it('con ciclo: snapshot + rollover + override, totales del ciclo', () => {
    const cycle = cycleWith({ rollover_from_previous_json: { estaticos: 2 }, content_limits_override_json: { reel: 5 } })
    const r = resolveMatrixLimits({ cycle, plan, cycleRequirements: [req('estatico'), req('estatico', { voided: true })], credits: { short: 1 } })
    expect(r.estimated).toBe(false)
    expect(r.limits.estatico).toBe(6)     // 4 + rollover 2
    expect(r.limits.reel).toBe(5)         // override
    expect(r.cycleTotals.estatico).toBe(1) // la anulada no cuenta
    expect(r.credits.short).toBe(1)
    expect(r.unifiedPool).toBeNull()
  })

  it('sin ciclo: límites del plan actual, estimado', () => {
    const r = resolveMatrixLimits({ cycle: null, plan, cycleRequirements: [], credits: {} })
    expect(r.estimated).toBe(true)
    expect(r.limits.estatico).toBe(4)
    expect(r.cycleTotals.estatico).toBe(0)
  })

  it('pool unificado: lo toma del snapshot o del plan', () => {
    const withCycle = resolveMatrixLimits({ cycle: cycleWith({ limits_snapshot_json: { ...PLAN_LIMITS, unified_content_limit: 12 } }), plan, cycleRequirements: [], credits: {} })
    expect(withCycle.unifiedPool).toBe(12)
    const noCycle = resolveMatrixLimits({ cycle: null, plan: poolPlan, cycleRequirements: [], credits: {} })
    expect(noCycle.unifiedPool).toBe(10)
    expect(noCycle.limits.estatico).toBe(0)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL — `resolveMatrixLimits` no existe.

- [ ] **Step 3: Implementar**

Añadir a `matrix.ts`:

```ts
// ── Cupos ───────────────────────────────────────────────────────────────────

export interface MatrixLimitsInput {
  cycle: BillingCycle | null
  plan: Plan
  cycleRequirements: Requirement[]
  credits: Partial<Record<ContentType, number>>
}

export interface MatrixLimits {
  limits: Record<ContentType, number>
  cycleTotals: Record<ContentType, number>
  credits: Partial<Record<ContentType, number>>
  unifiedPool: number | null
  estimated: boolean
}

export function resolveMatrixLimits(input: MatrixLimitsInput): MatrixLimits {
  if (input.cycle) {
    const base = effectiveLimits(input.cycle.limits_snapshot_json, input.cycle.rollover_from_previous_json)
    const limits = applyContentLimitsWithOverride(
      base,
      (input.cycle.content_limits_override_json ?? null) as Record<string, number> | null,
    )
    return {
      limits,
      cycleTotals: computeTotals(input.cycleRequirements),
      credits: input.credits,
      unifiedPool: input.cycle.limits_snapshot_json.unified_content_limit ?? null,
      estimated: false,
    }
  }
  return {
    limits: limitsToRecord(input.plan.limits_json),
    cycleTotals: { ...ZERO_TOTALS },
    credits: input.credits,
    unifiedPool: input.plan.unified_content_limit ?? null,
    estimated: true,
  }
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): resolveMatrixLimits — cupos efectivos con o sin ciclo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Dominio — `computeMatrixUsage` (fuera de plan, pool, tipos activos)

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [ ] **Step 1: Pruebas que fallan**

Añadir a `matrix.test.ts`:

```ts
import { computeMatrixUsage, usageTone } from './matrix'
import type { MatrixLimits } from './matrix'

type UItem = { id: string; content_type: Requirement['content_type']; deadline: string; created_at: string; status: 'planned' | 'converted' | 'blocked' }
function item(id: string, content_type: UItem['content_type'], deadline: string, status: UItem['status'] = 'planned'): UItem {
  return { id, content_type, deadline, created_at: `2026-09-01T00:00:${id.padStart(2, '0')}Z`, status }
}
const baseML: MatrixLimits = {
  limits: { historia: 2, estatico: 2, video_corto: 1, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 1 },
  cycleTotals: { historia: 0, estatico: 1, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 0 },
  credits: {}, unifiedPool: null, estimated: false,
}

describe('computeMatrixUsage', () => {
  it('marca fuera de plan en orden de fecha, contando lo ya consumido en el ciclo', () => {
    const items = [item('1', 'estatico', '2026-10-20'), item('2', 'estatico', '2026-10-17'), item('3', 'estatico', '2026-10-25')]
    const u = computeMatrixUsage(items, baseML)
    // cupo 2, ya consumido 1 → solo cabe 1 más: la más temprana (id 2)
    expect(u.overPlanItemIds).toEqual(['1', '3'])
    expect(u.byType.estatico).toMatchObject({ planned: 3, used: 4, limit: 2, over: 2 })
  })

  it('los créditos amplían el cupo', () => {
    const items = [item('1', 'estatico', '2026-10-17'), item('2', 'estatico', '2026-10-18')]
    const u = computeMatrixUsage(items, { ...baseML, credits: { estatico: 1 } })
    expect(u.overPlanItemIds).toEqual([])
  })

  it('excluye piezas convertidas del conteo planificado', () => {
    const items = [item('1', 'estatico', '2026-10-17', 'converted'), item('2', 'estatico', '2026-10-18')]
    const u = computeMatrixUsage(items, baseML)
    expect(u.byType.estatico.planned).toBe(1)
    expect(u.overPlanItemIds).toEqual([])
  })

  it('pool unificado: contador compartido; historia fuera del pool con límite 0', () => {
    const ml: MatrixLimits = {
      ...baseML,
      limits: { ...baseML.limits, historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
      cycleTotals: { ...baseML.cycleTotals, estatico: 0 },
      unifiedPool: 2,
    }
    const items = [item('1', 'estatico', '2026-10-17'), item('2', 'reel', '2026-10-18'), item('3', 'short', '2026-10-19'), item('4', 'historia', '2026-10-20')]
    const u = computeMatrixUsage(items, ml)
    expect(u.pool).toEqual({ used: 3, limit: 2, credits: 0 })
    expect(u.overPlanItemIds).toEqual(['3', '4'])
    expect(u.activeTypes).toEqual(['historia', 'estatico', 'video_corto', 'reel', 'short']) // historia por planned > 0
  })

  it('tipos activos: limit > 0 || credits > 0 || planned > 0', () => {
    const u = computeMatrixUsage([item('1', 'short', '2026-10-17')], { ...baseML, credits: { reel: 1 } })
    expect(u.activeTypes).toEqual(['historia', 'estatico', 'video_corto', 'reel', 'short'])
    const u2 = computeMatrixUsage([], baseML)
    expect(u2.activeTypes).toEqual(['historia', 'estatico', 'video_corto'])
  })
})

describe('usageTone', () => {
  it('verde al llenar, rojo al pasarse contando créditos, neutro en el resto', () => {
    expect(usageTone(2, 2, 0)).toBe('full')
    expect(usageTone(3, 2, 0)).toBe('over')
    expect(usageTone(3, 2, 1)).toBe('neutral')
    expect(usageTone(1, 2, 0)).toBe('neutral')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL — `computeMatrixUsage` no existe.

- [ ] **Step 3: Implementar**

Añadir a `matrix.ts`:

```ts
// ── Uso y marca fuera de plan ───────────────────────────────────────────────

export interface MatrixUsageByType {
  planned: number
  used: number
  limit: number
  credits: number
  over: number
}

export interface MatrixUsage {
  byType: Record<ContentType, MatrixUsageByType>
  pool: { used: number; limit: number; credits: number } | null
  /** Ids de piezas que exceden el cupo (array, no Set: cruza la frontera server → client). */
  overPlanItemIds: string[]
  /** Tipos que muestran chip y alimentan el selector "Agregar pieza". */
  activeTypes: ContentType[]
}

export type UsageItem = Pick<ContentMatrixItem, 'id' | 'content_type' | 'deadline' | 'created_at' | 'status'>

export type UsageTone = 'neutral' | 'full' | 'over'

export function usageTone(used: number, limit: number, credits: number): UsageTone {
  if (used > limit + credits) return 'over'
  if (used === limit) return 'full'
  return 'neutral'
}

function isPoolType(t: ContentType): boolean {
  return (TIPPABLE_CONTENT_TYPES as ContentType[]).includes(t)
}

export function computeMatrixUsage(items: UsageItem[], ml: MatrixLimits): MatrixUsage {
  const planned: Record<ContentType, number> = { ...ZERO_TOTALS }
  for (const it of items) if (it.status !== 'converted') planned[it.content_type] += 1

  const byType = {} as Record<ContentType, MatrixUsageByType>
  for (const t of CONTENT_TYPES) {
    const limit = ml.limits[t] ?? 0
    const credits = ml.credits[t] ?? 0
    const used = (ml.cycleTotals[t] ?? 0) + planned[t]
    byType[t] = { planned: planned[t], used, limit, credits, over: Math.max(0, used - limit - credits) }
  }

  const pool = ml.unifiedPool != null
    ? {
        used: TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + byType[t].used, 0),
        limit: ml.unifiedPool,
        credits: TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (ml.credits[t] ?? 0), 0),
      }
    : null

  const sorted = items
    .filter((i) => i.status !== 'converted')
    .slice()
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.created_at.localeCompare(b.created_at))

  const counters: Record<ContentType, number> = { ...ml.cycleTotals }
  let poolCounter = pool ? TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (ml.cycleTotals[t] ?? 0), 0) : 0
  const overPlanItemIds: string[] = []
  for (const it of sorted) {
    const t = it.content_type
    if (pool && isPoolType(t)) {
      poolCounter += 1
      if (poolCounter > pool.limit + pool.credits) overPlanItemIds.push(it.id)
    } else {
      counters[t] = (counters[t] ?? 0) + 1
      if (counters[t] > (ml.limits[t] ?? 0) + (ml.credits[t] ?? 0)) overPlanItemIds.push(it.id)
    }
  }

  const activeTypes = MATRIX_CONTENT_TYPES.filter((t) => {
    if (pool && isPoolType(t)) return true
    const u = byType[t]
    return u.limit > 0 || u.credits > 0 || u.planned > 0
  })

  return { byType, pool, overPlanItemIds, activeTypes }
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): computeMatrixUsage — fuera de plan, pool unificado y tipos activos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Dominio — `proposeDeadline` y `limitsForDistribution`

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [ ] **Step 1: Pruebas que fallan**

```ts
import { proposeDeadline, limitsForDistribution } from './matrix'
import { buildEffectiveDistribution } from './weekly-distribution'
import { WEEKS_BIMONTHLY } from '@/types/db'

describe('proposeDeadline', () => {
  const dist = { S1: { estatico: 1 }, S2: { estatico: 1 }, S3: {}, S4: { estatico: 1 } }
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14', maxWeek: 4 as const }

  it('primera semana con hueco → inicio + 2 días', () => {
    expect(proposeDeadline({ contentType: 'estatico', items: [], distribution: dist, ...period })).toBe('2026-10-17')
  })
  it('S1 ocupada → S2', () => {
    const items = [{ content_type: 'estatico' as const, deadline: '2026-10-16' }]
    expect(proposeDeadline({ contentType: 'estatico', items, distribution: dist, ...period })).toBe('2026-10-24')
  })
  it('sin hueco en ninguna → última semana', () => {
    const items = [
      { content_type: 'estatico' as const, deadline: '2026-10-16' },
      { content_type: 'estatico' as const, deadline: '2026-10-23' },
      { content_type: 'estatico' as const, deadline: '2026-11-06' },
    ]
    expect(proposeDeadline({ contentType: 'estatico', items, distribution: dist, ...period })).toBe('2026-11-07')
  })
  it('recorta a period_end (quincenal con 4 semanas)', () => {
    const r = proposeDeadline({ contentType: 'reel', items: [], distribution: {}, periodStart: '2026-09-01', periodEnd: '2026-09-14', maxWeek: 4 })
    expect(r).toBe('2026-09-14')
  })
  it('tipos compartidos (pool) cuentan juntos en la semana', () => {
    const d = { S1: { estatico: 1, reel: 1 }, S2: { estatico: 1, reel: 1 }, S3: {}, S4: {} }
    const items = [{ content_type: 'reel' as const, deadline: '2026-10-16' }]
    const r = proposeDeadline({ contentType: 'estatico', items, distribution: d, ...period, sharedTypes: ['estatico', 'video_corto', 'reel', 'short'] })
    expect(r).toBe('2026-10-24') // S1 ya tiene 1 pieza del pool
  })
  it('8 semanas: propone en S5..S8 cuando la distribución las trae', () => {
    const limits = { historia: 0, estatico: 8, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 1 }
    const d = buildEffectiveDistribution({ clientDistribution: null, planDistribution: null, pipelineTypes: ['estatico'], limits, weeks: WEEKS_BIMONTHLY })
    const items = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23'].map((deadline) => ({ content_type: 'estatico' as const, deadline }))
    const r = proposeDeadline({ contentType: 'estatico', items, distribution: d, periodStart: '2026-09-01', periodEnd: '2026-10-30', maxWeek: 8 })
    expect(r).toBe('2026-10-01') // S5: 01-sep + 28 + 2
  })
})

describe('limitsForDistribution', () => {
  it('sin pool devuelve los límites tal cual', () => {
    expect(limitsForDistribution(baseML)).toEqual(baseML.limits)
  })
  it('con pool asigna el pool a cada tippable', () => {
    const r = limitsForDistribution({ ...baseML, unifiedPool: 10 })
    expect(r.estatico).toBe(10)
    expect(r.short).toBe(10)
    expect(r.historia).toBe(baseML.limits.historia)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL — funciones inexistentes.

- [ ] **Step 3: Implementar**

```ts
// ── Fecha propuesta ─────────────────────────────────────────────────────────

/**
 * Límites que alimentan la distribución semanal. Bajo pool unificado los tippables
 * tienen límite individual 0, así que se les asigna el pool para que `augmentDistribution`
 * les dé presupuesto; `proposeDeadline` los cuenta juntos vía `sharedTypes`.
 */
export function limitsForDistribution(ml: MatrixLimits): Record<ContentType, number> {
  if (ml.unifiedPool == null) return ml.limits
  const out = { ...ml.limits }
  for (const t of TIPPABLE_CONTENT_TYPES) out[t] = ml.unifiedPool
  return out
}

export interface ProposeDeadlineInput {
  contentType: ContentType
  items: Pick<ContentMatrixItem, 'content_type' | 'deadline'>[]
  distribution: WeeklyDistribution
  periodStart: DateString
  periodEnd: DateString
  maxWeek: 4 | 8
  /** Tipos que comparten presupuesto semanal (pool). Si incluye contentType, `used` los cuenta todos. */
  sharedTypes?: ContentType[]
}

export function proposeDeadline(input: ProposeDeadlineInput): DateString {
  const weeks = input.maxWeek === 8 ? WEEKS_BIMONTHLY : WEEKS_BASE
  const family: ContentType[] = input.sharedTypes?.includes(input.contentType) ? input.sharedTypes : [input.contentType]

  const usedByWeek = new Map<number, number>()
  for (const it of input.items) {
    if (!family.includes(it.content_type)) continue
    // new Date(iso) → medianoche UTC, igual que el new Date(periodStart) interno de weekIndexInCycle
    const w = weekIndexInCycle(new Date(it.deadline), input.periodStart, input.maxWeek)
    usedByWeek.set(w, (usedByWeek.get(w) ?? 0) + 1)
  }

  let chosen: number = input.maxWeek
  for (let w = 1; w <= input.maxWeek; w++) {
    const budget = input.distribution[weeks[w - 1]]?.[input.contentType] ?? 0
    if ((usedByWeek.get(w) ?? 0) < budget) { chosen = w; break }
  }

  const candidate = addDaysString(input.periodStart, (chosen - 1) * 7 + 2)
  return candidate > input.periodEnd ? input.periodEnd : candidate
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): proposeDeadline por distribución semanal (4 y 8 semanas, pool)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Dominio — estados, validaciones, `shiftDeadline`, temas

**Files:**
- Modify: `src/lib/domain/matrix.ts`
- Test: `src/lib/domain/matrix.test.ts`

- [ ] **Step 1: Pruebas que fallan**

```ts
import { canTransition, validateForApproval, validateItemPatch, shiftDeadline, sanitizeTopics } from './matrix'

describe('canTransition', () => {
  const ctx = { hasConvertedItems: false }
  it('draft → approved, approved → draft, cualquiera → closed', () => {
    expect(canTransition('draft', 'approved', ctx)).toBe(true)
    expect(canTransition('approved', 'draft', ctx)).toBe(true)
    expect(canTransition('draft', 'closed', ctx)).toBe(true)
    expect(canTransition('approved', 'closed', ctx)).toBe(true)
  })
  it('closed es terminal; approved → draft bloqueado con convertidas; mismo estado no', () => {
    expect(canTransition('closed', 'draft', ctx)).toBe(false)
    expect(canTransition('approved', 'draft', { hasConvertedItems: true })).toBe(false)
    expect(canTransition('draft', 'draft', ctx)).toBe(false)
  })
})

describe('validateForApproval', () => {
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14' }
  it('vacía no aprueba', () => {
    expect(validateForApproval([], period)).toEqual({ ok: false, empty: true, problems: [] })
  })
  it('detecta sin título y fecha fuera de período', () => {
    const r = validateForApproval([
      { id: 'a', title: '', deadline: '2026-10-20' },
      { id: 'b', title: 'Ok', deadline: '2026-12-01' },
      { id: 'c', title: 'Ok', deadline: '2026-10-21' },
    ], period)
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([
      { itemId: 'a', reason: 'sin_titulo' },
      { itemId: 'b', reason: 'fecha_fuera_de_periodo' },
    ])
  })
})

describe('validateItemPatch', () => {
  const ctx = { periodStart: '2026-10-15', periodEnd: '2026-11-14', topics: [{ name: 'Promo' }] }
  it('acepta fecha dentro, tema existente, objetivo válido', () => {
    expect(validateItemPatch({ deadline: '2026-10-15', topic: 'Promo', objective: 'venta' }, ctx)).toEqual({ ok: true })
    expect(validateItemPatch({ topic: null, objective: null }, ctx)).toEqual({ ok: true })
  })
  it('rechaza fecha fuera, tema desconocido, objetivo inválido, tipo no planificable', () => {
    expect(validateItemPatch({ deadline: '2026-11-15' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ topic: 'Otro' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ objective: 'x' as never }, ctx).ok).toBe(false)
    expect(validateItemPatch({ content_type: 'produccion' }, ctx).ok).toBe(false)
  })
})

describe('shiftDeadline', () => {
  it('mantiene el offset y recorta al final', () => {
    const from = { periodStart: '2026-10-15', periodEnd: '2026-11-14' }
    expect(shiftDeadline('2026-10-20', from, { periodStart: '2026-11-15', periodEnd: '2026-12-14' })).toBe('2026-11-20')
    expect(shiftDeadline('2026-11-10', from, { periodStart: '2026-12-01', periodEnd: '2026-12-14' })).toBe('2026-12-14')
  })
})

describe('sanitizeTopics', () => {
  it('recorta, deduplica sin distinguir mayúsculas y descarta vacíos', () => {
    expect(sanitizeTopics([{ name: ' Promo ' }, { name: 'promo', note: 'x' }, { name: '' }, { name: 'Carta', note: ' n ' }]))
      .toEqual([{ name: 'Promo' }, { name: 'Carta', note: 'n' }])
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/domain/matrix.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// ── Estados y validaciones ──────────────────────────────────────────────────

export function canTransition(from: MatrixStatus, to: MatrixStatus, ctx: { hasConvertedItems: boolean }): boolean {
  if (from === to || from === 'closed') return false
  if (to === 'closed') return true
  if (from === 'draft' && to === 'approved') return true
  if (from === 'approved' && to === 'draft') return !ctx.hasConvertedItems
  return false
}

export type ApprovalProblemReason = 'sin_titulo' | 'fecha_fuera_de_periodo'
export interface ApprovalProblem { itemId: string; reason: ApprovalProblemReason }
export const APPROVAL_PROBLEM_LABELS: Record<ApprovalProblemReason, string> = {
  sin_titulo: 'Sin título',
  fecha_fuera_de_periodo: 'Fecha fuera del período',
}

export interface PeriodRange { periodStart: DateString; periodEnd: DateString }

function inPeriod(d: DateString, p: PeriodRange): boolean {
  return d >= p.periodStart && d <= p.periodEnd
}

export function validateForApproval(
  items: Pick<ContentMatrixItem, 'id' | 'title' | 'deadline'>[],
  period: PeriodRange,
): { ok: boolean; empty: boolean; problems: ApprovalProblem[] } {
  if (items.length === 0) return { ok: false, empty: true, problems: [] }
  const problems: ApprovalProblem[] = []
  for (const it of items) {
    if (!it.title.trim()) problems.push({ itemId: it.id, reason: 'sin_titulo' })
    else if (!inPeriod(it.deadline, period)) problems.push({ itemId: it.id, reason: 'fecha_fuera_de_periodo' })
  }
  return { ok: problems.length === 0, empty: false, problems }
}

export type ItemPatch = Partial<Pick<ContentMatrixItem,
  'content_type' | 'title' | 'topic' | 'objective' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta' | 'deadline' | 'needs_production'>>

export function validateItemPatch(
  patch: ItemPatch,
  ctx: PeriodRange & { topics: MatrixTopic[] },
): { ok: true } | { ok: false; error: string } {
  if (patch.content_type !== undefined && !MATRIX_CONTENT_TYPES.includes(patch.content_type)) {
    return { ok: false, error: 'Ese tipo de contenido no se planifica en la matriz.' }
  }
  if (patch.deadline !== undefined && !inPeriod(patch.deadline, ctx)) {
    return { ok: false, error: `La fecha debe estar entre ${formatDeadlineDate(ctx.periodStart)} y ${formatDeadlineDate(ctx.periodEnd)}.` }
  }
  if (patch.topic != null && !ctx.topics.some((t) => t.name === patch.topic)) {
    return { ok: false, error: 'El tema no está en la lista de temas de la matriz.' }
  }
  if (patch.objective != null && !MATRIX_OBJECTIVES.includes(patch.objective)) {
    return { ok: false, error: 'Objetivo inválido.' }
  }
  return { ok: true }
}

export function shiftDeadline(deadline: DateString, from: PeriodRange, to: PeriodRange): DateString {
  const offset = Math.max(0, daysBetween(from.periodStart, deadline))
  const candidate = addDaysString(to.periodStart, offset)
  return candidate > to.periodEnd ? to.periodEnd : candidate
}

export const MAX_TOPICS = 20

export function sanitizeTopics(raw: MatrixTopic[]): MatrixTopic[] {
  const seen = new Set<string>()
  const out: MatrixTopic[] = []
  for (const t of raw) {
    const name = (t.name ?? '').trim().slice(0, 60)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const note = t.note?.trim()
    out.push(note ? { name, note } : { name })
    if (out.length >= MAX_TOPICS) break
  }
  return out
}
```

- [ ] **Step 4: Correr todas las pruebas del dominio**

Run: `npx vitest run src/lib/domain`
Expected: PASS (las existentes del repo + las nuevas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/matrix.ts src/lib/domain/matrix.test.ts
git commit -m "feat(matrices): transiciones de estado, validaciones y utilidades de dominio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Migración `0129_content_matrices.sql`

**Files:**
- Create: `supabase/migrations/0129_content_matrices.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0129_content_matrices.sql
-- Creador de matrices · Bloque 1. Matriz de contenido mensual por cliente y período
-- objetivo (ciclo de facturación) con sus piezas planificadas.
-- Spec: docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md
--
-- Campos reservados para bloques posteriores (no se usan aún):
--   content_matrices.lead_days, content_matrix_items.status ('converted'|'blocked'),
--   content_matrix_items.requirement_id, índice content_matrix_items_planned_idx.

begin;

-- ── 1. content_matrices ──────────────────────────────────────────────────────
create table if not exists public.content_matrices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  period_start          date not null,
  period_end            date not null,
  billing_cycle_id      uuid references public.billing_cycles(id) on delete set null,
  title                 text not null default '',
  status                text not null default 'draft'
                        check (status in ('draft','approved','closed')),
  topics_json           jsonb not null default '[]'::jsonb,
  notes                 text,
  lead_days             smallint not null default 7 check (lead_days between 0 and 30),
  matrix_requirement_id uuid references public.requirements(id) on delete set null,
  created_by            uuid not null references public.users(id),
  approved_by           uuid references public.users(id),
  approved_at           timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint content_matrices_period_chk check (period_end > period_start),
  constraint content_matrices_client_period_uq unique (client_id, period_start)
);

create index if not exists content_matrices_client_idx
  on public.content_matrices (client_id, period_start desc);
create index if not exists content_matrices_status_idx
  on public.content_matrices (status, period_start desc);

-- ── 2. content_matrix_items ──────────────────────────────────────────────────
create table if not exists public.content_matrix_items (
  id               uuid primary key default gen_random_uuid(),
  matrix_id        uuid not null references public.content_matrices(id) on delete cascade,
  content_type     text not null
                   check (content_type in ('historia','estatico','video_corto','reel','short')),
  title            text not null default '',
  topic            text,
  objective        text check (objective in ('venta','alcance','educacion','comunidad','otro')),
  copy             text,
  script           text,
  visual_style     text,
  hashtags         text,
  cta              text,
  deadline         date not null,
  needs_production boolean not null default false,
  status           text not null default 'planned'
                   check (status in ('planned','converted','blocked')),
  requirement_id   uuid references public.requirements(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists content_matrix_items_matrix_idx
  on public.content_matrix_items (matrix_id, deadline, created_at);
create index if not exists content_matrix_items_planned_idx
  on public.content_matrix_items (deadline)
  where status = 'planned';

-- ── 3. updated_at (reusa public.update_updated_at() de 0001_init.sql) ────────
drop trigger if exists content_matrices_updated_at on public.content_matrices;
create trigger content_matrices_updated_at
  before update on public.content_matrices
  for each row execute procedure public.update_updated_at();

drop trigger if exists content_matrix_items_updated_at on public.content_matrix_items;
create trigger content_matrix_items_updated_at
  before update on public.content_matrix_items
  for each row execute procedure public.update_updated_at();

-- ── 4. RLS: solo admin y supervisor (patrón 0117_assigned_tasks) ─────────────
-- Una sola policy FOR ALL con using + with check equivale a las cuatro políticas
-- (select / insert / update / delete) que describe la spec: misma condición en todas.
alter table public.content_matrices      enable row level security;
alter table public.content_matrix_items  enable row level security;

drop policy if exists "content_matrices_manage" on public.content_matrices;
create policy "content_matrices_manage"
  on public.content_matrices for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  );

drop policy if exists "content_matrix_items_manage" on public.content_matrix_items;
create policy "content_matrix_items_manage"
  on public.content_matrix_items for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  );

commit;
```

- [ ] **Step 2: Aplicar en Supabase**

Abrir el SQL Editor del dashboard de Supabase (proyecto `witcgfylutplgfxvzoab`), pegar el archivo completo y ejecutar. Expected: `Success. No rows returned`.

- [ ] **Step 3: Verificar RLS y unicidad**

En el SQL Editor:

```sql
select tablename, policyname from pg_policies where tablename in ('content_matrices','content_matrix_items');
-- Expected: 2 filas (content_matrices_manage, content_matrix_items_manage)
select conname from pg_constraint where conname = 'content_matrices_client_period_uq';
-- Expected: 1 fila
```

La prueba de RLS por rol se hace desde la app en la Task 18 (un operador no debe ver `/matrices` ni poder leer la tabla desde el cliente del navegador).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0129_content_matrices.sql
git commit -m "feat(matrices): migración 0129 — content_matrices y content_matrix_items con RLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Tipos en `db.ts` y permiso `canManageMatrices`

**Files:**
- Modify: `src/types/db.ts`
- Modify: `src/lib/domain/permissions.ts`

- [ ] **Step 1: Tipos base**

En `src/types/db.ts`, junto a `export type TaskStatus = ...` (línea ~12), añadir:

```ts
/** Estado de una matriz de contenido (content_matrices). */
export type MatrixStatus = 'draft' | 'approved' | 'closed'
/** Estado de una pieza de matriz. 'converted' y 'blocked' se usan desde el bloque 2. */
export type MatrixItemStatus = 'planned' | 'converted' | 'blocked'
export type MatrixObjective = 'venta' | 'alcance' | 'educacion' | 'comunidad' | 'otro'
export interface MatrixTopic { name: string; note?: string }
```

- [ ] **Step 2: Bloques de tabla**

Insertar justo antes de `      app_settings: {` (dentro de `Tables`):

```ts
      content_matrices: {
        Row: {
          id: string
          client_id: string
          period_start: string
          period_end: string
          billing_cycle_id: string | null
          title: string
          status: MatrixStatus
          topics_json: MatrixTopic[]
          notes: string | null
          lead_days: number
          matrix_requirement_id: string | null
          created_by: string
          approved_by: string | null
          approved_at: string | null
          closed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          period_start: string
          period_end: string
          billing_cycle_id?: string | null
          title?: string
          status?: MatrixStatus
          topics_json?: MatrixTopic[]
          notes?: string | null
          lead_days?: number
          matrix_requirement_id?: string | null
          created_by: string
          approved_by?: string | null
          approved_at?: string | null
          closed_at?: string | null
        }
        Update: {
          billing_cycle_id?: string | null
          title?: string
          status?: MatrixStatus
          topics_json?: MatrixTopic[]
          notes?: string | null
          lead_days?: number
          matrix_requirement_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          closed_at?: string | null
        }
        Relationships: [
          { foreignKeyName: 'content_matrices_client_id_fkey'; columns: ['client_id']; isOneToOne: false; referencedRelation: 'clients'; referencedColumns: ['id'] },
          { foreignKeyName: 'content_matrices_billing_cycle_id_fkey'; columns: ['billing_cycle_id']; isOneToOne: false; referencedRelation: 'billing_cycles'; referencedColumns: ['id'] },
          { foreignKeyName: 'content_matrices_matrix_requirement_id_fkey'; columns: ['matrix_requirement_id']; isOneToOne: false; referencedRelation: 'requirements'; referencedColumns: ['id'] },
          { foreignKeyName: 'content_matrices_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] },
          { foreignKeyName: 'content_matrices_approved_by_fkey'; columns: ['approved_by']; isOneToOne: false; referencedRelation: 'users'; referencedColumns: ['id'] }
        ]
      }
      content_matrix_items: {
        Row: {
          id: string
          matrix_id: string
          content_type: ContentType
          title: string
          topic: string | null
          objective: MatrixObjective | null
          copy: string | null
          script: string | null
          visual_style: string | null
          hashtags: string | null
          cta: string | null
          deadline: string
          needs_production: boolean
          status: MatrixItemStatus
          requirement_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          matrix_id: string
          content_type: ContentType
          title?: string
          topic?: string | null
          objective?: MatrixObjective | null
          copy?: string | null
          script?: string | null
          visual_style?: string | null
          hashtags?: string | null
          cta?: string | null
          deadline: string
          needs_production?: boolean
          status?: MatrixItemStatus
          requirement_id?: string | null
        }
        Update: {
          content_type?: ContentType
          title?: string
          topic?: string | null
          objective?: MatrixObjective | null
          copy?: string | null
          script?: string | null
          visual_style?: string | null
          hashtags?: string | null
          cta?: string | null
          deadline?: string
          needs_production?: boolean
          status?: MatrixItemStatus
          requirement_id?: string | null
        }
        Relationships: [
          { foreignKeyName: 'content_matrix_items_matrix_id_fkey'; columns: ['matrix_id']; isOneToOne: false; referencedRelation: 'content_matrices'; referencedColumns: ['id'] },
          { foreignKeyName: 'content_matrix_items_requirement_id_fkey'; columns: ['requirement_id']; isOneToOne: false; referencedRelation: 'requirements'; referencedColumns: ['id'] }
        ]
      }
```

- [ ] **Step 3: Aliases**

Junto a `export type AssignedTask = ...` añadir:

```ts
export type ContentMatrix = Database['public']['Tables']['content_matrices']['Row']
export type ContentMatrixItem = Database['public']['Tables']['content_matrix_items']['Row']
```

- [ ] **Step 4: Permiso**

En `src/lib/domain/permissions.ts` añadir tras `canCreateRequirement`:

```ts
export const canManageMatrices    = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos (los de `matrix.ts` por tipos faltantes desaparecen).

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/lib/domain/permissions.ts
git commit -m "feat(matrices): tipos de content_matrices/content_matrix_items y canManageMatrices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Loaders de servidor — `src/lib/data/matrices.ts`

**Files:**
- Create: `src/lib/data/matrices.ts`
- Modify: `src/lib/domain/matrix.ts` (tipos de resultado de acciones)

No hay prueba unitaria aquí (acceso a datos); se verifica con `tsc` y en la Task 18.

- [ ] **Step 1: Tipos de resultado compartidos en el dominio**

Añadir al final de `src/lib/domain/matrix.ts`:

```ts
// ── Tipos de resultado para server actions (viven aquí porque un archivo
//    'use server' solo debe exportar funciones async) ─────────────────────────

export type ActionErr = { ok: false; error: string }
export type ActionResult<T = object> = ({ ok: true } & T) | ActionErr

export type LinkResult =
  | { ok: true; requirementId: string }
  | { ok: false; error: string }
```

- [ ] **Step 2: Crear el módulo de loaders**

`src/lib/data/matrices.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BillingCycle, Client, ContentMatrix, ContentMatrixItem, Database, MatrixStatus, Plan, Requirement, WeeklyDistribution,
} from '@/types/db'
import { weeksForBillingPeriod } from '@/types/db'
import { getAvailableContentCredits } from '@/lib/domain/credits'
import { buildEffectiveDistribution } from '@/lib/domain/weekly-distribution'
import { maxWeeksForPeriod } from '@/lib/domain/requirement'
import { limitsToRecord, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { today } from '@/lib/domain/dates'
import {
  computeMatrixUsage, computeTargetPeriods, limitsForDistribution, MATRIX_CONTENT_TYPES,
  periodLabel, resolveMatrixLimits,
  type MatrixLimits, type MatrixUsage, type TargetPeriod,
} from '@/lib/domain/matrix'

export type Db = SupabaseClient<Database>
export type ClientWithPlanRow = Client & { plan: Plan }

// ── Ciclo vigente ────────────────────────────────────────────────────────────

export async function loadCurrentCycle(db: Db, clientId: string): Promise<BillingCycle | null> {
  const { data } = await db
    .from('billing_cycles')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0] as BillingCycle | undefined) ?? null
}

// ── Editor ───────────────────────────────────────────────────────────────────

export interface MatrixEditorData {
  matrix: ContentMatrix
  items: ContentMatrixItem[]
  client: ClientWithPlanRow
  cycle: BillingCycle | null
  limits: MatrixLimits
  usage: MatrixUsage
  distribution: WeeklyDistribution
  maxWeek: 4 | 8
  period: { periodStart: string; periodEnd: string; label: string }
  linkedRequirement: Pick<Requirement, 'id' | 'title' | 'phase'> | null
}

export async function loadMatrixEditorData(db: Db, matrixId: string): Promise<MatrixEditorData | null> {
  const { data: matrixRaw } = await db.from('content_matrices').select('*').eq('id', matrixId).maybeSingle()
  if (!matrixRaw) return null
  const matrix = matrixRaw as ContentMatrix

  const [{ data: itemsRaw }, { data: clientRaw }, { data: cycleRows }, credits, linked] = await Promise.all([
    db.from('content_matrix_items').select('*').eq('matrix_id', matrixId)
      .order('deadline', { ascending: true }).order('created_at', { ascending: true }),
    db.from('clients').select('*, plan:plans(*)').eq('id', matrix.client_id).single(),
    // Sin filtrar por status: un ciclo pending_renewal/archived también cuenta.
    db.from('billing_cycles').select('*').eq('client_id', matrix.client_id)
      .eq('period_start', matrix.period_start).order('created_at', { ascending: false }).limit(1),
    getAvailableContentCredits(db, matrix.client_id),
    matrix.matrix_requirement_id
      ? db.from('requirements').select('id, title, phase').eq('id', matrix.matrix_requirement_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!clientRaw) return null
  const client = clientRaw as unknown as ClientWithPlanRow
  const cycle = (cycleRows?.[0] as BillingCycle | undefined) ?? null

  let cycleRequirements: Requirement[] = []
  if (cycle) {
    const { data } = await db.from('requirements').select('*')
      .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
    cycleRequirements = (data ?? []) as Requirement[]
  }

  const items = (itemsRaw ?? []) as ContentMatrixItem[]
  const limits = resolveMatrixLimits({ cycle, plan: client.plan, cycleRequirements, credits })
  const usage = computeMatrixUsage(items, limits)
  const maxWeek = maxWeeksForPeriod(client.billing_period)
  const distribution = buildEffectiveDistribution({
    clientDistribution: client.weekly_distribution_json,
    planDistribution: client.plan.default_weekly_distribution_json,
    pipelineTypes: usage.activeTypes,
    limits: limitsForDistribution(limits),
    cycleOverride: cycle?.weekly_distribution_override_json ?? null,
    rollover: cycle?.rollover_from_previous_json ?? null,
    weeks: weeksForBillingPeriod(client.billing_period),
  })

  return {
    matrix, items, client, cycle, limits, usage, distribution, maxWeek,
    period: { periodStart: matrix.period_start, periodEnd: matrix.period_end, label: periodLabel(matrix.period_start, matrix.period_end) },
    linkedRequirement: (linked?.data as Pick<Requirement, 'id' | 'title' | 'phase'> | null) ?? null,
  }
}

/** Tipos que comparten presupuesto semanal en proposeDeadline (pool unificado). */
export function sharedTypesFor(limits: MatrixLimits) {
  return limits.unifiedPool != null ? [...TIPPABLE_CONTENT_TYPES] : undefined
}

// ── Lista ────────────────────────────────────────────────────────────────────

export interface MatrixListRow {
  id: string
  title: string
  status: MatrixStatus
  period_start: string
  period_end: string
  label: string
  updated_at: string
  approved_by_name: string | null
  client: { id: string; name: string; logo_url: string | null }
  item_count: number
  capacity: number
}

interface RawListRow {
  id: string; title: string; status: MatrixStatus; period_start: string; period_end: string; updated_at: string
  client: { id: string; name: string; logo_url: string | null; plan: Pick<Plan, 'limits_json' | 'unified_content_limit'> | null } | null
  approver: { full_name: string } | null
  items: Array<{ count: number }> | null
}

function planCapacity(plan: Pick<Plan, 'limits_json' | 'unified_content_limit'> | null): number {
  if (!plan) return 0
  const rec = limitsToRecord(plan.limits_json)
  if (plan.unified_content_limit != null) return plan.unified_content_limit + rec.historia
  return MATRIX_CONTENT_TYPES.reduce((s, t) => s + (rec[t] ?? 0), 0)
}

export async function loadMatricesList(db: Db): Promise<MatrixListRow[]> {
  const { data } = await db
    .from('content_matrices')
    .select(`id, title, status, period_start, period_end, updated_at,
      client:clients(id, name, logo_url, plan:plans(limits_json, unified_content_limit)),
      approver:users!content_matrices_approved_by_fkey(full_name),
      items:content_matrix_items(count)`)
    .order('period_start', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500)
  const rows = (data ?? []) as unknown as RawListRow[]
  return rows
    .filter((r) => r.client)
    .map((r) => ({
      id: r.id, title: r.title, status: r.status, period_start: r.period_start, period_end: r.period_end,
      label: periodLabel(r.period_start, r.period_end), updated_at: r.updated_at,
      approved_by_name: r.approver?.full_name ?? null,
      client: { id: r.client!.id, name: r.client!.name, logo_url: r.client!.logo_url },
      item_count: r.items?.[0]?.count ?? 0,
      capacity: planCapacity(r.client!.plan),
    }))
}

// ── Faltantes para el próximo ciclo ──────────────────────────────────────────

export interface MissingMatrix {
  clientId: string
  clientName: string
  logoUrl: string | null
  periodStart: string
  periodEnd: string
  label: string
}

export async function loadMissingMatrices(db: Db): Promise<MissingMatrix[]> {
  const [{ data: clientsRaw }, { data: cyclesRaw }, { data: matricesRaw }] = await Promise.all([
    db.from('clients').select('id, name, logo_url, billing_day, billing_period, plan:plans(limits_json)').eq('status', 'active').order('name'),
    db.from('billing_cycles').select('client_id, period_start, period_end').eq('status', 'current'),
    db.from('content_matrices').select('client_id, period_start'),
  ])
  const cycleByClient = new Map<string, { period_start: string; period_end: string }>()
  for (const c of (cyclesRaw ?? []) as Array<{ client_id: string; period_start: string; period_end: string }>) {
    if (!cycleByClient.has(c.client_id)) cycleByClient.set(c.client_id, c)
  }
  const have = new Set(((matricesRaw ?? []) as Array<{ client_id: string; period_start: string }>).map((m) => `${m.client_id}|${m.period_start}`))
  const t = today()
  const out: MissingMatrix[] = []
  type CRow = { id: string; name: string; logo_url: string | null; billing_day: number; billing_period: Client['billing_period']; plan: Pick<Plan, 'limits_json'> | null }
  for (const c of (clientsRaw ?? []) as unknown as CRow[]) {
    if (!c.plan) continue
    // limitsToRecord resuelve matrices_contenido ausente a 1: planes legacy se incluyen a propósito.
    if (limitsToRecord(c.plan.limits_json).matriz_contenido <= 0) continue
    const periods = computeTargetPeriods({ currentCycle: cycleByClient.get(c.id) ?? null, billingDay: c.billing_day, billingPeriod: c.billing_period, today: t, count: 2 })
    const next = periods[1]
    if (have.has(`${c.id}|${next.periodStart}`)) continue
    out.push({ clientId: c.id, clientName: c.name, logoUrl: c.logo_url, periodStart: next.periodStart, periodEnd: next.periodEnd, label: next.label })
  }
  return out
}

// ── Períodos objetivo para un cliente (diálogo) ──────────────────────────────

export interface TargetPeriodsForClient {
  periods: TargetPeriod[]
  /** periodStart → id de matriz existente */
  existing: Record<string, string>
}

export async function loadTargetPeriodsForClient(db: Db, clientId: string): Promise<TargetPeriodsForClient | null> {
  const [{ data: client }, cycle, { data: existingRaw }] = await Promise.all([
    db.from('clients').select('id, billing_day, billing_period').eq('id', clientId).maybeSingle(),
    loadCurrentCycle(db, clientId),
    db.from('content_matrices').select('id, period_start').eq('client_id', clientId),
  ])
  if (!client) return null
  const periods = computeTargetPeriods({ currentCycle: cycle, billingDay: client.billing_day, billingPeriod: client.billing_period, today: today() })
  const existing: Record<string, string> = {}
  for (const m of (existingRaw ?? []) as Array<{ id: string; period_start: string }>) existing[m.period_start] = m.id
  return { periods, existing }
}

// ── Tarjeta del perfil del cliente ───────────────────────────────────────────

export interface ClientMatrixSummary {
  id: string
  title: string
  status: MatrixStatus
  periodStart: string
  periodEnd: string
  label: string
  itemCount: number
}

export async function loadClientMatrices(db: Db, client: Pick<Client, 'id' | 'billing_day' | 'billing_period'>, currentCycle: BillingCycle | null): Promise<{ periods: TargetPeriod[]; matrices: ClientMatrixSummary[] }> {
  const periods = computeTargetPeriods({ currentCycle, billingDay: client.billing_day, billingPeriod: client.billing_period, today: today(), count: 2 })
  const { data } = await db
    .from('content_matrices')
    .select('id, title, status, period_start, period_end, items:content_matrix_items(count)')
    .eq('client_id', client.id)
    .in('period_start', periods.map((p) => p.periodStart))
  type Row = { id: string; title: string; status: MatrixStatus; period_start: string; period_end: string; items: Array<{ count: number }> | null }
  const matrices = ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.id, title: m.title, status: m.status, periodStart: m.period_start, periodEnd: m.period_end,
    label: periodLabel(m.period_start, m.period_end), itemCount: m.items?.[0]?.count ?? 0,
  }))
  return { periods, matrices }
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. Si `select('*, plan:plans(*)')` devuelve un tipo que no encaja, mantener el `as unknown as ClientWithPlanRow` (mismo patrón que `clients/[id]/page.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/matrices.ts src/lib/domain/matrix.ts
git commit -m "feat(matrices): loaders de servidor para editor, lista, faltantes y tarjeta del cliente

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Server actions — matriz (crear, actualizar, borrar, estado, vínculo)

**Files:**
- Create: `src/app/actions/matrices.ts`

- [ ] **Step 1: Crear el archivo con helpers y acciones de matriz**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from './impersonation'
import { canManageMatrices } from '@/lib/domain/permissions'
import { effectiveLimits, applyContentLimitsWithOverride } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
import { today, addDaysString } from '@/lib/domain/dates'
import {
  canTransition, matrixTitleFor, sanitizeTopics, validateForApproval, validateItemPatch,
  proposeDeadline, shiftDeadline, MATRIX_CONTENT_TYPES,
  type ActionResult, type LinkResult, type ApprovalProblem, type ItemPatch,
} from '@/lib/domain/matrix'
import { loadMatrixEditorData, loadTargetPeriodsForClient, sharedTypesFor, type TargetPeriodsForClient } from '@/lib/data/matrices'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixStatus, MatrixTopic, Requirement } from '@/types/db'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }

async function requireManager(): Promise<Ctx | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!canManageMatrices(data?.role)) return { error: 'Sin permisos' }
  return { supabase, userId: user.id }
}

function revalidateMatrix(clientId: string, matrixId?: string) {
  revalidatePath('/matrices')
  if (matrixId) revalidatePath(`/matrices/${matrixId}`)
  revalidatePath(`/clients/${clientId}`)
}

function dbError(error: { code?: string; message: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.code === '23505') return 'Ya existe una matriz para ese período.'
  return error.message || fallback
}

/**
 * Registra el requerimiento de tipo matriz_contenido en el ciclo vigente y lo vincula.
 * Usa el cliente AUTENTICADO para que el trigger de pago aplique como a un registro manual.
 */
async function linkMatrixRequirement(ctx: Ctx, matrixId: string): Promise<LinkResult> {
  const { supabase, userId } = ctx
  const { data: m } = await supabase.from('content_matrices')
    .select('id, client_id, title, period_start, matrix_requirement_id').eq('id', matrixId).single()
  if (!m) return { ok: false, error: 'Matriz no encontrada.' }
  if (m.matrix_requirement_id) return { ok: true, requirementId: m.matrix_requirement_id }

  const { data: cycleRows } = await supabase.from('billing_cycles').select('*')
    .eq('client_id', m.client_id).eq('status', 'current').order('created_at', { ascending: false }).limit(1)
  const cycle = cycleRows?.[0]
  if (!cycle) return { ok: false, error: 'El cliente no tiene ciclo vigente.' }

  const { data: reqs } = await supabase.from('requirements').select('*')
    .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
  const totals = computeTotals((reqs ?? []) as Requirement[])
  const limits = applyContentLimitsWithOverride(
    effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json),
    (cycle.content_limits_override_json ?? null) as Record<string, number> | null,
  )
  if (totals.matriz_contenido >= limits.matriz_contenido) {
    return { ok: false, error: 'El plan no tiene cupo de matriz en el ciclo vigente.' }
  }

  const t = today()
  const deadline = m.period_start > t ? m.period_start : addDaysString(t, 3)
  const { data: req, error } = await supabase.from('requirements').insert({
    billing_cycle_id: cycle.id,
    content_type: 'matriz_contenido',
    title: m.title || 'Matriz de contenido',
    registered_by_user_id: userId,
    priority: 'media',
    over_limit: false,
    approval_status: 'approved',
    includes_story: false,
    deadline,
  }).select('id').single()
  if (error || !req) return { ok: false, error: error?.message ?? 'No se pudo registrar el requerimiento de matriz.' }

  await insertInitialPhaseLog(supabase, { requirementId: req.id, movedBy: userId })
  await supabase.from('content_matrices').update({ matrix_requirement_id: req.id }).eq('id', matrixId)
  return { ok: true, requirementId: req.id }
}

// ── Períodos (para el diálogo) ───────────────────────────────────────────────

export async function listTargetPeriods(clientId: string): Promise<ActionResult<TargetPeriodsForClient>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const r = await loadTargetPeriodsForClient(ctx.supabase, clientId)
  if (!r) return { ok: false, error: 'Cliente no encontrado.' }
  return { ok: true, ...r }
}

// ── Matriz ───────────────────────────────────────────────────────────────────

export async function createMatrix(input: {
  clientId: string
  periodStart: string
  periodEnd: string
  title: string
  topics: MatrixTopic[]
  notes: string | null
}): Promise<ActionResult<{ id: string; link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  const { data: existing } = await supabase.from('content_matrices').select('id')
    .eq('client_id', input.clientId).eq('period_start', input.periodStart).maybeSingle()
  if (existing) return { ok: false, error: 'Ya existe una matriz para ese período.' }

  const { data: cycleRows } = await supabase.from('billing_cycles').select('id')
    .eq('client_id', input.clientId).eq('period_start', input.periodStart)
    .in('status', ['current', 'scheduled']).limit(1)

  const { data: created, error } = await supabase.from('content_matrices').insert({
    client_id: input.clientId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    billing_cycle_id: cycleRows?.[0]?.id ?? null,
    title: input.title.trim() || matrixTitleFor(input.periodStart, input.periodEnd),
    topics_json: sanitizeTopics(input.topics),
    notes: input.notes?.trim() || null,
    created_by: userId,
  }).select('id').single()
  if (error || !created) return { ok: false, error: dbError(error, 'No se pudo crear la matriz.') }

  const link = await linkMatrixRequirement(ctx, created.id)
  revalidateMatrix(input.clientId, created.id)
  return { ok: true, id: created.id, link }
}

export async function retryMatrixRequirementLink(matrixId: string): Promise<ActionResult<{ link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const link = await linkMatrixRequirement(ctx, matrixId)
  const { data: m } = await ctx.supabase.from('content_matrices').select('client_id').eq('id', matrixId).single()
  if (m) revalidateMatrix(m.client_id, matrixId)
  return { ok: true, link }
}

export async function updateMatrix(matrixId: string, patch: {
  title?: string
  topics?: MatrixTopic[]
  notes?: string | null
  lead_days?: number
}): Promise<ActionResult<{ matrix: ContentMatrix }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: current } = await supabase.from('content_matrices').select('*').eq('id', matrixId).single()
  if (!current) return { ok: false, error: 'Matriz no encontrada.' }
  if (current.status === 'closed') return { ok: false, error: 'La matriz está cerrada.' }

  const update: Partial<ContentMatrix> = {}
  if (patch.title !== undefined) update.title = patch.title.trim()
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  if (patch.lead_days !== undefined) {
    if (!Number.isInteger(patch.lead_days) || patch.lead_days < 0 || patch.lead_days > 30) {
      return { ok: false, error: 'La anticipación debe estar entre 0 y 30 días.' }
    }
    update.lead_days = patch.lead_days
  }
  if (patch.topics !== undefined) {
    const topics = sanitizeTopics(patch.topics)
    update.topics_json = topics
    const kept = new Set(topics.map((t) => t.name))
    const removed = (current.topics_json as MatrixTopic[]).map((t) => t.name).filter((n) => !kept.has(n))
    if (removed.length > 0) {
      await supabase.from('content_matrix_items').update({ topic: null }).eq('matrix_id', matrixId).in('topic', removed)
    }
  }

  const { data: matrix, error } = await supabase.from('content_matrices').update(update).eq('id', matrixId).select('*').single()
  if (error || !matrix) return { ok: false, error: dbError(error, 'No se pudo guardar.') }
  revalidateMatrix(matrix.client_id, matrixId)
  return { ok: true, matrix: matrix as ContentMatrix }
}

export async function setMatrixStatus(matrixId: string, to: MatrixStatus): Promise<ActionResult<{ matrix: ContentMatrix }> | (ActionResult & { problems?: ApprovalProblem[]; empty?: boolean })> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  const [{ data: current }, { data: items }] = await Promise.all([
    supabase.from('content_matrices').select('*').eq('id', matrixId).single(),
    supabase.from('content_matrix_items').select('id, title, deadline, status').eq('matrix_id', matrixId),
  ])
  if (!current) return { ok: false, error: 'Matriz no encontrada.' }
  const list = (items ?? []) as Pick<ContentMatrixItem, 'id' | 'title' | 'deadline' | 'status'>[]
  const hasConvertedItems = list.some((i) => i.status === 'converted')

  if (!canTransition(current.status, to, { hasConvertedItems })) {
    return { ok: false, error: 'Ese cambio de estado no está permitido.' }
  }
  if (to === 'approved') {
    const v = validateForApproval(list, { periodStart: current.period_start, periodEnd: current.period_end })
    if (v.empty) return { ok: false, error: 'Agrega al menos una pieza antes de aprobar.', empty: true }
    if (!v.ok) return { ok: false, error: 'Hay piezas incompletas.', problems: v.problems }
  }

  const update: Partial<ContentMatrix> = { status: to }
  if (to === 'approved') { update.approved_by = userId; update.approved_at = new Date().toISOString() }
  if (to === 'draft') { update.approved_by = null; update.approved_at = null }
  if (to === 'closed') update.closed_at = new Date().toISOString()

  const { data: matrix, error } = await supabase.from('content_matrices').update(update).eq('id', matrixId).select('*').single()
  if (error || !matrix) return { ok: false, error: dbError(error, 'No se pudo cambiar el estado.') }
  revalidateMatrix(matrix.client_id, matrixId)
  return { ok: true, matrix: matrix as ContentMatrix }
}

export async function deleteMatrix(matrixId: string): Promise<ActionResult> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: m } = await supabase.from('content_matrices')
    .select('id, client_id, status, matrix_requirement_id').eq('id', matrixId).single()
  if (!m) return { ok: false, error: 'Matriz no encontrada.' }
  if (m.status !== 'draft') return { ok: false, error: 'Solo se puede eliminar una matriz en borrador.' }

  // 1) Borrar la matriz primero. La FK matrix_requirement_id es ON DELETE SET NULL en la
  //    dirección inversa, así que no bloquea. Si esto falla, nada más cambió.
  const { error } = await supabase.from('content_matrices').delete().eq('id', matrixId)
  if (error) return { ok: false, error: error.message }

  // 2) Limpiar el requerimiento vinculado solo si no tiene tiempo registrado
  //    (time_entries.requirement_id es ON DELETE CASCADE: hay que comprobarlo antes).
  //    Un fallo aquí no revierte el borrado de la matriz: queda un requerimiento huérfano
  //    visible en el perfil del cliente, que el admin puede anular a mano.
  const reqId = m.matrix_requirement_id
  if (reqId) {
    const admin = createAdminClient()
    const { count } = await admin.from('time_entries').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId)
    if ((count ?? 0) === 0) {
      // Orden obligatorio del proyecto: requirement_phase_logs → requirements
      const { error: e1 } = await admin.from('requirement_phase_logs').delete().eq('requirement_id', reqId)
      const { error: e2 } = e1 ? { error: e1 } : await admin.from('requirements').delete().eq('id', reqId)
      if (e1 || e2) console.error('[deleteMatrix] no se pudo borrar el requerimiento vinculado', (e1 ?? e2)?.message)
    }
  }

  revalidateMatrix(m.client_id, matrixId)
  return { ok: true }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores (las funciones importadas para la Task 12 — `validateItemPatch`, `proposeDeadline`, `shiftDeadline`, `MATRIX_CONTENT_TYPES`, `ItemPatch`, `ContentType`, `loadMatrixEditorData`, `sharedTypesFor` — quedarán "unused" hasta la siguiente task; lint lo marcará, se resuelve en la Task 12).

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/matrices.ts
git commit -m "feat(matrices): server actions de matriz — crear, actualizar, estado, borrar y vínculo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Server actions — piezas y duplicar matriz

**Files:**
- Modify: `src/app/actions/matrices.ts`

- [ ] **Step 1: Añadir las acciones de piezas**

Al final de `src/app/actions/matrices.ts`:

```ts
// ── Piezas ───────────────────────────────────────────────────────────────────

async function loadMatrixForItemWrite(ctx: Ctx, matrixId: string) {
  const { data } = await ctx.supabase.from('content_matrices')
    .select('id, client_id, status, period_start, period_end, topics_json').eq('id', matrixId).single()
  if (!data) return { error: 'Matriz no encontrada.' as const }
  if (data.status === 'closed') return { error: 'La matriz está cerrada.' as const }
  return { matrix: data }
}

function cleanText(v: string | null | undefined): string | null {
  const s = v?.trim()
  return s ? s : null
}

export async function addItem(matrixId: string, contentType: ContentType, deadline?: string): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!MATRIX_CONTENT_TYPES.includes(contentType)) return { ok: false, error: 'Ese tipo no se planifica en la matriz.' }

  const data = await loadMatrixEditorData(ctx.supabase, matrixId)
  if (!data) return { ok: false, error: 'Matriz no encontrada.' }
  if (data.matrix.status === 'closed') return { ok: false, error: 'La matriz está cerrada.' }

  const chosen = deadline ?? proposeDeadline({
    contentType,
    items: data.items,
    distribution: data.distribution,
    periodStart: data.period.periodStart,
    periodEnd: data.period.periodEnd,
    maxWeek: data.maxWeek,
    sharedTypes: sharedTypesFor(data.limits),
  })
  const v = validateItemPatch({ deadline: chosen }, { ...data.period, topics: data.matrix.topics_json })
  if (!v.ok) return { ok: false, error: v.error }

  const { data: item, error } = await ctx.supabase.from('content_matrix_items')
    .insert({ matrix_id: matrixId, content_type: contentType, deadline: chosen })
    .select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo agregar la pieza.') }
  revalidateMatrix(data.matrix.client_id, matrixId)
  return { ok: true, item: item as ContentMatrixItem }
}

export async function updateItem(itemId: string, patch: ItemPatch): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: existing } = await supabase.from('content_matrix_items').select('id, matrix_id, status').eq('id', itemId).single()
  if (!existing) return { ok: false, error: 'Pieza no encontrada.' }
  if (existing.status === 'converted') return { ok: false, error: 'La pieza ya se convirtió en requerimiento; edítala desde el pipeline.' }
  const m = await loadMatrixForItemWrite(ctx, existing.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const v = validateItemPatch(patch, { periodStart: m.matrix.period_start, periodEnd: m.matrix.period_end, topics: m.matrix.topics_json })
  if (!v.ok) return { ok: false, error: v.error }

  const update: ItemPatch = {}
  if (patch.content_type !== undefined) update.content_type = patch.content_type
  if (patch.title !== undefined) update.title = patch.title.trim()
  if (patch.deadline !== undefined) update.deadline = patch.deadline
  if (patch.needs_production !== undefined) update.needs_production = patch.needs_production
  if (patch.objective !== undefined) update.objective = patch.objective
  if (patch.topic !== undefined) update.topic = cleanText(patch.topic)
  for (const k of ['copy', 'script', 'visual_style', 'hashtags', 'cta'] as const) {
    if (patch[k] !== undefined) update[k] = cleanText(patch[k])
  }

  const { data: item, error } = await supabase.from('content_matrix_items').update(update).eq('id', itemId).select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo guardar la pieza.') }
  revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true, item: item as ContentMatrixItem }
}

export async function duplicateItem(itemId: string): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: src } = await supabase.from('content_matrix_items').select('*').eq('id', itemId).single()
  if (!src) return { ok: false, error: 'Pieza no encontrada.' }
  const m = await loadMatrixForItemWrite(ctx, src.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const { data: item, error } = await supabase.from('content_matrix_items').insert({
    matrix_id: src.matrix_id, content_type: src.content_type, title: src.title, topic: src.topic,
    objective: src.objective, copy: src.copy, script: src.script, visual_style: src.visual_style,
    hashtags: src.hashtags, cta: src.cta, deadline: src.deadline, needs_production: src.needs_production,
  }).select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo duplicar la pieza.') }
  revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true, item: item as ContentMatrixItem }
}

export async function deleteItem(itemId: string): Promise<ActionResult> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: existing } = await supabase.from('content_matrix_items').select('id, matrix_id, status').eq('id', itemId).single()
  if (!existing) return { ok: false, error: 'Pieza no encontrada.' }
  if (existing.status === 'converted') return { ok: false, error: 'La pieza ya se convirtió en requerimiento.' }
  const m = await loadMatrixForItemWrite(ctx, existing.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const { error } = await supabase.from('content_matrix_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true }
}

// ── Duplicar matriz ──────────────────────────────────────────────────────────

export async function duplicateMatrix(sourceId: string, target: { periodStart: string; periodEnd: string }): Promise<ActionResult<{ id: string; link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  const [{ data: src }, { data: srcItems }] = await Promise.all([
    supabase.from('content_matrices').select('*').eq('id', sourceId).single(),
    supabase.from('content_matrix_items').select('*').eq('matrix_id', sourceId),
  ])
  if (!src) return { ok: false, error: 'Matriz no encontrada.' }

  const { data: existing } = await supabase.from('content_matrices').select('id')
    .eq('client_id', src.client_id).eq('period_start', target.periodStart).maybeSingle()
  if (existing) return { ok: false, error: 'Ya existe una matriz para ese período.' }

  const { data: cycleRows } = await supabase.from('billing_cycles').select('id')
    .eq('client_id', src.client_id).eq('period_start', target.periodStart).in('status', ['current', 'scheduled']).limit(1)

  const { data: created, error } = await supabase.from('content_matrices').insert({
    client_id: src.client_id,
    period_start: target.periodStart,
    period_end: target.periodEnd,
    billing_cycle_id: cycleRows?.[0]?.id ?? null,
    title: matrixTitleFor(target.periodStart, target.periodEnd),
    topics_json: src.topics_json,
    notes: src.notes,
    lead_days: src.lead_days,
    created_by: userId,
  }).select('id').single()
  if (error || !created) return { ok: false, error: dbError(error, 'No se pudo duplicar la matriz.') }

  const from = { periodStart: src.period_start, periodEnd: src.period_end }
  const items = ((srcItems ?? []) as ContentMatrixItem[]).map((it) => ({
    matrix_id: created.id, content_type: it.content_type, title: it.title, topic: it.topic, objective: it.objective,
    copy: it.copy, script: it.script, visual_style: it.visual_style, hashtags: it.hashtags, cta: it.cta,
    deadline: shiftDeadline(it.deadline, from, target), needs_production: it.needs_production,
  }))
  if (items.length > 0) {
    const { error: itemsError } = await supabase.from('content_matrix_items').insert(items)
    if (itemsError) {
      await supabase.from('content_matrices').delete().eq('id', created.id)
      return { ok: false, error: itemsError.message }
    }
  }

  const link = await linkMatrixRequirement(ctx, created.id)
  revalidateMatrix(src.client_id, created.id)
  return { ok: true, id: created.id, link }
}
```

- [ ] **Step 2: Tipos y lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sin errores; ya no quedan imports sin uso en `matrices.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/matrices.ts
git commit -m "feat(matrices): server actions de piezas y duplicado de matriz

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Menú, chips de cupo y página `/matrices` (lista + faltantes)

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `src/components/matrices/MatrixChips.tsx`
- Create: `src/components/matrices/MissingMatricesPanel.tsx`
- Create: `src/components/matrices/MatricesTable.tsx`
- Create: `src/app/(app)/matrices/page.tsx`

- [ ] **Step 1: Entrada en el menú**

En `src/components/layout/Sidebar.tsx`, insertar en `navItems` justo después del objeto de `/solicitudes`:

```tsx
  {
    href: '/matrices',
    label: 'Matrices',
    allowedRoles: ['admin', 'supervisor'],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>
      </svg>
    ),
  },
```

Comprobar si `MobileSidebar.tsx` tiene su propia lista: `grep -n "'/solicitudes'" src/components/layout/MobileSidebar.tsx`. Si la tiene, añadir la misma entrada ahí.

- [ ] **Step 2: Chips de cupo (compartidos)**

`src/components/matrices/MatrixChips.tsx`:

```tsx
'use client'

import type { ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { usageTone, type MatrixUsage, type UsageTone } from '@/lib/domain/matrix'

const TONE_CLASS: Record<UsageTone, string> = {
  neutral: 'border-fm-surface-container-high text-fm-on-surface bg-fm-surface-container-low',
  full: 'border-green-300 text-green-700 bg-green-50 dark:bg-green-500/15 dark:text-green-200 dark:border-green-400/40',
  over: 'border-red-300 text-red-700 bg-red-50 dark:bg-red-500/15 dark:text-red-200 dark:border-red-400/40',
}

interface Props {
  usage: MatrixUsage
  estimated: boolean
  /** Si se pasa, cada chip es un botón que agrega una pieza de ese tipo. */
  onAdd?: (type: ContentType) => void
  disabled?: boolean
}

function Chip({ tone, icon, label, used, limit, credits, onClick, disabled }: {
  tone: UsageTone; icon: string; label: string; used: number; limit: number; credits: number
  onClick?: () => void; disabled?: boolean
}) {
  const content = (
    <>
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      <span>{label}</span>
      <span className="tabular-nums font-bold">{used} / {limit}</span>
      {credits > 0 && <span className="text-[10px] opacity-70">+{credits} créd.</span>}
      {onClick && <span className="material-symbols-outlined text-[14px] opacity-60">add</span>}
    </>
  )
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${TONE_CLASS[tone]}`
  if (!onClick) return <span className={cls}>{content}</span>
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={`Agregar ${label.toLowerCase()}`}
      className={`${cls} hover:brightness-95 disabled:opacity-50`}>
      {content}
    </button>
  )
}

export function MatrixChips({ usage, estimated, onAdd, disabled }: Props) {
  const poolTypes = usage.pool ? (TIPPABLE_CONTENT_TYPES as ContentType[]) : []
  const singles = usage.activeTypes.filter((t) => !poolTypes.includes(t))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {usage.pool && (
          <Chip tone={usageTone(usage.pool.used, usage.pool.limit, usage.pool.credits)} icon="stacks" label="Contenidos"
            used={usage.pool.used} limit={usage.pool.limit} credits={usage.pool.credits} />
        )}
        {singles.map((t) => {
          const u = usage.byType[t]
          return (
            <Chip key={t} tone={usageTone(u.used, u.limit, u.credits)} icon={CONTENT_ICONS[t]} label={CONTENT_TYPE_LABELS[t]}
              used={u.used} limit={u.limit} credits={u.credits}
              onClick={onAdd ? () => onAdd(t) : undefined} disabled={disabled} />
          )
        })}
        {usage.pool && onAdd && poolTypes.map((t) => (
          <button key={t} type="button" onClick={() => onAdd(t)} disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-fm-outline-variant px-2.5 py-1 text-[11px] text-fm-on-surface-variant hover:bg-fm-surface-container-low disabled:opacity-50">
            <span className="material-symbols-outlined text-[14px]">{CONTENT_ICONS[t]}</span>+ {CONTENT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {estimated && (
        <p className="text-[11px] text-fm-on-surface-variant">Cupos estimados según el plan actual: el ciclo objetivo aún no existe.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Panel de faltantes**

`src/components/matrices/MissingMatricesPanel.tsx`:

```tsx
'use client'

import Image from 'next/image'
import type { MissingMatrix } from '@/lib/data/matrices'

interface Props {
  missing: MissingMatrix[]
  onCreate: (m: MissingMatrix) => void
}

export function MissingMatricesPanel({ missing, onCreate }: Props) {
  if (missing.length === 0) return null
  const shown = missing.slice(0, 8)
  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-fm-primary">event_upcoming</span>
        <h2 className="text-sm font-semibold text-fm-on-surface">Sin matriz para el próximo ciclo</h2>
        <span className="text-xs text-fm-on-surface-variant">{missing.length} cliente{missing.length !== 1 && 's'}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {shown.map((m) => (
          <div key={m.clientId} className="flex items-center gap-3 rounded-xl border border-fm-surface-container-high bg-fm-surface-container-low px-3 py-2">
            {m.logoUrl
              ? <Image src={m.logoUrl} alt="" width={28} height={28} unoptimized className="rounded-full object-cover h-7 w-7" />
              : <span className="h-7 w-7 rounded-full bg-fm-primary/15 text-fm-primary text-xs font-bold flex items-center justify-center">{m.clientName.slice(0, 1)}</span>}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fm-on-surface truncate">{m.clientName}</p>
              <p className="text-[11px] text-fm-on-surface-variant truncate">{m.label}</p>
            </div>
            <button type="button" onClick={() => onCreate(m)}
              className="text-xs font-semibold text-fm-primary hover:underline whitespace-nowrap">Crear</button>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Tabla con filtros (filtrado en cliente)**

`src/components/matrices/MatricesTable.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import type { MatrixStatus } from '@/types/db'
import type { MatrixListRow } from '@/lib/data/matrices'
import { MATRIX_STATUS_LABELS } from '@/lib/domain/matrix'

const STATUS_CLASS: Record<MatrixStatus, string> = {
  draft: 'bg-fm-surface-container-high text-fm-on-surface-variant',
  approved: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  closed: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300',
}

export function StatusBadge({ status }: { status: MatrixStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}>{MATRIX_STATUS_LABELS[status]}</span>
}

function monthKey(d: string) { return d.slice(0, 7) }

export function MatricesTable({ rows }: { rows: MatrixListRow[] }) {
  const router = useRouter()
  const [status, setStatus] = useState<'' | MatrixStatus>('')
  const [clientId, setClientId] = useState('')
  const [month, setMonth] = useState('')

  const clients = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.client.id, r.client.name)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const months = useMemo(() => [...new Set(rows.map((r) => monthKey(r.period_start)))].sort().reverse(), [rows])

  const filtered = useMemo(() => rows.filter((r) =>
    (!status || r.status === status) && (!clientId || r.client.id === clientId) && (!month || monthKey(r.period_start) === month),
  ), [rows, status, clientId, month])

  const selectCls = 'rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-1.5 text-sm text-fm-on-surface'

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as '' | MatrixStatus)} className={selectCls}>
          <option value="">Todos los estados</option>
          {(Object.keys(MATRIX_STATUS_LABELS) as MatrixStatus[]).map((s) => <option key={s} value={s}>{MATRIX_STATUS_LABELS[s]}</option>)}
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectCls}>
          <option value="">Todos los clientes</option>
          {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
          <option value="">Todos los meses</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="ml-auto text-xs text-fm-on-surface-variant">{filtered.length} matriz{filtered.length !== 1 && 'es'}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant py-8 text-center">No hay matrices con esos filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-fm-on-surface-variant border-b border-fm-surface-container-high">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Período</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Piezas</th>
                <th className="py-2 pr-3 hidden md:table-cell">Última edición</th>
                <th className="py-2 pr-3 hidden md:table-cell">Aprobada por</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/matrices/${r.id}`)}
                  className="border-b border-fm-surface-container-high/60 hover:bg-fm-surface-container-low cursor-pointer">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.client.logo_url
                        ? <Image src={r.client.logo_url} alt="" width={24} height={24} unoptimized className="h-6 w-6 rounded-full object-cover" />
                        : <span className="h-6 w-6 rounded-full bg-fm-primary/15 text-fm-primary text-[10px] font-bold flex items-center justify-center">{r.client.name.slice(0, 1)}</span>}
                      <div className="min-w-0">
                        <p className="font-medium text-fm-on-surface truncate">{r.client.name}</p>
                        <p className="text-[11px] text-fm-on-surface-variant truncate">{r.title}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-fm-on-surface">{r.label}</td>
                  <td className="py-2.5 pr-3"><StatusBadge status={r.status} /></td>
                  <td className="py-2.5 pr-3 tabular-nums text-fm-on-surface">{r.item_count} / {r.capacity}</td>
                  <td className="py-2.5 pr-3 hidden md:table-cell text-fm-on-surface-variant whitespace-nowrap">{new Date(r.updated_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}</td>
                  <td className="py-2.5 pr-3 hidden md:table-cell text-fm-on-surface-variant">{r.approved_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Página `/matrices`**

`src/app/(app)/matrices/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { canManageMatrices } from '@/lib/domain/permissions'
import { TopNav } from '@/components/layout/TopNav'
import { loadMatricesList, loadMissingMatrices } from '@/lib/data/matrices'
import { MatricesPageClient } from '@/components/matrices/MatricesPageClient'
import type { Client } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function MatricesPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (!canManageMatrices(ctx.appUser.role)) redirect('/dashboard')

  const supabase = await createClient()
  const [rows, missing, { data: clients }] = await Promise.all([
    loadMatricesList(supabase),
    loadMissingMatrices(supabase),
    supabase.from('clients').select('*').in('status', ['active', 'paused', 'overdue']).order('name'),
  ])

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Matrices" />
      <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto w-full">
        <MatricesPageClient rows={rows} missing={missing} clients={(clients ?? []) as Client[]} />
      </div>
    </div>
  )
}
```

`src/components/matrices/MatricesPageClient.tsx` (une panel, tabla y diálogo; el diálogo se crea en la Task 14):

```tsx
'use client'

import { useState } from 'react'
import type { Client } from '@/types/db'
import type { MatrixListRow, MissingMatrix } from '@/lib/data/matrices'
import { MissingMatricesPanel } from './MissingMatricesPanel'
import { MatricesTable } from './MatricesTable'
import { NewMatrixDialog } from './NewMatrixDialog'

export function MatricesPageClient({ rows, missing, clients }: { rows: MatrixListRow[]; missing: MissingMatrix[]; clients: Client[] }) {
  const [dialog, setDialog] = useState<{ open: boolean; clientId?: string; periodStart?: string }>({ open: false })
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-fm-on-surface-variant">Planificación mensual de contenidos por cliente.</p>
        <button type="button" onClick={() => setDialog({ open: true })}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Nueva matriz
        </button>
      </div>
      <MissingMatricesPanel missing={missing} onCreate={(m) => setDialog({ open: true, clientId: m.clientId, periodStart: m.periodStart })} />
      <MatricesTable rows={rows} />
      <NewMatrixDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        clients={clients}
        initialClientId={dialog.clientId}
        initialPeriodStart={dialog.periodStart}
      />
    </>
  )
}
```

- [ ] **Step 6: Commit (la página compila al terminar la Task 14)**

```bash
git add src/components/layout/Sidebar.tsx src/components/matrices/MatrixChips.tsx src/components/matrices/MissingMatricesPanel.tsx src/components/matrices/MatricesTable.tsx src/components/matrices/MatricesPageClient.tsx "src/app/(app)/matrices/page.tsx"
git commit -m "feat(matrices): menú, chips de cupo y página de lista con faltantes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `NewMatrixDialog`

**Files:**
- Create: `src/components/matrices/NewMatrixDialog.tsx`

- [ ] **Step 1: Crear el diálogo**

```tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect'
import type { Client, MatrixTopic } from '@/types/db'
import { matrixTitleFor, type TargetPeriod } from '@/lib/domain/matrix'
import { createMatrix, listTargetPeriods } from '@/app/actions/matrices'
import { TopicsInput } from './MatrixTopicsBar'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: Client[]
  /** Cliente fijo (tarjeta del perfil) o preseleccionado (panel de faltantes). */
  initialClientId?: string
  initialPeriodStart?: string
  lockClient?: boolean
}

export function NewMatrixDialog({ open, onOpenChange, clients, initialClientId, initialPeriodStart, lockClient = false }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [periods, setPeriods] = useState<TargetPeriod[]>([])
  const [existing, setExisting] = useState<Record<string, string>>({})
  const [periodStart, setPeriodStart] = useState(initialPeriodStart ?? '')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [topics, setTopics] = useState<MatrixTopic[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset al abrir con otros valores iniciales. setState síncrono en efecto: patrón legacy
  // aceptado en el repo con el disable (regla react-hooks/set-state-in-effect es error aquí).
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientId(initialClientId ?? ''); setPeriodStart(initialPeriodStart ?? ''); setTitle(''); setTitleTouched(false); setTopics([]); setNotes(''); setError(null)
  }, [open, initialClientId, initialPeriodStart])

  // Cargar períodos al elegir cliente (setState dentro de callback async: permitido por la regla de hooks)
  useEffect(() => {
    if (!open || !clientId) return
    let cancelled = false
    listTargetPeriods(clientId).then((r) => {
      if (cancelled) return
      if (!r.ok) { setError(r.error); return }
      setPeriods(r.periods)
      setExisting(r.existing)
      setPeriodStart((cur) => cur && r.periods.some((p) => p.periodStart === cur) ? cur : (r.periods[0]?.periodStart ?? ''))
    })
    return () => { cancelled = true }
  }, [open, clientId])

  const period = useMemo(() => periods.find((p) => p.periodStart === periodStart) ?? null, [periods, periodStart])
  const suggestedTitle = useMemo(() => period ? matrixTitleFor(period.periodStart, period.periodEnd) : '', [period])
  const effectiveTitle = titleTouched ? title : suggestedTitle
  const existingId = period ? existing[period.periodStart] : undefined

  function submit() {
    if (!clientId || !period) return
    setError(null)
    startTransition(async () => {
      const r = await createMatrix({
        clientId, periodStart: period.periodStart, periodEnd: period.periodEnd,
        title: effectiveTitle, topics, notes: notes || null,
      })
      if (!r.ok) { setError(r.error); return }
      onOpenChange(false)
      router.push(`/matrices/${r.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl p-0 border border-fm-outline-variant/20 flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10 flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-fm-on-surface">Nueva matriz de contenido</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <ClientSearchSelect clients={clients} value={clientId} onChange={setClientId} disabled={lockClient} required />
          </div>

          {clientId && (
            <div className="space-y-1.5">
              <Label>Período objetivo *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {periods.map((p) => (
                  <label key={p.periodStart}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer text-sm ${periodStart === p.periodStart ? 'border-fm-primary bg-fm-primary/5' : 'border-fm-surface-container-high'}`}>
                    <input type="radio" name="period" className="mt-1" checked={periodStart === p.periodStart} onChange={() => setPeriodStart(p.periodStart)} />
                    <span>
                      <span className="block font-medium text-fm-on-surface">{p.label}</span>
                      <span className="block text-[11px] text-fm-on-surface-variant">
                        {p.isCurrent ? 'Ciclo vigente' : 'Ciclo futuro'}{existing[p.periodStart] ? ' · ya tiene matriz' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {existingId ? (
            <p className="text-sm rounded-xl bg-fm-primary/5 border border-fm-primary/20 px-3 py-2 text-fm-on-surface">
              Ya existe una matriz para ese período.{' '}
              <Link href={`/matrices/${existingId}`} className="font-semibold text-fm-primary hover:underline" onClick={() => onOpenChange(false)}>Abrir</Link>
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input value={effectiveTitle} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
                  className="rounded-xl bg-fm-background border-fm-surface-container-high" />
              </div>
              <div className="space-y-1.5">
                <Label>Temas del mes</Label>
                <TopicsInput topics={topics} onChange={setTopics} />
              </div>
              <div className="space-y-1.5">
                <Label>Enfoque del mes / notas de la reunión</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  className="rounded-xl bg-fm-background border-fm-surface-container-high" />
              </div>
            </>
          )}

          {error && <p className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-fm-outline-variant/10 flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-xl text-sm text-fm-on-surface-variant hover:bg-fm-surface-container-low">Cancelar</button>
          <button type="button" onClick={submit} disabled={isPending || !clientId || !period || !!existingId}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50">
            {isPending ? 'Creando…' : 'Crear matriz'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> `TopicsInput` se crea en la Task 15 dentro de `MatrixTopicsBar.tsx`. Si se ejecuta esta task antes, crear ahí un stub temporal con la firma `{ topics, onChange }`.

- [ ] **Step 2: Commit**

```bash
git add src/components/matrices/NewMatrixDialog.tsx
git commit -m "feat(matrices): diálogo de nueva matriz con períodos objetivo y temas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Editor — página, `MatrixEditor`, `MatrixHeader`, `MatrixTopicsBar`

**Files:**
- Create: `src/components/matrices/MatrixTopicsBar.tsx`
- Create: `src/components/matrices/MatrixHeader.tsx`
- Create: `src/components/matrices/MatrixEditor.tsx`
- Create: `src/app/(app)/matrices/[id]/page.tsx`

**Decisión de estado:** el editor guarda `matrix` e `items` en estado local (inicializados desde props) y **nunca llama `router.refresh()`**: cada acción devuelve la fila actualizada y el editor la aplica. El uso y la marca fuera de plan se recalculan en el cliente con `computeMatrixUsage(items, data.limits)` (función pura). Así no hay desincronía entre props refrescadas y estado local.

- [ ] **Step 1: Temas (input reutilizable + barra)**

`src/components/matrices/MatrixTopicsBar.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { MatrixTopic } from '@/types/db'
import { MAX_TOPICS, sanitizeTopics } from '@/lib/domain/matrix'

interface TopicsInputProps {
  topics: MatrixTopic[]
  onChange: (topics: MatrixTopic[]) => void
  /** Devuelve cuántas piezas usan el tema; si > 0 se pide confirmación antes de quitarlo. */
  usageCount?: (name: string) => number
  disabled?: boolean
}

export function TopicsInput({ topics, onChange, usageCount, disabled }: TopicsInputProps) {
  const [draft, setDraft] = useState('')

  function add() {
    const next = sanitizeTopics([...topics, { name: draft }])
    if (next.length !== topics.length) onChange(next)
    setDraft('')
  }

  function remove(name: string) {
    const n = usageCount?.(name) ?? 0
    if (n > 0 && !confirm(`${n} pieza${n !== 1 ? 's usan' : ' usa'} este tema. Se les quitará. ¿Continuar?`)) return
    onChange(topics.filter((t) => t.name !== name))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {topics.map((t) => (
        <span key={t.name} title={t.note}
          className="inline-flex items-center gap-1 rounded-lg bg-fm-primary/10 text-fm-primary px-2.5 py-1 text-xs font-medium">
          {t.name}
          {!disabled && (
            <button type="button" onClick={() => remove(t.name)} aria-label={`Quitar ${t.name}`}
              className="material-symbols-outlined text-[14px] hover:text-fm-error">close</button>
          )}
        </span>
      ))}
      {!disabled && topics.length < MAX_TOPICS && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          onBlur={() => { if (draft.trim()) add() }}
          placeholder={topics.length === 0 ? 'Tema del mes + Enter' : '+ tema'}
          className="min-w-[9rem] flex-1 bg-transparent border-b border-dashed border-fm-outline-variant px-1 py-1 text-xs text-fm-on-surface outline-none focus:border-fm-primary"
        />
      )}
    </div>
  )
}

interface BarProps extends TopicsInputProps {
  notes: string | null
  onNotesChange: (notes: string | null) => void
}

export function MatrixTopicsBar({ notes, onNotesChange, ...inputProps }: BarProps) {
  const [notesOpen, setNotesOpen] = useState(!!notes)
  const [draftNotes, setDraftNotes] = useState(notes ?? '')
  return (
    <section className="glass-panel rounded-2xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-[11px] uppercase tracking-wider text-fm-on-surface-variant pt-1.5 whitespace-nowrap">Temas del mes</span>
        <div className="flex-1"><TopicsInput {...inputProps} /></div>
        <button type="button" onClick={() => setNotesOpen((v) => !v)}
          className="text-[11px] text-fm-primary hover:underline whitespace-nowrap pt-1.5">
          {notesOpen ? 'Ocultar enfoque' : 'Enfoque del mes'}
        </button>
      </div>
      {notesOpen && (
        <textarea
          value={draftNotes}
          disabled={inputProps.disabled}
          onChange={(e) => setDraftNotes(e.target.value)}
          onBlur={() => { if ((draftNotes.trim() || null) !== (notes ?? null)) onNotesChange(draftNotes.trim() || null) }}
          rows={3}
          placeholder="Qué quiere comunicar el cliente este mes, apuntes de la reunión…"
          className="w-full rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface"
        />
      )}
    </section>
  )
}
```

- [ ] **Step 2: Cabecera**

`src/components/matrices/MatrixHeader.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { ContentMatrix, ContentType, MatrixStatus, Requirement } from '@/types/db'
import type { MatrixUsage } from '@/lib/domain/matrix'
import { MatrixChips } from './MatrixChips'
import { StatusBadge } from './MatricesTable'

interface Props {
  matrix: ContentMatrix
  client: { id: string; name: string; logo_url: string | null }
  periodLabel: string
  usage: MatrixUsage
  estimated: boolean
  saving: boolean
  linked: Pick<Requirement, 'id' | 'title' | 'phase'> | null
  linkError: string | null
  problemsCount: number
  onTitle: (title: string) => void
  onAdd: (type: ContentType) => void
  onStatus: (to: MatrixStatus) => void
  onDuplicate: () => void
  onDelete: () => void
  onRetryLink: () => void
}

export function MatrixHeader(p: Props) {
  const [title, setTitle] = useState(p.matrix.title)
  const readOnly = p.matrix.status === 'closed'
  const btn = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50'

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/matrices" className="text-fm-on-surface-variant hover:text-fm-primary mt-1" aria-label="Volver a matrices">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        {p.client.logo_url
          ? <Image src={p.client.logo_url} alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-full object-cover" />
          : <span className="h-10 w-10 rounded-full bg-fm-primary/15 text-fm-primary font-bold flex items-center justify-center">{p.client.name.slice(0, 1)}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/clients/${p.client.id}`} className="text-sm font-semibold text-fm-on-surface hover:underline">{p.client.name}</Link>
            <span className="text-xs text-fm-on-surface-variant">· {p.periodLabel}</span>
            <StatusBadge status={p.matrix.status} />
            <span className="text-[11px] text-fm-on-surface-variant ml-auto">{p.saving ? 'Guardando…' : 'Guardado'}</span>
          </div>
          <input
            value={title}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { const t = title.trim(); if (t && t !== p.matrix.title) p.onTitle(t); else setTitle(p.matrix.title) }}
            className="mt-1 w-full bg-transparent text-xl font-bold text-fm-on-surface outline-none border-b border-transparent focus:border-fm-primary"
            aria-label="Título de la matriz"
          />
        </div>
      </div>

      <MatrixChips usage={p.usage} estimated={p.estimated} onAdd={readOnly ? undefined : p.onAdd} />

      {!p.matrix.matrix_requirement_id && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span className="material-symbols-outlined text-[16px]">warning</span>
          <span>No se registró el requerimiento de matriz en el ciclo vigente{p.linkError ? `: ${p.linkError}` : '.'}</span>
          {!readOnly && <button type="button" onClick={p.onRetryLink} className="font-semibold underline ml-auto">Reintentar</button>}
        </div>
      )}
      {p.linked && (
        <p className="text-[11px] text-fm-on-surface-variant">
          Requerimiento de matriz vinculado: <span className="font-medium text-fm-on-surface">{p.linked.title}</span>
        </p>
      )}

      {p.problemsCount > 0 && (
        <p className="text-xs text-fm-error">Hay {p.problemsCount} pieza{p.problemsCount !== 1 && 's'} incompleta{p.problemsCount !== 1 && 's'} (resaltadas en la tabla). Corrígelas para aprobar.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {p.matrix.status === 'draft' && (
          <button type="button" onClick={() => p.onStatus('approved')} className={`${btn} bg-fm-primary text-white border-fm-primary hover:bg-fm-primary-dim`}>Aprobar matriz</button>
        )}
        {p.matrix.status === 'approved' && (
          <button type="button" onClick={() => p.onStatus('draft')} className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Volver a borrador</button>
        )}
        {!readOnly && (
          <button type="button" onClick={() => { if (confirm('¿Cerrar la matriz? Quedará en solo lectura.')) p.onStatus('closed') }}
            className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Cerrar</button>
        )}
        <button type="button" onClick={p.onDuplicate} className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Duplicar</button>
        {p.matrix.status === 'draft' && (
          <button type="button" onClick={p.onDelete} className={`${btn} border-fm-error/40 text-fm-error hover:bg-fm-error/5 ml-auto`}>Eliminar</button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: `MatrixEditor` (estado y mutaciones)**

`src/components/matrices/MatrixEditor.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixStatus, MatrixTopic } from '@/types/db'
import type { MatrixEditorData } from '@/lib/data/matrices'
import { computeMatrixUsage, type ApprovalProblem, type ItemPatch, type TargetPeriod } from '@/lib/domain/matrix'
import {
  addItem, deleteItem, deleteMatrix, duplicateItem, duplicateMatrix, listTargetPeriods,
  retryMatrixRequirementLink, setMatrixStatus, updateItem, updateMatrix,
} from '@/app/actions/matrices'
import { MatrixHeader } from './MatrixHeader'
import { MatrixTopicsBar } from './MatrixTopicsBar'
import { MatrixItemsTable } from './MatrixItemsTable'
import { MatrixItemSheet } from './MatrixItemSheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function MatrixEditor({ data }: { data: MatrixEditorData }) {
  const router = useRouter()
  const [matrix, setMatrix] = useState<ContentMatrix>(data.matrix)
  const [items, setItems] = useState<ContentMatrixItem[]>(data.items)
  const [linked, setLinked] = useState(data.linkedRequirement)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [problems, setProblems] = useState<ApprovalProblem[]>([])
  const [dupOpen, setDupOpen] = useState(false)
  const [dupPeriods, setDupPeriods] = useState<{ periods: TargetPeriod[]; existing: Record<string, string> } | null>(null)

  const usage = useMemo(() => computeMatrixUsage(items, data.limits), [items, data.limits])
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.deadline.localeCompare(b.deadline) || a.created_at.localeCompare(b.created_at)),
    [items],
  )
  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])
  const readOnly = matrix.status === 'closed'

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    setSaving((s) => s + 1)
    setError(null)
    try { return await fn() } finally { setSaving((s) => s - 1) }
  }

  // ── Matriz ──
  async function patchMatrix(patch: Parameters<typeof updateMatrix>[1]) {
    const r = await run(() => updateMatrix(matrix.id, patch))
    if (!r.ok) { setError(r.error); return }
    setMatrix(r.matrix)
  }
  function onTopics(topics: MatrixTopic[]) {
    const kept = new Set(topics.map((t) => t.name))
    setItems((list) => list.map((i) => (i.topic && !kept.has(i.topic) ? { ...i, topic: null } : i)))
    void patchMatrix({ topics })
  }
  async function onStatus(to: MatrixStatus) {
    setProblems([])
    const r = await run(() => setMatrixStatus(matrix.id, to))
    if (!r.ok) {
      setError(r.error)
      if ('problems' in r && r.problems) setProblems(r.problems)
      return
    }
    if ('matrix' in r) setMatrix(r.matrix)
  }
  async function onRetryLink() {
    const r = await run(() => retryMatrixRequirementLink(matrix.id))
    if (!r.ok) { setError(r.error); return }
    if (r.link.ok) {
      setMatrix((m) => ({ ...m, matrix_requirement_id: r.link.ok ? r.link.requirementId : null }))
      setLinked({ id: r.link.requirementId, title: matrix.title, phase: 'pendiente' })
      setLinkError(null)
    } else {
      setLinkError(r.link.error)
    }
  }
  async function onDelete() {
    if (!confirm('¿Eliminar esta matriz y todas sus piezas? Si el requerimiento de matriz ya tiene tiempo registrado, se conserva.')) return
    const r = await run(() => deleteMatrix(matrix.id))
    if (!r.ok) { setError(r.error); return }
    router.push('/matrices')
  }
  async function openDuplicate() {
    setDupOpen(true)
    if (!dupPeriods) {
      const r = await listTargetPeriods(matrix.client_id)
      if (r.ok) setDupPeriods({ periods: r.periods, existing: r.existing })
      else setError(r.error)
    }
  }
  async function onDuplicate(p: TargetPeriod) {
    const r = await run(() => duplicateMatrix(matrix.id, { periodStart: p.periodStart, periodEnd: p.periodEnd }))
    if (!r.ok) { setError(r.error); return }
    setDupOpen(false)
    router.push(`/matrices/${r.id}`)
  }

  // ── Piezas ──
  async function onAdd(type: ContentType) {
    const r = await run(() => addItem(matrix.id, type))
    if (!r.ok) { setError(r.error); return }
    setItems((list) => [...list, r.item])
    setSelectedId(r.item.id)
  }
  async function onPatchItem(itemId: string, patch: ItemPatch) {
    const prev = items
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
    const r = await run(() => updateItem(itemId, patch))
    if (!r.ok) { setItems(prev); setError(r.error); return }
    setItems((list) => list.map((i) => (i.id === itemId ? r.item : i)))
    setProblems((ps) => ps.filter((p) => p.itemId !== itemId))
  }
  async function onDuplicateItem(itemId: string) {
    const r = await run(() => duplicateItem(itemId))
    if (!r.ok) { setError(r.error); return }
    setItems((list) => [...list, r.item])
  }
  async function onDeleteItem(itemId: string) {
    if (!confirm('¿Eliminar esta pieza?')) return
    const prev = items
    setItems((list) => list.filter((i) => i.id !== itemId))
    if (selectedId === itemId) setSelectedId(null)
    const r = await run(() => deleteItem(itemId))
    if (!r.ok) { setItems(prev); setError(r.error) }
  }

  const topicUsage = (name: string) => items.filter((i) => i.topic === name).length

  return (
    <div className="space-y-4">
      <MatrixHeader
        matrix={matrix}
        client={{ id: data.client.id, name: data.client.name, logo_url: data.client.logo_url }}
        periodLabel={data.period.label}
        usage={usage}
        estimated={data.limits.estimated}
        saving={saving > 0}
        linked={linked}
        linkError={linkError}
        problemsCount={problems.length}
        onTitle={(title) => void patchMatrix({ title })}
        onAdd={(t) => void onAdd(t)}
        onStatus={(to) => void onStatus(to)}
        onDuplicate={() => void openDuplicate()}
        onDelete={() => void onDelete()}
        onRetryLink={() => void onRetryLink()}
      />

      {error && (
        <p className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
      )}

      <MatrixTopicsBar
        topics={matrix.topics_json}
        onChange={onTopics}
        usageCount={topicUsage}
        disabled={readOnly}
        notes={matrix.notes}
        onNotesChange={(notes) => void patchMatrix({ notes })}
      />

      <MatrixItemsTable
        items={sortedItems}
        usage={usage}
        problems={problems}
        selectedId={selectedId}
        readOnly={readOnly}
        onSelect={setSelectedId}
        onAdd={(t) => void onAdd(t)}
        onDuplicate={(id) => void onDuplicateItem(id)}
        onDelete={(id) => void onDeleteItem(id)}
      />

      <MatrixItemSheet
        item={selected}
        topics={matrix.topics_json}
        period={data.period}
        readOnly={readOnly}
        onClose={() => setSelectedId(null)}
        onPatch={(patch) => { if (selected) void onPatchItem(selected.id, patch) }}
      />

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="max-w-md rounded-2xl p-0 border border-fm-outline-variant/20">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10">
            <DialogTitle className="text-lg font-semibold text-fm-on-surface">Duplicar matriz</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-2">
            <p className="text-sm text-fm-on-surface-variant">Elige el período destino. Se copian temas, notas y piezas con las fechas corridas.</p>
            {!dupPeriods && <p className="text-xs text-fm-on-surface-variant">Cargando períodos…</p>}
            {dupPeriods?.periods.filter((p) => p.periodStart !== matrix.period_start).map((p) => {
              const exists = !!dupPeriods.existing[p.periodStart]
              return (
                <button key={p.periodStart} type="button" disabled={exists || saving > 0} onClick={() => void onDuplicate(p)}
                  className="w-full text-left rounded-xl border border-fm-surface-container-high px-3 py-2 text-sm hover:bg-fm-surface-container-low disabled:opacity-50">
                  {p.label}{exists && <span className="text-[11px] text-fm-on-surface-variant"> · ya tiene matriz</span>}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Página del editor**

`src/app/(app)/matrices/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { canManageMatrices } from '@/lib/domain/permissions'
import { TopNav } from '@/components/layout/TopNav'
import { loadMatrixEditorData } from '@/lib/data/matrices'
import { MatrixEditor } from '@/components/matrices/MatrixEditor'

export const dynamic = 'force-dynamic'

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (!canManageMatrices(ctx.appUser.role)) redirect('/dashboard')

  const supabase = await createClient()
  const data = await loadMatrixEditorData(supabase, id)
  if (!data) notFound()

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title={data.matrix.title || 'Matriz'} backHref="/matrices" />
      <div className="flex-1 p-3 sm:p-6 max-w-6xl mx-auto w-full">
        <MatrixEditor data={data} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit (compila al terminar la Task 16)**

```bash
git add src/components/matrices/MatrixTopicsBar.tsx src/components/matrices/MatrixHeader.tsx src/components/matrices/MatrixEditor.tsx "src/app/(app)/matrices/[id]/page.tsx"
git commit -m "feat(matrices): editor — cabecera con cupos y acciones, temas del mes, estado local

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Tabla de piezas y panel lateral

**Files:**
- Create: `src/components/matrices/MatrixItemsTable.tsx`
- Create: `src/components/matrices/MatrixItemSheet.tsx`

- [ ] **Step 1: Tabla de piezas (tarjetas en móvil) y selector "Agregar pieza"**

`src/components/matrices/MatrixItemsTable.tsx`:

```tsx
'use client'

import type { ContentMatrixItem, ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { formatDeadlineBadge } from '@/lib/domain/deadline'
import {
  APPROVAL_PROBLEM_LABELS, MATRIX_CONTENT_TYPES, MATRIX_OBJECTIVE_LABELS,
  type ApprovalProblem, type MatrixUsage,
} from '@/lib/domain/matrix'

const TYPE_CLASS: Record<string, string> = {
  historia: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  estatico: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  video_corto: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  reel: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  short: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
}

export function TypeBadge({ type }: { type: ContentType }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_CLASS[type] ?? 'bg-fm-surface-container-high'}`}>
      <span className="material-symbols-outlined text-[13px]">{CONTENT_ICONS[type]}</span>
      {CONTENT_TYPE_LABELS[type]}
    </span>
  )
}

interface Props {
  items: ContentMatrixItem[]
  usage: MatrixUsage
  problems: ApprovalProblem[]
  selectedId: string | null
  readOnly: boolean
  onSelect: (id: string) => void
  onAdd: (type: ContentType) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

export function MatrixItemsTable({ items, usage, problems, selectedId, readOnly, onSelect, onAdd, onDuplicate, onDelete }: Props) {
  const over = new Set(usage.overPlanItemIds)
  const problemById = new Map(problems.map((p) => [p.itemId, p.reason]))
  const inactive = MATRIX_CONTENT_TYPES.filter((t) => !usage.activeTypes.includes(t))

  const addSelect = !readOnly && (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value as ContentType) }}
      className="rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-1.5 text-sm text-fm-on-surface"
      aria-label="Agregar pieza"
    >
      <option value="">+ Agregar pieza…</option>
      <optgroup label="Con cupo">
        {usage.activeTypes.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
      </optgroup>
      {inactive.length > 0 && (
        <optgroup label="Sin cupo (quedará fuera de plan)">
          {inactive.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
        </optgroup>
      )}
    </select>
  )

  const rowActions = (it: ContentMatrixItem) => !readOnly && (
    <span className="flex items-center gap-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(it.id) }} title="Duplicar"
        className="material-symbols-outlined text-[18px] text-fm-on-surface-variant hover:text-fm-primary">content_copy</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(it.id) }} title="Eliminar"
        className="material-symbols-outlined text-[18px] text-fm-on-surface-variant hover:text-fm-error">delete</button>
    </span>
  )

  const flags = (it: ContentMatrixItem) => (
    <span className="flex flex-wrap gap-1">
      {it.needs_production && <span title="Necesita producción" className="material-symbols-outlined text-[16px] text-fm-primary">videocam</span>}
      {over.has(it.id) && <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200 px-2 py-0.5 text-[10px] font-semibold">Fuera de plan</span>}
      {problemById.has(it.id) && <span className="rounded-full bg-fm-error/10 text-fm-error px-2 py-0.5 text-[10px] font-semibold">{APPROVAL_PROBLEM_LABELS[problemById.get(it.id)!]}</span>}
    </span>
  )

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-fm-on-surface">Piezas del mes <span className="text-fm-on-surface-variant font-normal">· {items.length}</span></h2>
        {addSelect}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant py-10 text-center">
          Aún no hay piezas. Haz clic en un chip de cupo o en "Agregar pieza".
        </p>
      ) : (
        <>
          {/* Escritorio: tabla */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-fm-on-surface-variant border-b border-fm-surface-container-high">
                  <th className="py-2 pr-3">Entrega</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Tema</th>
                  <th className="py-2 pr-3">Título</th>
                  <th className="py-2 pr-3 hidden lg:table-cell">Objetivo</th>
                  <th className="py-2 pr-3"></th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} onClick={() => onSelect(it.id)}
                    className={`border-b border-fm-surface-container-high/60 cursor-pointer hover:bg-fm-surface-container-low ${selectedId === it.id ? 'bg-fm-primary/5' : ''} ${problemById.has(it.id) ? 'outline outline-1 outline-fm-error/40' : ''}`}>
                    <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums text-fm-on-surface">{formatDeadlineBadge(it.deadline)}</td>
                    <td className="py-2.5 pr-3"><TypeBadge type={it.content_type} /></td>
                    <td className="py-2.5 pr-3 text-fm-on-surface-variant truncate max-w-[10rem]">{it.topic ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-fm-on-surface max-w-[20rem] truncate">
                      {it.title || <span className="italic text-fm-on-surface-variant">Sin título</span>}
                    </td>
                    <td className="py-2.5 pr-3 hidden lg:table-cell text-fm-on-surface-variant">{it.objective ? MATRIX_OBJECTIVE_LABELS[it.objective] : '—'}</td>
                    <td className="py-2.5 pr-3">{flags(it)}</td>
                    <td className="py-2.5 text-right">{rowActions(it)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: tarjetas */}
          <div className="sm:hidden space-y-2">
            {items.map((it) => (
              <div key={it.id} onClick={() => onSelect(it.id)}
                className={`rounded-xl border p-3 space-y-1.5 ${selectedId === it.id ? 'border-fm-primary bg-fm-primary/5' : 'border-fm-surface-container-high'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs tabular-nums text-fm-on-surface-variant">{formatDeadlineBadge(it.deadline)}</span>
                  <TypeBadge type={it.content_type} />
                  <span className="ml-auto">{rowActions(it)}</span>
                </div>
                <p className="text-sm text-fm-on-surface">{it.title || <span className="italic text-fm-on-surface-variant">Sin título</span>}</p>
                <div className="flex items-center justify-between gap-2 text-[11px] text-fm-on-surface-variant">
                  <span>{it.topic ?? '—'}{it.objective ? ` · ${MATRIX_OBJECTIVE_LABELS[it.objective]}` : ''}</span>
                  {flags(it)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Panel lateral**

`src/components/matrices/MatrixItemSheet.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ContentMatrixItem, ContentType, MatrixObjective, MatrixTopic } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { MATRIX_CONTENT_TYPES, MATRIX_OBJECTIVES, MATRIX_OBJECTIVE_LABELS, type ItemPatch } from '@/lib/domain/matrix'

interface Props {
  item: ContentMatrixItem | null
  topics: MatrixTopic[]
  period: { periodStart: string; periodEnd: string; label: string }
  readOnly: boolean
  onClose: () => void
  onPatch: (patch: ItemPatch) => void
}

type TextKey = 'title' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta'

const inputCls = 'w-full rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60'
const labelCls = 'block text-[11px] uppercase tracking-wider text-fm-on-surface-variant mb-1'

export function MatrixItemSheet({ item, topics, period, readOnly, onClose, onPatch }: Props) {
  // Borradores locales de los campos de texto: se guardan al perder foco.
  const [draft, setDraft] = useState<Record<TextKey, string>>({ title: '', copy: '', script: '', visual_style: '', hashtags: '', cta: '' })

  useEffect(() => {
    if (!item) return
    // Sincroniza al cambiar de pieza (setState dentro de efecto por cambio de identidad: patrón legacy aceptado)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({
      title: item.title, copy: item.copy ?? '', script: item.script ?? '',
      visual_style: item.visual_style ?? '', hashtags: item.hashtags ?? '', cta: item.cta ?? '',
    })
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null

  function commitText(key: TextKey) {
    const value = draft[key]
    const current = key === 'title' ? item!.title : (item![key] ?? '')
    if (value.trim() === (current ?? '').trim()) return
    onPatch({ [key]: value } as ItemPatch)
  }

  const text = (key: TextKey, label: string, rows?: number, placeholder?: string) => (
    <div>
      <label className={labelCls}>{label}</label>
      {rows ? (
        <textarea rows={rows} value={draft[key]} disabled={readOnly} placeholder={placeholder}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} onBlur={() => commitText(key)} className={inputCls} />
      ) : (
        <input value={draft[key]} disabled={readOnly} placeholder={placeholder}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} onBlur={() => commitText(key)} className={inputCls} />
      )}
    </div>
  )

  return (
    <Sheet open={!!item} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent fullScreenOnMobile className="w-full sm:!max-w-md flex flex-col p-0 gap-0 overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-fm-outline-variant/10">
          <SheetTitle className="text-base font-semibold text-fm-on-surface truncate">{item.title || 'Pieza sin título'}</SheetTitle>
          <p className="text-[11px] text-fm-on-surface-variant">Período {period.label}</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              <select value={item.content_type} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ content_type: e.target.value as ContentType })}>
                {MATRIX_CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Entrega</label>
              <input type="date" value={item.deadline} min={period.periodStart} max={period.periodEnd} disabled={readOnly} className={inputCls}
                onChange={(e) => { if (e.target.value) onPatch({ deadline: e.target.value }) }} />
            </div>
            <div>
              <label className={labelCls}>Tema</label>
              <select value={item.topic ?? ''} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ topic: e.target.value || null })}>
                <option value="">Sin tema</option>
                {topics.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Objetivo</label>
              <select value={item.objective ?? ''} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ objective: (e.target.value || null) as MatrixObjective | null })}>
                <option value="">—</option>
                {MATRIX_OBJECTIVES.map((o) => <option key={o} value={o}>{MATRIX_OBJECTIVE_LABELS[o]}</option>)}
              </select>
            </div>
          </div>

          {text('title', 'Título', undefined, 'Ej. Llegó el pumpkin latte')}
          {text('copy', 'Copy', 4, 'Texto de la publicación')}
          {text('script', 'Guión', 6, 'Escenas, locución, textos en pantalla…')}
          {text('visual_style', 'Estilo visual', 2, 'Paleta, referencias, tono de imagen')}
          {text('hashtags', 'Hashtags', undefined, '#marca #tema')}
          {text('cta', 'Llamado a la acción', undefined, 'Ej. Ven a probarlo esta semana')}

          <label className="flex items-center gap-2 text-sm text-fm-on-surface">
            <input type="checkbox" checked={item.needs_production} disabled={readOnly}
              onChange={(e) => onPatch({ needs_production: e.target.checked })} />
            Necesita producción (grabación / sesión)
          </label>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Tipos, lint y arranque**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sin errores. Si `react-hooks/exhaustive-deps` protesta por `[item?.id]`, mantener el disable en línea (es intencional: resincronizar solo al cambiar de pieza).

Run: `npm run dev` y abrir `http://localhost:3000/matrices` con un usuario admin.
Expected: la página carga, "Nueva matriz" abre el diálogo, crear una matriz redirige al editor y agregar piezas por chip funciona.

- [ ] **Step 4: Commit**

```bash
git add src/components/matrices/MatrixItemsTable.tsx src/components/matrices/MatrixItemSheet.tsx
git commit -m "feat(matrices): tabla de piezas con tarjetas en móvil y panel lateral de edición

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Tarjeta en el perfil del cliente y documentación

**Files:**
- Create: `src/components/clients/ClientMatricesCard.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Tarjeta**

`src/components/clients/ClientMatricesCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Client } from '@/types/db'
import type { ClientMatrixSummary } from '@/lib/data/matrices'
import type { TargetPeriod } from '@/lib/domain/matrix'
import { StatusBadge } from '@/components/matrices/MatricesTable'
import { NewMatrixDialog } from '@/components/matrices/NewMatrixDialog'

interface Props {
  client: Client
  periods: TargetPeriod[]
  matrices: ClientMatrixSummary[]
}

export function ClientMatricesCard({ client, periods, matrices }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; periodStart?: string }>({ open: false })
  return (
    <section className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-fm-primary">grid_view</span>
        <h3 className="text-base font-semibold text-fm-on-surface">Matrices de contenido</h3>
        <Link href="/matrices" className="ml-auto text-xs font-semibold text-fm-primary hover:underline">Ver todas</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {periods.map((p) => {
          const m = matrices.find((x) => x.periodStart === p.periodStart)
          return (
            <div key={p.periodStart} className="rounded-xl border border-fm-surface-container-high bg-fm-surface-container-low p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-fm-primary">{p.isCurrent ? 'Ciclo vigente' : 'Próximo ciclo'}</p>
              <p className="text-xs text-fm-on-surface-variant">{p.label}</p>
              {m ? (
                <>
                  <div className="flex items-center gap-2">
                    <Link href={`/matrices/${m.id}`} className="text-sm font-semibold text-fm-on-surface hover:underline truncate">{m.title}</Link>
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="text-[11px] text-fm-on-surface-variant">{m.itemCount} pieza{m.itemCount !== 1 && 's'}</p>
                </>
              ) : (
                <button type="button" onClick={() => setDialog({ open: true, periodStart: p.periodStart })}
                  className="text-sm font-semibold text-fm-primary hover:underline">+ Crear matriz</button>
              )}
            </div>
          )
        })}
      </div>
      <NewMatrixDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        clients={[client]}
        initialClientId={client.id}
        initialPeriodStart={dialog.periodStart}
        lockClient
      />
    </section>
  )
}
```

- [ ] **Step 2: Insertar en la página del cliente**

En `src/app/(app)/clients/[id]/page.tsx`:

1. Imports: `import { loadClientMatrices } from '@/lib/data/matrices'` y `import { ClientMatricesCard } from '@/components/clients/ClientMatricesCard'`.
2. Tras `const credits = await listClientCredits(id)` añadir:

```ts
  const clientMatrices = canCreate ? await loadClientMatrices(supabase, client, cycle) : null
```

3. En el JSX, entre el bloque `{/* 1 — Requerimientos del ciclo ... */}` y `{/* 2 — Pipeline del ciclo actual */}`, insertar:

```tsx
        {/* 1b — Matrices de contenido (admin/supervisor) */}
        {clientMatrices && (
          <ClientMatricesCard client={client} periods={clientMatrices.periods} matrices={clientMatrices.matrices} />
        )}
```

- [ ] **Step 3: Documentar en `CLAUDE.md`**

Añadir en la tabla de migraciones la fila:

```
| 0129 | **Creador de matrices (bloque 1)**: `content_matrices` (una por cliente + período objetivo, estados draft/approved/closed, `topics_json`, `lead_days`, `matrix_requirement_id`) y `content_matrix_items` (piezas: tipo, título, tema, objetivo, copy, guión, estilo, hashtags, CTA, deadline, `needs_production`; `status`/`requirement_id` reservados para el bloque 2). RLS admin/supervisor. |
```

Y una sección nueva al final:

```
## Matrices de contenido (bloque 1 — 2026-09)
- Spec: `docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md`.
- Dominio puro: `src/lib/domain/matrix.ts` (períodos objetivo, cupos, fuera de plan, fecha propuesta, transiciones). Distribución semanal compartida: `buildEffectiveDistribution` en `weekly-distribution.ts` (acepta `weeks` de 8).
- Loaders: `src/lib/data/matrices.ts`. Acciones: `src/app/actions/matrices.ts`. UI: `src/components/matrices/*`, páginas `/matrices` y `/matrices/[id]`, tarjeta `ClientMatricesCard` en el perfil.
- La matriz se ancla al **ciclo de facturación** (`period_start`), no al mes calendario. Al crearla se registra solo el requerimiento `matriz_contenido` en el ciclo vigente (cliente autenticado → aplica el trigger de pago). Si falla, la matriz existe sin vínculo y el editor ofrece reintentar.
- Cupos excedidos = aviso ("fuera de plan"), nunca bloqueo. Bajo pool unificado los tippables comparten un chip; `historia` queda fuera del pool con límite 0.
- El editor no usa `router.refresh()`: estado local + resultado de cada acción; el uso se recalcula en cliente con `computeMatrixUsage`.
- Pendiente: bloque 2 (conversión automática a requerimientos) y bloque 3 (IA).
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sin errores. Abrir `/clients/<id>` con admin: aparece la tarjeta con "Ciclo vigente" y "Próximo ciclo"; "+ Crear matriz" abre el diálogo con el cliente bloqueado.

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/ClientMatricesCard.tsx "src/app/(app)/clients/[id]/page.tsx" CLAUDE.md
git commit -m "feat(matrices): tarjeta de matrices en el perfil del cliente y documentación

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Verificación final

**Files:** ninguno nuevo.

- [ ] **Step 1: Pruebas, lint y build**

```bash
npm run test
npm run lint
npm run build
```

Expected: todas las pruebas pasan; lint sin errores nuevos; build termina sin errores de tipos.

- [ ] **Step 2: RLS por rol**

Con un usuario **operador** logueado: `/matrices` redirige a `/dashboard`, el menú no muestra "Matrices", y en la consola del navegador `await (await import('/…')).…` no aplica — en su lugar, desde el SQL Editor de Supabase:

```sql
-- Simular al operador (reemplazar el uuid por uno real con role='operator')
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-operador>","role":"authenticated"}';
select count(*) from public.content_matrices;   -- Expected: 0 aunque existan filas
reset role;
```

- [ ] **Step 3: Recorrido manual (usar el skill superpowers:verification-before-completion antes de dar por terminado)**

Con admin o supervisor, comprobar y anotar resultado de cada punto:

1. `/matrices`: panel "Sin matriz para el próximo ciclo" lista clientes activos; "Crear" abre el diálogo con cliente y período preseleccionados.
2. Diálogo: al elegir cliente se cargan 4 períodos con el vigente marcado; el título se propone "Matriz <mes> <año>"; agregar temas con Enter; crear redirige al editor.
3. Editor con cliente **sin pago** en el ciclo vigente: franja ámbar "No se registró el requerimiento de matriz"; "Reintentar" muestra el mensaje del trigger. Tras marcar el pago, "Reintentar" vincula y la franja desaparece. En `/clients/<id>` aparece el requerimiento "Matriz …" en el contador de matrices.
4. Clic en un chip de cupo agrega una pieza con fecha propuesta dentro del período y abre el panel; el chip cambia a verde al llenar y a rojo al pasarse; la pieza excedente muestra "Fuera de plan".
5. Panel lateral: editar título, copy, guión, fecha (fuera del período se rechaza con mensaje), tema (solo los de la matriz), objetivo, casilla de producción (icono en la fila). Indicador "Guardando… / Guardado".
6. Quitar un tema en uso pide confirmación y limpia el tema en esas piezas.
7. "Aprobar" con una pieza sin título: mensaje y fila resaltada. Ponerle título y aprobar: badge "Aprobada". "Volver a borrador" funciona.
8. "Duplicar" a otro período: nueva matriz con piezas y fechas corridas; el período origen aparece deshabilitado si ya tiene matriz.
9. "Cerrar": todo en solo lectura salvo "Duplicar".
10. "Eliminar" solo visible en borrador; borra y vuelve a la lista.
11. Cliente con **plan de pool unificado**: chip único "Contenidos N / M"; una historia queda fuera de plan.
12. Cliente **sin ciclo vigente**: la cabecera dice "Cupos estimados según el plan actual".
13. Móvil (DevTools 375px): tabla → tarjetas, panel lateral a pantalla completa.
14. `/clients/<id>`: tarjeta con ciclo vigente y próximo; enlace al editor; "+ Crear matriz".

- [ ] **Step 4: Commit final si quedaron ajustes**

```bash
git add -A
git commit -m "fix(matrices): ajustes de verificación manual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

No hacer `git push` sin confirmación explícita del usuario.

---

## Fuera de alcance de este plan

Conversión automática a requerimientos y barrido diario (bloque 2); IA, perfil de marca y etiqueta de producción propuesta (bloque 3); portal del cliente; exportar a PDF/Excel; agrupar piezas en una producción; tiempo real en el editor; acceso de operadores.
