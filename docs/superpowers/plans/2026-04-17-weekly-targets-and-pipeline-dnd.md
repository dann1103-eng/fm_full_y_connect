# Weekly Targets + Pipeline Drag & Drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add descriptive weekly consumption targets per client (shown as progress bars in the weekly breakdown) and replace the click-to-move pipeline flow with drag-and-drop between Kanban columns.

**Architecture:** Two independent features. Feature 1 adds a `weekly_targets_json` column to `clients`, a shared utility in `consumption.ts`, and updates ConsumptionPanel + edit page. Feature 2 installs `@dnd-kit/core`, wraps the pipeline Kanban in a new `KanbanBoard` component, gates draggability on a new `PipelineCard` prop, and adds a `MovePhaseModal` that fires on drop.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Supabase (Postgres) · @dnd-kit/core + @dnd-kit/utilities

**Verification note:** No test framework is configured. Each task uses `npx tsc --noEmit` as the type-check gate and describes manual browser verification steps. Run the dev server with `npm run dev` from `fm-crm/`.

---

## File Map

### Feature 1 — Weekly Targets

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/0006_client_weekly_targets.sql` | Create | ADD COLUMN `weekly_targets_json jsonb` to `clients` |
| `src/types/db.ts` | Modify | Add `weekly_targets_json` to Client Row/Insert/Update |
| `src/lib/domain/consumption.ts` | Modify | Add `weeklyTarget()` + `effectiveWeeklyTarget()` helpers |
| `src/components/clients/ConsumptionPanel.tsx` | Modify | Weekly cards: replace count list with progress bars |
| `src/app/(app)/clients/[id]/edit/page.tsx` | Modify | Add "Objetivos semanales" section |

### Feature 2 — Pipeline Drag & Drop

| File | Action | Purpose |
|------|--------|---------|
| `src/components/pipeline/PipelineCard.tsx` | Modify | Add `draggable` prop; gate `useDraggable` + hide PhaseSheet when draggable |
| `src/components/pipeline/KanbanColumn.tsx` | Modify | Add `useDroppable`; accept `isDragging` prop for visual highlight |
| `src/components/pipeline/MovePhaseModal.tsx` | Create | Modal shown on drop: from→to phase, optional notes, calls `movePhase()` |
| `src/components/pipeline/KanbanBoard.tsx` | Create | `DndContext` wrapper; owns drag state, `DragOverlay`, opens `MovePhaseModal` |
| `src/app/(app)/pipeline/page.tsx` | Modify | Replace per-phase `KanbanColumn` renders with single `KanbanBoard` |

---

## Part 1 — Weekly Consumption Targets

---

### Task 1: SQL migration + TypeScript types

**Files:**
- Create: `supabase/migrations/0006_client_weekly_targets.sql`
- Modify: `src/types/db.ts`

- [ ] **Step 1.1 — Write the migration file**

```sql
-- supabase/migrations/0006_client_weekly_targets.sql
-- ============================================================
-- FM CRM — Migration 0006: Weekly targets per client
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS weekly_targets_json jsonb;
```

- [ ] **Step 1.2 — Run the migration in Supabase Dashboard**

Go to **Supabase Dashboard → SQL Editor**, paste and run the content of `0006_client_weekly_targets.sql`.
Verify in **Table Editor → clients** that the column `weekly_targets_json` appears with type `jsonb`.

- [ ] **Step 1.3 — Add the column to `src/types/db.ts`**

In the `clients` table definition, add to **Row**:
```ts
weekly_targets_json: Partial<Record<ContentType, number>> | null
```
Add to **Insert**:
```ts
weekly_targets_json?: Partial<Record<ContentType, number>> | null
```
Add to **Update**:
```ts
weekly_targets_json?: Partial<Record<ContentType, number>> | null
```

- [ ] **Step 1.4 — Type-check**

```bash
cd fm-crm && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 1.5 — Commit**

```bash
git add supabase/migrations/0006_client_weekly_targets.sql src/types/db.ts
git commit -m "feat: weekly_targets_json column on clients + TS types"
```

---

### Task 2: `weeklyTarget` utility functions

**Files:**
- Modify: `src/lib/domain/consumption.ts`

- [ ] **Step 2.1 — Add the two helper functions at the bottom of `consumption.ts`**

```ts
/**
 * Default weekly target for a content type: monthly limit ÷ 4, rounded up.
 * Returns 0 when limit is 0 (inactive type — caller must guard with limit > 0).
 */
export function weeklyTarget(_type: ContentType, limit: number): number {
  return Math.ceil(limit / 4)
}

/**
 * Resolve the effective weekly target for a client, falling back to the default.
 * Use for both display (ConsumptionPanel) and edit-form placeholder.
 */
export function effectiveWeeklyTarget(
  type: ContentType,
  monthlyLimit: number,
  clientTargets: Partial<Record<ContentType, number>> | null | undefined
): number {
  return clientTargets?.[type] ?? weeklyTarget(type, monthlyLimit)
}
```

- [ ] **Step 2.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2.3 — Manual smoke test**

Open the browser console on any page of the dev server and confirm the logic mentally:
- `Math.ceil(12 / 4)` = `3` (Básico historias)
- `Math.ceil(16 / 4)` = `4` (Profesional historias)
- `Math.ceil(1 / 4)` = `1` (Básico produccion)

- [ ] **Step 2.4 — Commit**

```bash
git add src/lib/domain/consumption.ts
git commit -m "feat: weeklyTarget and effectiveWeeklyTarget helpers"
```

---

### Task 3: Progress bars in ConsumptionPanel weekly cards

**Files:**
- Modify: `src/components/clients/ConsumptionPanel.tsx`

The weekly breakdown currently shows a per-type count list inside each week card. Replace it with progress-bar rows using `effectiveWeeklyTarget`.

**What to read first:** Lines 361–447 of `ConsumptionPanel.tsx` (the "Weekly breakdown" section). Focus on the `presentTypes` map and the inner card render.

- [ ] **Step 3.1 — Add the import**

At the top of `ConsumptionPanel.tsx`, add to the consumption import line:
```ts
import { groupByWeek, effectiveWeeklyTarget } from '@/lib/domain/consumption'
```

- [ ] **Step 3.2 — Pass `limits` into the weekly card render**

`limits` is already available in scope as a prop of `ConsumptionPanel`. No new props needed.

- [ ] **Step 3.3 — Remove dead variable declarations**

Before replacing the render block, find and **delete** the two variable declarations that will become unused after Step 3.4. They live just above the `presentTypes` render block (around lines 403–409). Search the file for `const countByType` and `const presentTypes` and remove both declarations (including all lines they span). Leaving them produces an "unused variable" TypeScript error.

- [ ] **Step 3.4 — Replace the weekly card inner content**

Find the block that renders `presentTypes` (around line 430 — now a few lines higher after the deletion). Replace it with:

```tsx
{/* Per-type progress bars */}
{activeTypes.length === 0 ? (
  <p className="text-xs text-[#abadaf]">Sin consumos</p>
) : (
  <div className="space-y-3">
    {activeTypes.map((type) => {
      const consumed = items.filter(
        (c) => c.content_type === type && !c.voided && !c.carried_over
      ).length
      const target = effectiveWeeklyTarget(type, limits[type], client.weekly_targets_json ?? null)
      const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0
      const barColor =
        isFuture
          ? '#e5e9eb'
          : consumed >= target
          ? '#00675c'
          : '#f59e0b'

      return (
        <div key={type}>
          <div className="flex justify-between items-center mb-1">
            <span className="flex items-center gap-1 text-[11px] text-[#595c5e] font-medium">
              <span className="material-symbols-outlined text-sm">{CONTENT_ICONS[type]}</span>
              {CONTENT_TYPE_LABELS[type]}
            </span>
            <span className="text-[11px] font-bold text-[#2c2f31]">
              {consumed}
              <span className="font-normal text-[#abadaf]">/{target}</span>
            </span>
          </div>
          <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
          </div>
        </div>
      )
    })}
  </div>
)}
```

**Note on `items`:** The variable `items` comes from `weeklyGroups[weekKey] ?? []` in the existing code. `isFuture` is the existing boolean. `client` is available as a prop.

- [ ] **Step 3.5 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3.6 — Manual verification**

Run `npm run dev`, open a client with an active cycle. In the "Desglose semanal" section:
- Semanas pasadas: cada tipo muestra barra verde (si consumido ≥ objetivo) o ámbar (si debajo)
- Semana actual: barra en color según progreso
- Semanas futuras: barra gris vacía

- [ ] **Step 3.7 — Commit**

```bash
git add src/components/clients/ConsumptionPanel.tsx
git commit -m "feat: progress bars por tipo en desglose semanal de ConsumptionPanel"
```

---

### Task 4: "Objetivos semanales" in the edit client page

**Files:**
- Modify: `src/app/(app)/clients/[id]/edit/page.tsx`

- [ ] **Step 4.1 — Add imports**

At the top of `edit/page.tsx`:
```ts
import { effectiveWeeklyTarget } from '@/lib/domain/consumption'
import { limitsToRecord, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
```

- [ ] **Step 4.2 — Add separate state for weekly targets**

Add a **separate** `useState` for weekly targets. Do **not** embed this inside the main `form` state — keep them independent:

```ts
const [weeklyTargets, setWeeklyTargets] = useState<Partial<Record<ContentType, number>>>({})
```

In the `load()` function, after `setForm(...)`:
```ts
setWeeklyTargets(clientData.weekly_targets_json ?? {})
```

- [ ] **Step 4.3 — Add monthly limits to the load function**

The `load()` function already fetches plans. Derive active limits after loading:
```ts
// After fetching clientData and plansData:
const activePlan = plansData?.find((p) => p.id === clientData.current_plan_id)
const activeLimits = activePlan ? limitsToRecord(activePlan.limits_json) : null
setLimits(activeLimits)
```

Add state:
```ts
const [limits, setLimits] = useState<Record<ContentType, number> | null>(null)
```

- [ ] **Step 4.4 — Add the "Objetivos semanales" UI section**

After the social fields section and before the "Notas internas" field, add:

```tsx
{/* ── Objetivos semanales ── */}
{limits && (
  <div className="col-span-2 pt-1">
    <p className="text-xs font-semibold text-[#abadaf] uppercase tracking-widest mb-3">
      Objetivos semanales{' '}
      <span className="normal-case font-normal text-[#747779]">
        (descriptivo, no restringe — default: límite ÷ 4)
      </span>
    </p>
    <div className="grid grid-cols-2 gap-3">
      {(Object.entries(limits) as [ContentType, number][])
        .filter(([, lim]) => lim > 0)
        .map(([type, lim]) => {
          const defaultVal = effectiveWeeklyTarget(type as ContentType, lim, null)
          return (
            <div key={type} className="space-y-1.5">
              <Label>
                {CONTENT_TYPE_LABELS[type as ContentType]}{' '}
                <span className="text-[#abadaf] font-normal text-xs">
                  (def. {defaultVal}/sem)
                </span>
              </Label>
              <Input
                type="number"
                min={0}
                placeholder={String(defaultVal)}
                value={weeklyTargets[type] ?? ''}
                onChange={(e) =>
                  setWeeklyTargets((prev) => ({
                    ...prev,
                    [type]: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>
          )
        })}
    </div>
  </div>
)}
```

Add `ContentType` to the import from `@/types/db`.

- [ ] **Step 4.5 — Include `weekly_targets_json` in the update call**

In `handleSubmit`, inside the `.update({...})` call, add:
```ts
weekly_targets_json: buildWeeklyTargetsJson(weeklyTargets, limits),
```

Add the helper above `handleSubmit`:
```ts
function buildWeeklyTargetsJson(
  targets: Partial<Record<ContentType, number | undefined>>,
  limits: Record<ContentType, number> | null
): Partial<Record<ContentType, number>> | null {
  if (!limits) return null
  const result: Partial<Record<ContentType, number>> = {}
  for (const [type, val] of Object.entries(targets) as [ContentType, number | undefined][]) {
    if (val !== undefined && val !== effectiveWeeklyTarget(type, limits[type] ?? 0, null)) {
      result[type] = val
    }
  }
  return Object.keys(result).length > 0 ? result : null
}
```

- [ ] **Step 4.6 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4.7 — Manual verification**

1. Open a client edit page (admin login required).
2. Scroll to "Objetivos semanales" — confirm inputs appear for each active type with correct default placeholders.
3. Change one value (e.g. Historias → 5), save.
4. Re-open edit: the input shows 5.
5. Go to client consumption panel: progress bars in weekly cards use 5 as target for Historias.
6. Clear the custom value, save → `weekly_targets_json` reverts to `null`, default bars return.

- [ ] **Step 4.8 — Commit**

```bash
git add "src/app/(app)/clients/[id]/edit/page.tsx"
git commit -m "feat: seccion Objetivos semanales en formulario editar cliente"
```

---

## Part 2 — Pipeline Drag & Drop

---

### Task 5: Install @dnd-kit

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 5.1 — Install the packages**

```bash
cd fm-crm && npm install @dnd-kit/core @dnd-kit/utilities
```

- [ ] **Step 5.2 — Verify installation**

```bash
npx tsc --noEmit
```
Expected: no errors (new packages are JS, not TS, but they ship types).

- [ ] **Step 5.3 — Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit/core and @dnd-kit/utilities"
```

---

### Task 6: Make PipelineCard draggable (prop-gated)

**Files:**
- Modify: `src/components/pipeline/PipelineCard.tsx`

The card currently renders a `<button>` that opens `PhaseSheet` on click. When `draggable` is true, we attach `useDraggable`, show a grab cursor, and hide `PhaseSheet`.

- [ ] **Step 6.1 — Add the `draggable` prop and `useDraggable`**

Replace the entire file content with:

```tsx
'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { PhaseSheet } from './PhaseSheet'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { ConsumptionPhaseLog, Phase } from '@/types/db'

const CONTENT_TYPE_COLORS: Record<string, string> = {
  historia: 'bg-purple-100 text-purple-700',
  estatico: 'bg-blue-100 text-blue-700',
  video_corto: 'bg-orange-100 text-orange-700',
  reel: 'bg-pink-100 text-pink-700',
  short: 'bg-yellow-100 text-yellow-700',
}

interface PipelineCardProps {
  item: PipelineItem
  logs: ConsumptionPhaseLog[]
  currentUserId: string
  /** Si true, muestra el nombre del cliente en la card (vista global) */
  showClient?: boolean
  /** Si true, la card es arrastrable (solo en KanbanBoard del pipeline global) */
  draggable?: boolean
}

/** Exported so KanbanBoard can render it directly inside DragOverlay without
 *  triggering a second useDraggable registration with the same id. */
export function CardBody({
  item,
  showClient,
  style,
  dragHandleProps,
  isDragging,
  onClick,
}: {
  item: PipelineItem
  showClient: boolean
  style?: React.CSSProperties
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  isDragging?: boolean
  onClick?: () => void
}) {
  const relativeDate = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (diff === 0) return 'hoy'
    if (diff === 1) return 'hace 1 día'
    return `hace ${diff} días`
  }

  return (
    <div
      {...dragHandleProps}
      onClick={onClick}
      style={style}
      className={`w-full text-left bg-white rounded-2xl border border-[#dfe3e6] p-3 shadow-sm transition-all
        ${isDragging ? 'opacity-30' : 'hover:shadow-md hover:border-[#00675c]/30'}
        ${dragHandleProps ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
      `}
    >
      {showClient && (
        <div className="flex items-center gap-2 mb-2">
          {item.client_logo_url ? (
            <img
              src={item.client_logo_url}
              alt={item.client_name}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <div className="h-5 w-5 rounded-full bg-[#00675c]/20 flex items-center justify-center">
              <span className="text-[8px] font-bold text-[#00675c]">
                {item.client_name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-xs font-medium text-[#2c2f31] truncate">
            {item.client_name}
          </span>
        </div>
      )}

      <span
        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${
          CONTENT_TYPE_COLORS[item.content_type] ?? 'bg-gray-100 text-gray-700'
        }`}
      >
        {CONTENT_TYPE_LABELS[item.content_type]}
      </span>
      {item.carried_over && (
        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 bg-amber-100 text-amber-700 ml-1">
          Traslado
        </span>
      )}

      {item.notes && (
        <p className="text-xs text-[#595c5e] line-clamp-2 mb-2">{item.notes}</p>
      )}

      <p className="text-xs text-[#abadaf]">{relativeDate(item.last_moved_at)}</p>
    </div>
  )
}

export function PipelineCard({
  item,
  logs,
  currentUserId,
  showClient = true,
  draggable = false,
}: PipelineCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !draggable,
    data: { item },
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  if (draggable) {
    return (
      <div ref={setNodeRef} style={style}>
        <CardBody
          item={item}
          showClient={showClient}
          dragHandleProps={{ ...attributes, ...listeners }}
          isDragging={isDragging}
        />
      </div>
    )
  }

  // Non-draggable: click opens PhaseSheet (existing behaviour)
  return (
    <>
      <CardBody
        item={item}
        showClient={showClient}
        onClick={() => setSheetOpen(true)}
      />
      <PhaseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        consumptionId={item.id}
        contentType={item.content_type}
        currentPhase={item.phase as Phase}
        clientName={item.client_name}
        logs={logs}
        currentUserId={currentUserId}
      />
    </>
  )
}
```

- [ ] **Step 6.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6.3 — Verify ClientPipelineTab still works**

`ClientPipelineTab` passes `<PipelineCard item={...} logs={...} currentUserId={...} showClient={false} />` — no `draggable` prop, so it defaults to `false` and keeps the `PhaseSheet` click flow. Confirm by running dev server and opening a client detail page with pipeline items.

- [ ] **Step 6.4 — Commit**

```bash
git add src/components/pipeline/PipelineCard.tsx
git commit -m "feat: PipelineCard acepta prop draggable con useDraggable gated"
```

---

### Task 7: Make KanbanColumn a drop target

**Files:**
- Modify: `src/components/pipeline/KanbanColumn.tsx`

- [ ] **Step 7.1 — Add `useDroppable` and `isOver` highlight**

Replace the entire file:

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import { PipelineCard } from './PipelineCard'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface KanbanColumnProps {
  phase: Phase
  items: PipelineItem[]
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
  /** Si true, las cards son arrastrables (solo en KanbanBoard global) */
  draggableCards?: boolean
}

export function KanbanColumn({
  phase,
  items,
  logsMap,
  currentUserId,
  draggableCards = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: phase })

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#2c2f31]">{PHASE_LABELS[phase]}</h3>
        {items.length > 0 && (
          <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-2xl p-2 space-y-2 min-h-[120px] transition-colors ${
          isOver
            ? 'bg-[#00675c]/8 border-2 border-dashed border-[#00675c]'
            : 'bg-[#f5f7f9]'
        }`}
      >
        {items.length === 0 ? (
          <p className="text-xs text-[#abadaf] text-center py-4">Sin piezas</p>
        ) : (
          items.map((item) => (
            <PipelineCard
              key={item.id}
              item={item}
              logs={logsMap[item.id] ?? []}
              currentUserId={currentUserId}
              showClient
              draggable={draggableCards}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7.3 — Commit**

```bash
git add src/components/pipeline/KanbanColumn.tsx
git commit -m "feat: KanbanColumn con useDroppable y resaltado al hacer hover"
```

---

### Task 8: Create MovePhaseModal

**Files:**
- Create: `src/components/pipeline/MovePhaseModal.tsx`

- [ ] **Step 8.1 — Create the file**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { movePhase, PHASE_LABELS } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase } from '@/types/db'

interface MovePhaseModalProps {
  open: boolean
  item: PipelineItem | null
  fromPhase: Phase | null
  toPhase: Phase | null
  currentUserId: string
  onClose: () => void
}

export function MovePhaseModal({
  open,
  item,
  fromPhase,
  toPhase,
  currentUserId,
  onClose,
}: MovePhaseModalProps) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!item || !fromPhase || !toPhase) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: moveError } = await movePhase(supabase, {
      consumptionId: item.id,
      currentPhase: fromPhase,
      contentType: item.content_type,
      toPhase,
      movedBy: currentUserId,
      notes: notes.trim() || undefined,
    })

    if (moveError) {
      setError(moveError)
      setLoading(false)
      return
    }

    setNotes('')
    setLoading(false)
    router.refresh()
    onClose()
  }

  function handleClose() {
    if (loading) return
    setNotes('')
    setError(null)
    onClose()
  }

  if (!item || !fromPhase || !toPhase) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-sm rounded-2xl border border-[#abadaf]/20 p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-base font-semibold text-[#2c2f31]">
            Mover pieza
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-4">
          {/* Client + type */}
          <div>
            <p className="text-sm font-medium text-[#2c2f31]">{item.client_name}</p>
            <p className="text-xs text-[#595c5e]">{CONTENT_TYPE_LABELS[item.content_type]}</p>
          </div>

          {/* Phase transition pill */}
          <div className="flex items-center gap-2 text-sm">
            <span className="px-3 py-1 bg-[#f5f7f9] text-[#595c5e] rounded-full font-medium text-xs">
              {PHASE_LABELS[fromPhase]}
            </span>
            <span className="text-[#abadaf]">→</span>
            <span className="px-3 py-1 bg-[#00675c]/10 text-[#00675c] rounded-full font-semibold text-xs">
              {PHASE_LABELS[toPhase]}
            </span>
          </div>

          {/* Optional notes */}
          <div>
            <label className="text-xs font-medium text-[#595c5e] block mb-1.5">
              Nota <span className="font-normal text-[#abadaf]">(opcional)</span>
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. enviado a diseño, pendiente aprobación…"
              className="resize-none bg-[#f5f7f9] border-[#dfe3e6] rounded-xl text-sm"
              rows={3}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {loading ? 'Moviendo…' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 8.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8.3 — Commit**

```bash
git add src/components/pipeline/MovePhaseModal.tsx
git commit -m "feat: MovePhaseModal para confirmar movimiento de fase via drag and drop"
```

---

### Task 9: Create KanbanBoard (DndContext wrapper)

**Files:**
- Create: `src/components/pipeline/KanbanBoard.tsx`

This is the only client component that imports from `@dnd-kit/core` at the board level. It manages drag state and renders columns + the floating overlay.

- [ ] **Step 9.1 — Create the file**

```tsx
'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { KanbanColumn } from './KanbanColumn'
import { CardBody } from './PipelineCard'
import { MovePhaseModal } from './MovePhaseModal'
import { PHASES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface PendingMove {
  item: PipelineItem
  fromPhase: Phase
  toPhase: Phase
}

interface KanbanBoardProps {
  byPhase: Record<Phase, PipelineItem[]>
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
}

export function KanbanBoard({ byPhase, logsMap, currentUserId }: KanbanBoardProps) {
  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 5px of movement before activating drag (prevents accidental drags on click)
      activationConstraint: { distance: 5 },
    })
  )

  function onDragStart({ active }: DragStartEvent) {
    const item = active.data.current?.item as PipelineItem | undefined
    if (item) setActiveItem(item)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveItem(null)

    if (!over || !activeItem) return
    const toPhase = over.id as Phase
    if (toPhase === activeItem.phase) return   // dropped on same column — ignore

    setPendingMove({
      item: activeItem,
      fromPhase: activeItem.phase as Phase,
      toPhase,
    })
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 min-w-max h-full">
          {PHASES.map((phase) => (
            <KanbanColumn
              key={phase}
              phase={phase}
              items={byPhase[phase]}
              logsMap={logsMap}
              currentUserId={currentUserId}
              draggableCards
            />
          ))}
        </div>

        {/* Floating overlay card while dragging.
            We render CardBody directly (not PipelineCard) to avoid registering a
            second useDraggable with the same item.id — which would conflict with the
            original card's registration and may throw a React context error. */}
        <DragOverlay>
          {activeItem ? (
            <div className="rotate-1 scale-105 opacity-90">
              <CardBody item={activeItem} showClient />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Move confirmation modal — outside DndContext to avoid z-index issues */}
      <MovePhaseModal
        open={pendingMove !== null}
        item={pendingMove?.item ?? null}
        fromPhase={pendingMove?.fromPhase ?? null}
        toPhase={pendingMove?.toPhase ?? null}
        currentUserId={currentUserId}
        onClose={() => setPendingMove(null)}
      />
    </>
  )
}
```

- [ ] **Step 9.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9.3 — Commit**

```bash
git add src/components/pipeline/KanbanBoard.tsx
git commit -m "feat: KanbanBoard con DndContext, DragOverlay y MovePhaseModal"
```

---

### Task 10: Wire KanbanBoard into the pipeline page

**Files:**
- Modify: `src/app/(app)/pipeline/page.tsx`

- [ ] **Step 10.1 — Replace the import and render**

In `pipeline/page.tsx`:

Replace:
```ts
import { KanbanColumn } from '@/components/pipeline/KanbanColumn'
```
With:
```ts
import { KanbanBoard } from '@/components/pipeline/KanbanBoard'
```

Remove the import of `PHASES` if it's only used for rendering columns (it's still used to build `byPhase`, so keep it).

Replace the Kanban section (the `PHASES.map(...)` render block):
```tsx
{/* Kanban */}
<div className="flex-1 overflow-x-auto">
  <KanbanBoard
    byPhase={byPhase}
    logsMap={logsMap}
    currentUserId={authUser.id}
  />
</div>
```

Remove the now-unused `PHASE_LABELS` import from `pipeline` if it was only for the old column headers (they're now inside `KanbanColumn`).

- [ ] **Step 10.2 — Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 10.3 — Manual end-to-end verification**

1. Run `npm run dev`, open `/pipeline`.
2. Drag a card from one column to another — confirm card dims to 30% opacity and a floating copy follows the cursor.
3. Release on a different column — confirm `MovePhaseModal` appears with correct client name, content type, and phase arrow.
4. Click Cancelar — card returns to original column, no DB change.
5. Drag again, release, add a note, click Confirmar — modal shows loading state, closes on success, board refreshes with card in new column.
6. Check the phase log in Supabase `consumption_phase_logs` — confirm the new log row with correct `from_phase`, `to_phase`, `moved_by`, and note.
7. Open a client detail page with pipeline tab — confirm the click-to-move `PhaseSheet` still works (no drag handles visible).

- [ ] **Step 10.4 — Commit**

```bash
git add "src/app/(app)/pipeline/page.tsx"
git commit -m "feat: pipeline usa KanbanBoard con drag and drop"
```

---

### Task 11: Push to remote + verify deployment

- [ ] **Step 11.1 — Push all commits**

```bash
git push
```

- [ ] **Step 11.2 — Verify Vercel deployment**

Wait for Vercel auto-deploy (typically 1–2 minutes). Check the deployment logs for build errors.

- [ ] **Step 11.3 — Smoke test on production**

Repeat the manual verification from Task 10.3 on the production URL.
