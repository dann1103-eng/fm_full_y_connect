# Delete Client · Cambios Counter · Consumption Title · Pipeline Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cascade client deletion, a per-consumption title (required), a change-request counter, and inline editing of consumption details from the pipeline sheet.

**Architecture:** One DB migration adds 3 columns. Features are implemented in dependency order: schema → types → Server Action → UI layer bottom-up (modal → history → pipeline cards → PhaseSheet → KanbanBoard). No new pages; all changes are in existing components/pages.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres + client-side SDK) · Tailwind · shadcn/ui · @dnd-kit (existing)

**Spec:** `docs/superpowers/specs/2026-04-18-delete-client-cambios-title-pipeline.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/0008_consumption_title_cambios.sql` | **Create** | DB columns: title, cambios_count, max_cambios |
| `src/types/db.ts` | **Modify** | TS types for new columns |
| `src/lib/domain/pipeline.ts` | **Modify** | PipelineItem interface + migrateOpenPipelineItems |
| `src/app/actions/deleteClient.ts` | **Create** | Server Action: cascade delete |
| `src/app/(app)/clients/[id]/page.tsx` | **Modify** | Delete button/dialog; pass max_cambios to ConsumptionHistory; add title+cambios_count to pipeline select |
| `src/app/(app)/clients/[id]/edit/page.tsx` | **Modify** | max_cambios input field |
| `src/components/clients/ConsumptionModal.tsx` | **Modify** | Required title field |
| `src/components/clients/ConsumptionHistory.tsx` | **Modify** | Title as primary text; cambios badge + +1 button |
| `src/components/pipeline/PipelineCard.tsx` | **Modify** | Show title; onDoubleClick on CardBody |
| `src/components/pipeline/PhaseSheet.tsx` | **Modify** | Editable title/notes/cambios; showMoveSection prop |
| `src/components/pipeline/KanbanColumn.tsx` | **Modify** | Thread onDoubleClick prop |
| `src/components/pipeline/KanbanBoard.tsx` | **Modify** | activeDetailItem state; render PhaseSheet on double click |
| `src/components/pipeline/ClientPipelineTab.tsx` | **Modify** | Add title/cambios_count to pipeline SELECT; item.max_cambios used directly |
| `src/app/(app)/pipeline/page.tsx` | **Modify** | Add title, cambios_count, max_cambios to SELECT queries |

---

## Task 1: DB Migration + TypeScript Types

**Files:**
- Create: `supabase/migrations/0008_consumption_title_cambios.sql`
- Modify: `src/types/db.ts`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/0008_consumption_title_cambios.sql

-- Título de consumo (registros existentes quedan con '' — UI requiere uno no vacío)
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- Contador de cambios solicitados por el cliente
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS cambios_count INTEGER NOT NULL DEFAULT 0;

-- Límite de cambios por defecto por cliente
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS max_cambios INTEGER NOT NULL DEFAULT 2;
```

- [ ] **Step 2: Apply migration in Supabase Dashboard**

Go to Supabase Dashboard → SQL Editor → paste and run the migration above.
Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'consumptions'` should list `title` and `cambios_count`.

- [ ] **Step 3: Update `src/types/db.ts`**

In `consumptions.Row` (after `carried_over: boolean`), add:
```ts
title: string
cambios_count: number
```

In `consumptions.Insert` (after `carried_over?: boolean`), add:
```ts
title?: string
cambios_count?: number
```

In `consumptions.Update` (after `carried_over?: boolean`), add:
```ts
title?: string
cambios_count?: number
```

In `clients.Row` (after `weekly_targets_json`), add:
```ts
max_cambios: number
```

In `clients.Update` (after `weekly_targets_json?`), add:
```ts
max_cambios?: number
```

- [ ] **Step 4: Run build to confirm no TS errors**

```bash
cd fm-crm && npm run build
```
Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_consumption_title_cambios.sql src/types/db.ts
git commit -m "feat: migration y tipos para title, cambios_count y max_cambios"
```

---

## Task 2: Server Action — deleteClient

**Files:**
- Create: `src/app/actions/deleteClient.ts`

- [ ] **Step 1: Create the `actions` directory and Server Action**

```bash
mkdir -p src/app/actions
```

```ts
// src/app/actions/deleteClient.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function deleteClient(clientId: string): Promise<void> {
  const supabase = await createClient()

  // Auth + admin check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') throw new Error('Solo admins pueden eliminar clientes')

  // 1. Get cycle IDs
  const { data: cycles } = await supabase
    .from('billing_cycles').select('id').eq('client_id', clientId)
  const cycleIds = (cycles ?? []).map((c) => c.id)

  // 2. Get consumption IDs
  let consumptionIds: string[] = []
  if (cycleIds.length > 0) {
    const { data: consumptions } = await supabase
      .from('consumptions').select('id').in('billing_cycle_id', cycleIds)
    consumptionIds = (consumptions ?? []).map((c) => c.id)
  }

  // 3. Delete phase logs
  if (consumptionIds.length > 0) {
    await supabase.from('consumption_phase_logs')
      .delete().in('consumption_id', consumptionIds)
  }

  // 4. Delete consumptions
  if (cycleIds.length > 0) {
    await supabase.from('consumptions')
      .delete().in('billing_cycle_id', cycleIds)
  }

  // 5. Delete billing cycles
  if (cycleIds.length > 0) {
    await supabase.from('billing_cycles')
      .delete().eq('client_id', clientId)
  }

  // 6. Delete client
  await supabase.from('clients').delete().eq('id', clientId)

  redirect('/clients')
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/deleteClient.ts
git commit -m "feat: server action deleteClient con borrado en cascada"
```

---

## Task 3: Delete Button in Client Detail Page

**Files:**
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Add import and delete button UI**

At the top of the file, add the import:
```ts
import { deleteClient } from '@/app/actions/deleteClient'
```

Find the client detail page's header section (where the client name is shown, admin-only actions area). Add a delete button with a confirmation dialog at the **bottom** of the page content, visible only to admins.

Add this state and handler inside the component (it's a server component, so add a `DeleteClientButton` as a small `'use client'` component inline or in a new file):

Create `src/components/clients/DeleteClientButton.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { deleteClient } from '@/app/actions/deleteClient'

export function DeleteClientButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    await deleteClient(clientId)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-[#b31b25] hover:underline"
      >
        Eliminar cliente
      </button>
    )
  }

  return (
    <div className="glass-panel rounded-2xl p-5 border border-[#b31b25]/30 space-y-3">
      <p className="text-sm font-semibold text-[#b31b25]">¿Eliminar a {clientName}?</p>
      <p className="text-xs text-[#595c5e]">
        Esta acción es irreversible. Se eliminarán todos sus ciclos, consumos y logs asociados.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="flex-1 py-2 text-sm border border-[#dfe3e6] rounded-xl text-[#595c5e] hover:bg-[#f5f7f9] transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2 text-sm bg-[#b31b25] text-white rounded-xl font-semibold hover:bg-[#a01820] transition-colors disabled:opacity-50"
        >
          {loading ? 'Eliminando...' : 'Sí, eliminar'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Use `DeleteClientButton` in the page**

In `src/app/(app)/clients/[id]/page.tsx`, at the bottom of the page content (after all sections, before closing `</div>`), add inside the `{isAdmin && (...)}` guard:
```tsx
{isAdmin && (
  <div className="pt-4">
    <DeleteClientButton clientId={client.id} clientName={client.name} />
  </div>
)}
```

Import `DeleteClientButton` at the top.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/DeleteClientButton.tsx src/app/\(app\)/clients/\[id\]/page.tsx
git commit -m "feat: botón eliminar cliente con confirmación (admin only)"
```

---

## Task 4: Required Title Field in ConsumptionModal

**Files:**
- Modify: `src/components/clients/ConsumptionModal.tsx`

- [ ] **Step 1: Add title state and input**

In `ConsumptionModal.tsx`, add `title` to state (line ~78):
```ts
const [title, setTitle] = useState('')
```

After the type selector grid and before Notes, add (inside `{selectedType && (...)}` block, before the `<Textarea>` for notes):
```tsx
<div>
  <Label htmlFor="title" className="text-sm font-medium text-[#2c2f31] mb-1.5 block">
    Título <span className="text-[#b31b25]">*</span>
  </Label>
  <input
    id="title"
    type="text"
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder="Ej. Reel de lanzamiento mayo"
    required
    className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c] text-[#2c2f31]"
  />
</div>
```

- [ ] **Step 2: Include title in insert payload**

In the `supabase.from('consumptions').insert({...})` call (~line 115), add:
```ts
title: title.trim(),
```

- [ ] **Step 3: Disable Confirm button when title is empty**

In the Confirm `<Button>` `disabled` prop, add `|| !title.trim()`:
```tsx
disabled={
  !selectedType ||
  loading ||
  !title.trim() ||
  (selectedAtLimit && !forceOverLimit)
}
```

- [ ] **Step 4: Reset title on close**

In the cleanup after successful insert (~line 141):
```ts
setTitle('')
```

- [ ] **Step 5: Verify build + lint**

```bash
npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/clients/ConsumptionModal.tsx
git commit -m "feat: campo título requerido en modal de registro de consumo"
```

---

## Task 5: Title Display + Cambios Counter in ConsumptionHistory

**Files:**
- Modify: `src/components/clients/ConsumptionHistory.tsx`

- [ ] **Step 1: Add `maxCambios` prop to the interface**

```ts
interface ConsumptionHistoryProps {
  consumptions: Consumption[]
  isAdmin: boolean
  cycleId: string
  userMap: Record<string, string>
  maxCambios: number  // ← new
}

export function ConsumptionHistory({
  consumptions,
  isAdmin,
  userMap,
  maxCambios,  // ← new
}: ConsumptionHistoryProps) {
```

- [ ] **Step 2: Add cambios handler**

After `const [voidingId, setVoidingId] = useState<string | null>(null)`, add:
```ts
const [incrementingId, setIncrementingId] = useState<string | null>(null)

async function handleAddCambio(consumptionId: string) {
  setIncrementingId(consumptionId)
  const supabase = createClient()
  await supabase
    .from('consumptions')
    .update({ cambios_count: (consumptions.find(c => c.id === consumptionId)?.cambios_count ?? 0) + 1 })
    .eq('id', consumptionId)
  setIncrementingId(null)
  router.refresh()
}
```

- [ ] **Step 3: Update the item render — title as primary text**

Replace the current text block (lines ~108-130):
```tsx
<div>
  <p className="text-sm font-bold text-[#2c2f31]">
    {c.title || TYPE_ACTION[type] || CONTENT_TYPE_LABELS[type]}
    {c.voided && (
      <span className="ml-2 text-xs font-medium text-[#747779] bg-[#abadaf]/20 px-1.5 py-0.5 rounded">
        Anulado
      </span>
    )}
    {c.over_limit && !c.voided && (
      <span className="ml-2 text-xs font-medium text-[#b31b25] bg-[#b31b25]/10 px-1.5 py-0.5 rounded">
        Excedente
      </span>
    )}
    {/* Cambios badge */}
    {!c.voided && (() => {
      const isOver = c.cambios_count >= maxCambios
      return (
        <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${
          isOver
            ? 'text-[#b31b25] bg-[#b31b25]/10'
            : 'text-[#595c5e] bg-[#abadaf]/20'
        }`}>
          {c.cambios_count}/{maxCambios} cambios
        </span>
      )
    })()}
  </p>
  <p className="text-xs text-[#595c5e] mt-0.5">
    <span className="text-[#abadaf]">{CONTENT_TYPE_LABELS[type]}</span>
    {c.notes && <span> — {c.notes}</span>}
  </p>
  <p className="text-xs text-[#595c5e] mt-0.5">
    {daysAgo(c.registered_at)}&nbsp;·&nbsp;por{' '}
    <span className="font-semibold text-[#2c2f31]">{userName}</span>
  </p>
</div>
```

- [ ] **Step 4: Add +1 cambios button alongside the Void button**

Replace the right-side action area:
```tsx
<div className="flex items-center gap-3 flex-shrink-0 ml-4">
  {/* +1 cambio */}
  {!c.voided && (
    <button
      onClick={() => handleAddCambio(c.id)}
      disabled={incrementingId === c.id}
      className={`text-xs font-bold transition-colors disabled:opacity-30 ${
        c.cambios_count >= maxCambios
          ? 'text-[#b31b25] hover:underline'
          : 'text-[#00675c] hover:underline'
      }`}
    >
      {incrementingId === c.id ? '...' : '+1 cambio'}
    </button>
  )}
  {/* Void button */}
  {!c.voided && (
    <button
      onClick={() => handleVoid(c.id)}
      disabled={voidingId === c.id || !isAdmin}
      className="text-[#b31b25] text-xs font-bold hover:underline transition-colors disabled:opacity-30"
    >
      {voidingId === c.id ? '...' : 'Anular'}
    </button>
  )}
</div>
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/clients/ConsumptionHistory.tsx
git commit -m "feat: título como texto principal y contador de cambios en historial"
```

---

## Task 6: max_cambios in Client Edit + Wire to Client Detail

**Files:**
- Modify: `src/app/(app)/clients/[id]/edit/page.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Add max_cambios to edit page form state**

In `edit/page.tsx`, add to the `form` state:
```ts
max_cambios: '2',
```

In the load effect where `setForm({...})` is called, add:
```ts
max_cambios: clientData.max_cambios?.toString() ?? '2',
```

In the `handleSubmit` update payload, add:
```ts
max_cambios: parseInt(form.max_cambios, 10) || 2,
```

- [ ] **Step 2: Add max_cambios input to edit form UI**

Add a new field section near the billing_day field (both are numeric settings):
```tsx
<div className="space-y-1.5">
  <Label>Máx. cambios por consumo</Label>
  <Input
    type="number"
    min={0}
    value={form.max_cambios}
    onChange={(e) => set('max_cambios', e.target.value)}
    className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
  />
  <p className="text-xs text-[#747779]">Default: 2. Aplica a todos los consumos del cliente.</p>
</div>
```

- [ ] **Step 3: Pass max_cambios to ConsumptionHistory in client detail page**

In `src/app/(app)/clients/[id]/page.tsx`, find the `<ConsumptionHistory>` render and add the `maxCambios` prop:
```tsx
<ConsumptionHistory
  consumptions={...}
  isAdmin={isAdmin}
  cycleId={...}
  userMap={userMap}
  maxCambios={client.max_cambios ?? 2}
/>
```

(After the migration `client.max_cambios` will be a number; the `?? 2` fallback handles any legacy rows before the migration.)

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/edit/page.tsx src/app/\(app\)/clients/\[id\]/page.tsx
git commit -m "feat: campo max_cambios en edición de cliente y wired en detalle"
```

---

## Task 7: Title + Cambios in PipelineItem and Pipeline Queries

**Files:**
- Modify: `src/lib/domain/pipeline.ts`
- Modify: `src/app/(app)/pipeline/page.tsx`
- Modify: `src/components/pipeline/PipelineCard.tsx`

- [ ] **Step 1: Add title and cambios_count to PipelineItem interface**

In `src/lib/domain/pipeline.ts`, in the `PipelineItem` interface, add:
```ts
title: string
cambios_count: number
max_cambios: number   // client's limit, fetched from clients table
```

- [ ] **Step 2: Fix migrateOpenPipelineItems to copy title**

In `migrateOpenPipelineItems`, change the select at line ~133:
```ts
.select('id, content_type, phase, title')  // add title
```

And in the insert payload (~line 143-155), add:
```ts
title: item.title ?? '',
```

- [ ] **Step 3: Update pipeline/page.tsx queries**

In the consumptions SELECT (line 40), add `title, cambios_count`:
```ts
.select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count')
```

In the clients SELECT (line 53-54), add `max_cambios`:
```ts
.select('id, name, logo_url, max_cambios')
```

In `clientMap` type (line 57), update:
```ts
const clientMap: Record<string, Pick<Client, 'id' | 'name' | 'logo_url' | 'max_cambios'>> = {}
```

In the `items.push({...})` block (line 66-79), add:
```ts
title: c.title ?? '',
cambios_count: c.cambios_count ?? 0,
max_cambios: cl.max_cambios ?? 2,
```

- [ ] **Step 4: Show title in PipelineCard (CardBody)**

In `src/components/pipeline/PipelineCard.tsx`, in `CardBody`'s children, replace the `item.notes` paragraph with:

```tsx
{/* Title — primary text */}
{item.title ? (
  <p className="text-sm font-semibold text-[#2c2f31] mb-1 line-clamp-2">{item.title}</p>
) : null}

{/* Notes — secondary */}
{item.notes && (
  <p className="text-xs text-[#595c5e] line-clamp-2 mb-2">{item.notes}</p>
)}
```

- [ ] **Step 5: Add onDoubleClick to CardBody**

In `CardBody` props interface, add:
```ts
onDoubleClick?: () => void
```

In the `button` branch (when `onClick` is defined), add:
```tsx
onDoubleClick={onDoubleClick}
```

In the `div` branch (drag handle), add:
```tsx
onDoubleClick={onDoubleClick}
```

- [ ] **Step 6: Thread onDoubleClick through PipelineCard**

In `PipelineCardProps`, add:
```ts
onDoubleClick?: () => void
```

In the `draggable` branch, pass it:
```tsx
<CardBody
  item={item}
  showClient={showClient}
  dragHandleProps={{ ...attributes, ...listeners }}
  isDragging={isDragging}
  onDoubleClick={onDoubleClick}
/>
```

(Non-draggable branch already has `onClick` for single click — leave that unchanged.)

- [ ] **Step 7: Verify build**

```bash
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/domain/pipeline.ts src/app/\(app\)/pipeline/page.tsx src/components/pipeline/PipelineCard.tsx
git commit -m "feat: título y cambios_count en PipelineItem, queries y tarjetas"
```

---

## Task 8: Expand PhaseSheet with Editable Fields

**Files:**
- Modify: `src/components/pipeline/PhaseSheet.tsx`

- [ ] **Step 1: Add new props to PhaseSheetProps interface**

```ts
interface PhaseSheetProps {
  open: boolean
  onClose: () => void
  consumptionId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  logs: ConsumptionPhaseLog[]
  currentUserId: string
  // New props:
  title: string
  consumptionNotes: string | null
  cambiosCount: number
  maxCambios: number
  showMoveSection?: boolean   // default true
}
```

- [ ] **Step 2: Add state for editable fields**

After existing state declarations, add:
```ts
const [editTitle, setEditTitle] = useState(title)
const [editNotes, setEditNotes] = useState(consumptionNotes ?? '')
const [savingEdit, setSavingEdit] = useState(false)
const [editError, setEditError] = useState<string | null>(null)
const [incrementing, setIncrementing] = useState(false)
const [localCambios, setLocalCambios] = useState(cambiosCount)
```

- [ ] **Step 3: Add save handler for title/notes**

```ts
async function handleSaveEdit() {
  if (!editTitle.trim()) {
    setEditError('El título no puede estar vacío.')
    return
  }
  setEditError(null)
  setSavingEdit(true)
  const supabase = createClient()
  const { error } = await supabase
    .from('consumptions')
    .update({ title: editTitle.trim(), notes: editNotes.trim() || null })
    .eq('id', consumptionId)
  setSavingEdit(false)
  if (error) { setEditError('Error al guardar.'); return }
  onClose()
  router.refresh()
}
```

- [ ] **Step 4: Add +1 cambios handler**

```ts
async function handleAddCambio() {
  setIncrementing(true)
  const supabase = createClient()
  await supabase
    .from('consumptions')
    .update({ cambios_count: localCambios + 1 })
    .eq('id', consumptionId)
  setLocalCambios((n) => n + 1)
  setIncrementing(false)
  router.refresh()
}
```

- [ ] **Step 5: Add "Información del consumo" section at top of scrollable body**

At the start of the scrollable body div (before the "Fase actual" row), add:

```tsx
{/* ── Información del consumo ── */}
<div className="space-y-3 pb-5 border-b border-[#dfe3e6]">
  <p className="text-xs font-semibold text-[#747779] uppercase tracking-wider">
    Información del consumo
  </p>

  <div className="space-y-1.5">
    <Label className="text-sm font-medium text-[#2c2f31]">Título</Label>
    <input
      type="text"
      value={editTitle}
      onChange={(e) => setEditTitle(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c]"
    />
  </div>

  <div className="space-y-1.5">
    <Label className="text-sm font-medium text-[#2c2f31]">
      Notas <span className="text-[#abadaf] font-normal">(opcional)</span>
    </Label>
    <Textarea
      value={editNotes}
      onChange={(e) => setEditNotes(e.target.value)}
      placeholder="Descripción, instrucciones del cliente..."
      className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl text-sm"
      rows={2}
    />
  </div>

  {/* Cambios */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <span className="text-sm text-[#595c5e]">Cambios solicitados:</span>
      <span className={`text-sm font-bold ${localCambios >= maxCambios ? 'text-[#b31b25]' : 'text-[#2c2f31]'}`}>
        {localCambios}/{maxCambios}
      </span>
    </div>
    <button
      onClick={handleAddCambio}
      disabled={incrementing}
      className={`text-xs font-bold px-3 py-1 rounded-lg transition-colors disabled:opacity-40 ${
        localCambios >= maxCambios
          ? 'bg-[#b31b25]/10 text-[#b31b25] hover:bg-[#b31b25]/20'
          : 'bg-[#00675c]/10 text-[#00675c] hover:bg-[#00675c]/20'
      }`}
    >
      {incrementing ? '...' : '+1 cambio'}
    </button>
  </div>

  {editError && (
    <p className="text-xs text-[#b31b25] bg-[#b31b25]/5 rounded-lg px-3 py-2 border border-[#b31b25]/20">
      {editError}
    </p>
  )}

  <button
    onClick={handleSaveEdit}
    disabled={savingEdit || !editTitle.trim()}
    className="w-full py-2 text-sm font-semibold rounded-xl text-white transition-colors disabled:opacity-50"
    style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
  >
    {savingEdit ? 'Guardando...' : 'Guardar cambios'}
  </button>
</div>
```

- [ ] **Step 6: Wrap "Mover a fase" section with showMoveSection guard**

Wrap the entire "Formulario mover de fase" `<div>` (from line ~158 to ~200) with:
```tsx
{(showMoveSection ?? true) && (
  <div className="space-y-4 border-t border-[#dfe3e6] pt-5">
    {/* ... existing move section content ... */}
  </div>
)}
```

Also wrap the footer `<div>` with the Mover button conditionally:
```tsx
{(showMoveSection ?? true) && (
  <div className="px-6 py-4 border-t border-[#dfe3e6] bg-white flex gap-3">
    <Button variant="outline" onClick={onClose} ...>Cancelar</Button>
    <Button onClick={handleMove} ...>Mover</Button>
  </div>
)}
{!(showMoveSection ?? true) && (
  <div className="px-6 py-4 border-t border-[#dfe3e6] bg-white">
    <Button variant="outline" onClick={onClose} className="w-full rounded-xl h-10">
      Cerrar
    </Button>
  </div>
)}
```

- [ ] **Step 7: Update non-draggable PipelineCard to pass new PhaseSheet props**

In `PipelineCard.tsx`, the non-draggable branch renders `<PhaseSheet>`. Update it:
```tsx
<PhaseSheet
  open={sheetOpen}
  onClose={() => setSheetOpen(false)}
  consumptionId={item.id}
  contentType={item.content_type}
  currentPhase={item.phase as Phase}
  clientName={item.client_name}
  logs={logs}
  currentUserId={currentUserId}
  title={item.title}
  consumptionNotes={item.notes}
  cambiosCount={item.cambios_count}
  maxCambios={item.max_cambios}
  showMoveSection={true}
/>
```

- [ ] **Step 8: Verify build**

```bash
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/components/pipeline/PhaseSheet.tsx src/components/pipeline/PipelineCard.tsx
git commit -m "feat: PhaseSheet expandido con título, notas y cambios editables"
```

---

## Task 9: KanbanBoard — Double Click → PhaseSheet

**Files:**
- Modify: `src/components/pipeline/KanbanColumn.tsx`
- Modify: `src/components/pipeline/KanbanBoard.tsx`

- [ ] **Step 1: Read KanbanColumn to understand its current props**

```bash
cat fm-crm/src/components/pipeline/KanbanColumn.tsx
```

- [ ] **Step 2: Add onDoubleClick threading to KanbanColumn**

In `KanbanColumnProps`, add:
```ts
onDoubleClick?: (item: PipelineItem) => void
```

In the `<PipelineCard>` render inside KanbanColumn, pass:
```tsx
onDoubleClick={onDoubleClick ? () => onDoubleClick(item) : undefined}
```

- [ ] **Step 3: Add activeDetailItem state and on-demand log fetch to KanbanBoard**

In `KanbanBoard.tsx`:

Add imports:
```ts
import { PhaseSheet } from './PhaseSheet'
import { createClient } from '@/lib/supabase/client'
import type { ConsumptionPhaseLog } from '@/types/db'
```

Add state:
```ts
const [activeDetailItem, setActiveDetailItem] = useState<PipelineItem | null>(null)
const [detailLogs, setDetailLogs] = useState<ConsumptionPhaseLog[]>([])
const [loadingLogs, setLoadingLogs] = useState(false)
```

Add effect to fetch logs on demand when a card is double-clicked:
```ts
useEffect(() => {
  if (!activeDetailItem) { setDetailLogs([]); return }
  setLoadingLogs(true)
  const supabase = createClient()
  supabase
    .from('consumption_phase_logs')
    .select('*')
    .eq('consumption_id', activeDetailItem.id)
    .order('created_at')
    .then(({ data }) => {
      setDetailLogs(data ?? [])
      setLoadingLogs(false)
    })
}, [activeDetailItem])
```

Pass `onDoubleClick` to each `<KanbanColumn>`:
```tsx
<KanbanColumn
  ...existing props...
  onDoubleClick={(item) => setActiveDetailItem(item)}
/>
```

After the closing `</>` of the DndContext / MovePhaseModal block, add:
```tsx
{/* Detail sheet — opens on double click */}
{activeDetailItem && !loadingLogs && (
  <PhaseSheet
    open={true}
    onClose={() => setActiveDetailItem(null)}
    consumptionId={activeDetailItem.id}
    contentType={activeDetailItem.content_type}
    currentPhase={activeDetailItem.phase as Phase}
    clientName={activeDetailItem.client_name}
    logs={detailLogs}
    currentUserId={currentUserId}
    title={activeDetailItem.title}
    consumptionNotes={activeDetailItem.notes}
    cambiosCount={activeDetailItem.cambios_count}
    maxCambios={activeDetailItem.max_cambios}
    showMoveSection={false}
  />
)}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/KanbanColumn.tsx src/components/pipeline/KanbanBoard.tsx
git commit -m "feat: doble clic en pipeline abre PhaseSheet con detalle del consumo"
```

---

## Task 10: Wire ClientPipelineTab + Client Detail Pipeline Query

**Files:**
- Modify: `src/components/pipeline/ClientPipelineTab.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Verify ClientPipelineTab uses item.max_cambios directly**

After Task 7, `PipelineItem` already carries `max_cambios`. `ClientPipelineTab` does **not** need a `maxCambios` prop — each `item` already has the per-client value. The `<PipelineCard>` (non-draggable) reads it from `item.max_cambios` when it opens `PhaseSheet`.

No interface change needed. Just verify the existing `<PipelineCard>` render in `ClientPipelineTab` does **not** pass a separate `maxCambios` prop:
```tsx
<PipelineCard
  key={item.id}
  item={item}
  logs={logsMap[item.id] ?? []}
  currentUserId={currentUserId}
  showClient={false}
/>
```

If a stale `maxCambios` prop was added to `ClientPipelineTabProps` during earlier work, remove it now to avoid a lint warning.

- [ ] **Step 2: Update client detail pipeline SELECT**

In `src/app/(app)/clients/[id]/page.tsx`, find the query that fetches pipeline consumptions (likely a `supabase.from('consumptions').select(...)` filtered by `billing_cycle_id`). Add `title` and `cambios_count` to the select fields.

Also find where it builds `PipelineItem[]` (the `items.push({...})` loop) and add:
```ts
title: c.title ?? '',
cambios_count: c.cambios_count ?? 0,
max_cambios: client.max_cambios ?? 2,
```

- [ ] **Step 3: Verify ClientPipelineTab render in client detail page**

`<ClientPipelineTab>` does not need a `maxCambios` prop (it lives in each item). Confirm the render is:
```tsx
<ClientPipelineTab
  items={pipelineItems}
  logsMap={pipelineLogsMap}
  currentUserId={authUser.id}
/>
```

- [ ] **Step 4: Final lint + build**

```bash
npm run lint && npm run build
```
Expected: 0 errors, clean build.

- [ ] **Step 5: Final commit**

```bash
git add src/components/pipeline/ClientPipelineTab.tsx src/app/\(app\)/clients/\[id\]/page.tsx
git commit -m "feat: wired ClientPipelineTab y query de pipeline del cliente con title y cambios"
```

---

## Final Verification Checklist

- [ ] Registrar consumo → título es requerido, botón Confirmar deshabilitado si vacío
- [ ] Título aparece en negrita en el historial; tipo en gris debajo
- [ ] Título aparece en la tarjeta del pipeline (principal)
- [ ] +1 cambio en historial → badge se actualiza, rojo al superar límite
- [ ] Cambiar max_cambios en edición de cliente → siguiente visita muestra nuevo límite
- [ ] Botón Eliminar cliente visible solo para admins → dialog → confirmar → redirige a /clients
- [ ] Los datos del cliente eliminado ya no existen (verificar en Supabase Dashboard)
- [ ] Doble clic en tarjeta del pipeline global → PhaseSheet con título, notas, cambios e historial
- [ ] DnD sigue funcionando: arrastrar entre columnas → MovePhaseModal
- [ ] Clic simple en `ClientPipelineTab` → PhaseSheet con sección "Mover a fase" visible
- [ ] Editar título/notas en PhaseSheet → Guardar → datos actualizados
- [ ] `npm run lint` → 0 errores · `npm run build` → clean
