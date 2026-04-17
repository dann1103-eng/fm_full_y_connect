# Design: Weekly Consumption Targets + Pipeline Drag & Drop

**Date:** 2026-04-17  
**Status:** Approved  
**Project:** FM CRM — FM Communication Solutions

---

## Context

The CRM tracks monthly content consumption per client against plan limits. Two new features are being added:

1. **Weekly consumption targets** — descriptive (non-restrictive) per-week breakdown of expected output, shown as progress bars inside the existing weekly breakdown section of the client consumption panel.
2. **Pipeline drag & drop** — replace the current click-to-select-phase flow with drag-and-drop between Kanban columns, with an optional-notes modal on drop.

---

## Feature 1: Weekly Consumption Targets

### Goal

Give the team a quick visual signal of whether a client's content output is on pace week by week, without adding hard restrictions.

### Data Model

**Migration `0006_client_weekly_targets.sql`:**
```sql
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS weekly_targets_json jsonb;
```

**Structure of `weekly_targets_json`:**  
A partial record of `ContentType → number` (same keys as ContentType). `null` means "use default for all types."

```ts
// Example: only types the user customised are stored
{ "historia": 3, "reel": 1 }
```

**Default computation:**
```ts
weeklyTarget(type, limit) = Math.ceil(limit / 4)
// If limit === 0 the type is inactive and is never shown — this value is never used.
client.effectiveWeeklyTarget(type) = client.weekly_targets_json?.[type] ?? weeklyTarget(type, monthlyLimit[type])
```

**RLS posture:** The existing UPDATE policy on `clients` allows any authenticated agency user to update any column. The edit page (`/clients/[id]/edit`) enforces admin-only at the application layer (server-side redirect at load time). This posture is **accepted as-is** — column-level RLS is not added for `weekly_targets_json`.

**Type update (`src/types/db.ts`):**
- Add `weekly_targets_json: Partial<Record<ContentType, number>> | null` to Client `Row`, `Insert`, `Update`.

### Shared utility function

Add `weeklyTarget(type: ContentType, limit: number): number` to **`src/lib/domain/consumption.ts`**:

```ts
/** Default weekly target for a content type: monthly limit ÷ 4, rounded up. */
export function weeklyTarget(type: ContentType, limit: number): number {
  return Math.ceil(limit / 4)
}

/** Resolve the effective weekly target for a client, falling back to the default. */
export function effectiveWeeklyTarget(
  type: ContentType,
  monthlyLimit: number,
  clientTargets: Partial<Record<ContentType, number>> | null
): number {
  return clientTargets?.[type] ?? weeklyTarget(type, monthlyLimit)
}
```

Both `ConsumptionPanel` and the edit page import from here. No duplication.

### Display — ConsumptionPanel weekly breakdown

**Semantics:** Weekly counts must match `computeTotals` semantics — voided and `carried_over` consumptions are **excluded** from the count used in progress bars, consistent with the monthly totals shown above.

Each of the four week cards (`S1–S4`) replaces the plain count list with a progress bar row per **active** content type (i.e. `limits[type] > 0` — same filter already used by `ConsumptionPanel`):

```
📖 Historias    [████░░] 3 / 4
📷 Estáticos    [██████] 2 / 2
🎬 Video largo  [░░░░░░] 0 / 1
```

Bar colour:
- **Green (`#00675c`)** — consumed ≥ weekly target, or week is in the future (full empty bar = grey)
- **Amber (`#f59e0b`)** — consumed < weekly target on past or current weeks
- **Grey (`#e5e9eb`)** — future week (bar always empty/grey regardless of count)

### Edit UI — `/clients/[id]/edit`

New section **"Objetivos semanales"** added below the social fields section. Only shown for active content types (`limits[type] > 0` from the client's current plan snapshot — fetched alongside plans in the existing `load()` call).

- One numeric `<Input min={1}>` per active type
- Placeholder = `effectiveWeeklyTarget(type, limit, null)` (the default, shown as placeholder text)
- Leaving a field blank = use the default (field not written to JSON)
- On submit: build `weekly_targets_json` with only keys where the user entered a value. If all fields are blank (or all match the default), save `null`.

---

## Feature 2: Pipeline Drag & Drop

### Goal

Let operators move pipeline cards between phases by dragging, instead of the current click-to-move flow. A modal appears on drop for optional notes before confirming.

### Library

**`@dnd-kit/core`** + **`@dnd-kit/utilities`**

```bash
npm install @dnd-kit/core @dnd-kit/utilities
```

### Architecture

| Component | Change | Responsibility |
|---|---|---|
| `KanbanBoard` (new) | Wraps in `DndContext` | Owns drag state, `onDragStart`/`onDragEnd`, renders `DragOverlay` |
| `KanbanColumn` | Add `useDroppable` | Drop target; highlights when hovered |
| `PipelineCard` | Add `useDraggable` prop-gated | Draggable only when `draggable` prop is `true` |
| `MovePhaseModal` (new) | Drop confirmation modal | `fromPhase → toPhase`, optional notes, calls `movePhase()` |
| `DragOverlay` | Floating card clone | Rendered inside `DndContext`, follows cursor |

### Dual-context PipelineCard

`PipelineCard` is used in two contexts:
1. **Main `/pipeline` page** — inside `KanbanBoard` with drag & drop enabled. The existing click-to-move PhaseSheet is removed here.
2. **`ClientPipelineTab`** — keeps the existing click-to-move PhaseSheet. No drag & drop.

**Implementation:** Add `draggable?: boolean` prop to `PipelineCard` (default `false`).

```tsx
// Main pipeline — draggable
<PipelineCard item={item} draggable logs={...} currentUserId={...} showClient />

// ClientPipelineTab — keeps PhaseSheet
<PipelineCard item={item} logs={...} currentUserId={...} showClient={false} />
```

When `draggable === true`: attach `useDraggable`, hide PhaseSheet, show grab cursor.  
When `draggable === false` (default): existing PhaseSheet behaviour unchanged.

### Drag ID convention

- Draggable id = `consumption.id` (UUID)
- Droppable id = `phase` string (e.g. `"revision_interna"`)

### KanbanBoard drag state

```ts
interface ActiveDrag {
  item: PipelineItem
}
// Plus pending modal state:
interface PendingMove {
  item: PipelineItem
  fromPhase: Phase   // = item.phase at drag start
  toPhase: Phase
}
```

`onDragEnd({ active, over })`:
- `over === null` or `over.id === item.phase` → do nothing
- else → set `pendingMove = { item, fromPhase: item.phase, toPhase: over.id as Phase }` → opens `MovePhaseModal`

### MovePhaseModal props and call

```ts
interface MovePhaseModalProps {
  open: boolean
  item: PipelineItem
  fromPhase: Phase
  toPhase: Phase
  currentUserId: string
  onClose: () => void        // Cancelar or after success
}
```

On Confirmar:
```ts
await movePhase(supabase, {
  consumptionId: item.id,
  currentPhase: fromPhase,   // ← from PendingMove.fromPhase, not re-derived
  contentType: item.content_type,
  toPhase,
  movedBy: currentUserId,
  notes: notes.trim() || undefined,
})
```

On success → `onClose()` → `router.refresh()`  
On error → display error inside modal, keep modal open.

### Visual states

| State | Visual |
|---|---|
| Dragging | Original card 30% opacity; floating overlay full opacity |
| Column hovered | Dashed green border + light green tint |
| Modal confirming | Spinner on button, textarea + cancel disabled |
| Move error | Red error text inside modal |

### Scope boundaries

- **No reordering within the same column** — between-column only
- **No touch/mobile** — desktop only
- **`ClientPipelineTab` keeps the existing click-to-move flow** — `PhaseSheet` is preserved there
- `movePhase()` in `pipeline.ts` is unchanged — only UI layer changes

---

## Files Affected

### Weekly targets
| File | Change |
|---|---|
| `supabase/migrations/0006_client_weekly_targets.sql` | New — ADD COLUMN |
| `src/types/db.ts` | Add `weekly_targets_json` to Client |
| `src/lib/domain/consumption.ts` | New `weeklyTarget()` and `effectiveWeeklyTarget()` helpers |
| `src/components/clients/ConsumptionPanel.tsx` | Weekly cards → progress bar rows (imports helpers) |
| `src/app/(app)/clients/[id]/edit/page.tsx` | New "Objetivos semanales" section |

### Pipeline drag & drop
| File | Change |
|---|---|
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/utilities` |
| `src/app/(app)/pipeline/page.tsx` | Replace `KanbanColumn` usage with `KanbanBoard` |
| `src/components/pipeline/KanbanBoard.tsx` | New — `DndContext` wrapper, drag state, `DragOverlay` |
| `src/components/pipeline/KanbanColumn.tsx` | Add `useDroppable` |
| `src/components/pipeline/PipelineCard.tsx` | Add `draggable` prop; gate `useDraggable` and PhaseSheet on it |
| `src/components/pipeline/MovePhaseModal.tsx` | New — drop confirmation modal |

---

## Out of Scope

- Rollover/accumulation of unused weekly targets to the next week
- Weekly target notifications or alerts  
- Touch drag support
- Drag & drop in `ClientPipelineTab` — only main `/pipeline` page
