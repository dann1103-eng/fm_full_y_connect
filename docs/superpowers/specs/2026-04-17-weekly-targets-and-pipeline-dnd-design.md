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
A partial record of `ContentType → number` (same keys as `limits_json` but optional per type). `null` means "use default for all types."

```ts
// Example stored value (only types the user customised)
{ "historia": 3, "reel": 1 }
```

**Default computation (no DB change needed):**
```ts
weeklyTarget(type) = client.weekly_targets_json?.[type] ?? Math.ceil(monthlyLimit[type] / 4)
```

**Type update (`src/types/db.ts`):**
- Add `weekly_targets_json: Partial<Record<ContentType, number>> | null` to `Client` Row, Insert, Update.

### Display — ConsumptionPanel weekly breakdown

Each of the four week cards (`S1–S4`) replaces the plain count list with a progress bar row per active content type:

```
📖 Historias    [████░░] 3 / 4
📷 Estáticos    [██████] 2 / 2
🎬 Video largo  [░░░░░░] 0 / 1
```

Bar colour:
- **Green (#00675c)** — consumed ≥ weekly target
- **Amber (#f59e0b)** — consumed < weekly target (only shown for past/current weeks; future weeks are always grey)
- **Grey (#e5e9eb)** — empty bar (future week or zero consumed)

Past weeks that ended below target remain amber as a historical record.

### Edit UI — `/clients/[id]/edit`

New collapsible section **"Objetivos semanales"** added below the social fields section.

- One numeric `<Input>` per active content type of the client's current plan
- Placeholder shows the computed default (`Math.ceil(limit / 4)`)
- Leaving a field blank = use the default (stored as `null` / omitted key in JSON)
- On submit, only fields with values different from the default are written; the rest are omitted from `weekly_targets_json`
- If all fields match the default, `weekly_targets_json` is saved as `null`

### Scope boundaries

- Targets are **informational only** — no hard blocks, no warnings that prevent consumption registration
- Targets apply to the **same content types** shown in the consumption panel (all types with `limit > 0`)
- Reuniones and producciones follow the same logic (weekly target = monthly limit ÷ 4, rounded up)

---

## Feature 2: Pipeline Drag & Drop

### Goal

Let operators move pipeline cards between phases by dragging, instead of the current click → dropdown → save flow. A modal appears on drop for optional notes before confirming.

### Library

**`@dnd-kit/core`** + **`@dnd-kit/utilities`**  
Modern, lightweight, accessible, no legacy dependencies.

```bash
npm install @dnd-kit/core @dnd-kit/utilities
```

### Architecture

| Component | Change | Responsibility |
|---|---|---|
| `KanbanColumn` | Add `useDroppable` | Becomes a drop target; highlights when a card hovers over it |
| `PipelineCard` | Add `useDraggable` | Becomes draggable; shows grab cursor |
| `KanbanBoard` (new) | Wraps everything in `DndContext` | Owns `onDragStart`, `onDragOver`, `onDragEnd` handlers and drag state |
| `DragOverlay` (new) | Floating copy of dragged card | Rendered at root of `DndContext`, follows cursor |
| `MovePhaseModal` (new) | Modal on drop | Shows from→to phase, optional notes textarea, Cancelar/Confirmar |

### Drag ID convention

Each draggable card uses `id = consumption.id` (UUID). Each droppable column uses `id = phase` string (e.g., `"revision_interna"`).

### Interaction flow

```
User grabs card
  → DragOverlay appears (floating card clone)
  → Target column highlights (dashed green border)

User drops on SAME column → nothing happens

User drops on DIFFERENT column
  → MovePhaseModal opens:
      [Cliente] · [Tipo]
      En Producción  →  Revisión Interna
      [ Nota opcional... textarea ]
      [ Cancelar ]  [ Confirmar ]

  → Cancelar: modal closes, no state change
  → Confirmar (loading state):
      calls movePhase(consumptionId, currentPhase, toPhase, movedBy, notes)
      on success: modal closes, router.refresh()
      on error: shows error message inside modal
```

### KanbanBoard — state

```ts
interface DragState {
  activeItem: PipelineItem | null   // the card being dragged
}
```

`onDragEnd` receives `{ active, over }`:
- If `over === null` or `over.id === activeItem.phase` → do nothing
- Else → open `MovePhaseModal` with `{ item: activeItem, toPhase: over.id as Phase }`

### Visual states

| State | Visual |
|---|---|
| Card being dragged | Original card dims to 30% opacity; floating overlay renders at full opacity |
| Column being hovered | Dashed green border (`border-[#00675c] border-dashed`) + very light green tint |
| Modal loading (confirming) | Button shows spinner, textarea and cancel disabled |
| Move error | Red error message inside modal, stays open |

### Scope boundaries

- **No reordering within the same column** — drag between columns only
- **No touch/mobile optimisation** — desktop-only for now
- The existing click-to-move flow (current `PipelineCard` phase selector) is **removed** and replaced entirely by drag & drop + modal
- `movePhase()` domain function in `pipeline.ts` is unchanged — only the UI layer changes

---

## Files Affected

### Weekly targets
| File | Change |
|---|---|
| `supabase/migrations/0006_client_weekly_targets.sql` | New — ADD COLUMN |
| `src/types/db.ts` | Add `weekly_targets_json` to Client |
| `src/components/clients/ConsumptionPanel.tsx` | Weekly cards → progress bar rows |
| `src/app/(app)/clients/[id]/edit/page.tsx` | New "Objetivos semanales" section |

### Pipeline drag & drop
| File | Change |
|---|---|
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/utilities` |
| `src/app/(app)/pipeline/page.tsx` | Pass items to new KanbanBoard instead of KanbanColumn directly |
| `src/components/pipeline/KanbanBoard.tsx` | New — DndContext wrapper + drag state |
| `src/components/pipeline/KanbanColumn.tsx` | Add `useDroppable` |
| `src/components/pipeline/PipelineCard.tsx` | Add `useDraggable`, remove existing phase-change UI |
| `src/components/pipeline/MovePhaseModal.tsx` | New — drop confirmation modal |

---

## Out of Scope

- Rollover/accumulation of unused weekly targets to the next week
- Weekly target notifications or alerts
- Touch drag support
- Drag & drop in the per-client pipeline tab (`ClientPipelineTab`) — only the main `/pipeline` page for now
