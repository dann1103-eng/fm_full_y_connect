# Shift & Timer Guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect timer integrity across Away/Lunch breaks, auto-logout, and missing shift — plus fix the localStorage desync bug that silently "loses" requirement timers.

**Architecture:** Four coordinated changes: (1) replace the silent auto-stop in `startBreak()` with a blocking client-side warning; (2) add a `clearAllTimerKeysForUser()` utility and call it wherever timers are force-stopped; (3) enforce an active `work_session` before allowing any timer start (both server and client); (4) propagate the shift gate to the two timer-start UIs (`ClockInPanel`, `QuickTimerDialog`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (server + client), localStorage.

---

## Context

### Key files (read before touching anything)

| File | Role |
|------|------|
| `src/app/actions/work-sessions.ts` | `startBreak()`, `endShift()`, `getMyActiveShift()` |
| `src/app/actions/time.ts` | `startRequirementTimer()`, `startAdminEntry()`, `stopActiveEntry()` |
| `src/lib/domain/timer.ts` | `startTimer()`, `stopTimer()`, `getActiveTimer()`, `TIMER_KEY` — localStorage helpers |
| `src/components/layout/ShiftStatusWidget.tsx` | TopNav shift widget — has Almuerzo/Away buttons |
| `src/components/tiempo/ShiftPanel.tsx` | /tiempo page shift panel — has same buttons |
| `src/components/layout/StillOnlineDialog.tsx` | Force logout after countdown — calls `stopActiveEntry()` |
| `src/components/tiempo/EndShiftConfirmDialog.tsx` | Existing model for a blocking warning dialog |
| `src/components/pipeline/QuickTimerDialog.tsx` | Requirement timer UI — uses `startTimer()` from `timer.ts` |
| `src/components/tiempo/ClockInPanel.tsx` | Internal (admin) timer UI — calls `startAdminEntry()` |

### Root cause of the "deleted timer" bug

`startBreak()` (server action) calls `stopActiveEntry()` **silently**. This closes the `time_entries` row in DB but never clears the matching `localStorage` key (`fm_crm_timer_${reqId}_${userId}`). When the user returns from break and opens `QuickTimerDialog`, it still reads the old localStorage key, shows an inflated elapsed time, and if they click "Detener", it re-writes the already-ended DB row with a wrong timestamp. The entry appears corrupted / "lost".

**Fix strategy:** Remove the auto-stop from `startBreak()` entirely. Instead, show a blocking warning when the user tries to go on break while a timer is active. For force-logout, keep the auto-stop but add localStorage cleanup.

---

## File Map

**New files:**
- `src/components/layout/ActiveTimerWarningDialog.tsx` — reusable blocking dialog: "Tienes un timer activo: [X]. Ciérralo antes de continuar."

**Modified files:**
- `src/app/actions/work-sessions.ts` — remove `stopActiveEntry()` call from `startBreak()`
- `src/app/actions/time.ts` — gate `startRequirementTimer()` + `startAdminEntry()` behind active shift
- `src/lib/domain/timer.ts` — add `clearAllTimerKeysForUser(userId)` + shift guard in `startTimer()`
- `src/components/layout/ShiftStatusWidget.tsx` — Almuerzo/Away: check active timer, show warning dialog; endShift: clear localStorage after stop
- `src/components/tiempo/ShiftPanel.tsx` — same as ShiftStatusWidget
- `src/components/layout/StillOnlineDialog.tsx` — clear localStorage keys after `stopActiveEntry()`
- `src/components/pipeline/QuickTimerDialog.tsx` — check active shift on open, disable start if no shift
- `src/components/tiempo/ClockInPanel.tsx` — check active shift on mount, disable start if no shift

---

## Task 1 — `ActiveTimerWarningDialog` component

**Files:**
- Create: `src/components/layout/ActiveTimerWarningDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
'use client'

interface ActiveTimerWarningDialogProps {
  open: boolean
  /** Nombre/título del timer activo, e.g. "Reel para Nike" */
  timerLabel: string | null
  /** Tipo de pausa que el usuario intentó marcar */
  breakType: 'lunch' | 'away' | null
  onDismiss: () => void
}

/**
 * Diálogo bloqueante que aparece cuando el usuario intenta marcar
 * Almuerzo/Away con un timer de requerimiento o administrativo activo.
 * No finaliza la jornada — solo avisa; el usuario debe cerrar el timer primero.
 */
export function ActiveTimerWarningDialog({
  open,
  timerLabel,
  breakType,
  onDismiss,
}: ActiveTimerWarningDialogProps) {
  if (!open) return null
  const breakLabel = breakType === 'lunch' ? 'almuerzo' : 'away'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-fm-surface-container-lowest rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 border border-fm-surface-container-high">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-xl">timer</span>
          </div>
          <p className="text-sm font-semibold text-fm-on-surface">Timer activo</p>
        </div>
        <p className="text-sm text-fm-on-surface-variant">
          Tienes un timer activo:{' '}
          <strong className="text-fm-on-surface">
            &ldquo;{timerLabel ?? 'requerimiento'}&rdquo;
          </strong>
          .{' '}
          Ciérralo antes de marcar {breakLabel === 'lunch' ? 'el almuerzo' : 'away'}.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="w-full px-4 py-2 rounded-full bg-fm-primary text-white text-sm font-bold hover:bg-fm-primary-dim transition-colors"
        >
          Entendido
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify no TS errors**

```bash
npx tsc --noEmit 2>&1 | grep ActiveTimerWarning
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/ActiveTimerWarningDialog.tsx
git commit -m "feat: agregar diálogo de advertencia de timer activo al marcar pausa"
```

---

## Task 2 — Remove auto-stop from `startBreak()`

The server action currently calls `stopActiveEntry()` silently when the user marks a break. This closes the DB row without clearing localStorage, causing the "lost timer" bug.

**Files:**
- Modify: `src/app/actions/work-sessions.ts` (lines 97-118)

- [ ] **Step 1: Remove the silent `stopActiveEntry()` call**

In `startBreak()`, delete these two lines:
```ts
// Apagar cualquier timer de requerimiento o administrativo activo
await stopActiveEntry().catch(() => undefined)
```

Also remove the `stopActiveEntry` import from `'./time'` if it becomes unused after this change.

After the change the function body starts directly with building the `breaks` array.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -15
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/work-sessions.ts
git commit -m "fix: eliminar auto-stop silencioso de startBreak para evitar pérdida de timers"
```

---

## Task 3 — `clearAllTimerKeysForUser` + shift guard in `timer.ts`

**Files:**
- Modify: `src/lib/domain/timer.ts`

- [ ] **Step 1: Add `clearAllTimerKeysForUser`**

Add at the bottom of the file:

```ts
/**
 * Limpia todas las claves de localStorage de timers que pertenecen al usuario dado.
 * Útil cuando `stopActiveEntry()` se llama desde fuera de QuickTimerDialog
 * (e.g. force-logout, finalizar jornada) para evitar desfases de estado.
 */
export function clearAllTimerKeysForUser(userId: string): void {
  if (typeof window === 'undefined') return
  const prefix = 'fm_crm_timer_'
  const suffix = `_${userId}`
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefix) && key.endsWith(suffix)) {
      toRemove.push(key)
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k))
}
```

- [ ] **Step 2: Add active-shift guard in `startTimer()`**

Inside `startTimer()`, before the DB insert, add:

```ts
  // Verificar que el usuario tenga una jornada activa antes de registrar tiempo
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', params.userId)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) {
    return { timer: null, error: 'Inicia tu jornada laboral antes de registrar tiempo en un requerimiento.' }
  }
```

- [ ] **Step 3: Verify TS**

```bash
npx tsc --noEmit 2>&1 | grep "timer.ts"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/domain/timer.ts
git commit -m "feat: clearAllTimerKeysForUser y guardia de jornada activa en startTimer"
```

---

## Task 4 — Shift guard in server actions (`time.ts`)

**Files:**
- Modify: `src/app/actions/time.ts`

- [ ] **Step 1: Add shift guard to `startRequirementTimer()`**

Right after `const active = await getActiveEntry(...)` check, add:

```ts
  // Verificar jornada activa
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }
```

Full context after the change — the check should appear BEFORE the insert:
```ts
export async function startRequirementTimer(requirementId: string, requirementTitle: string, phase: string) {
  const { supabase, user } = await getAuthUser()

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Detén el timer actual primero.' }

  // Verificar jornada activa
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }

  const { data, error } = await supabase.from('time_entries').insert({ ... })
  // ...rest unchanged
```

- [ ] **Step 2: Add shift guard to `startAdminEntry()`**

Same pattern, right after the `if (active) return { error: ... }` check:

```ts
  // Verificar jornada activa
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -15
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/time.ts
git commit -m "feat: bloquear inicio de timers si no hay jornada activa (server actions)"
```

---

## Task 5 — ShiftStatusWidget: break warning + localStorage cleanup

**Files:**
- Modify: `src/components/layout/ShiftStatusWidget.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports:
```ts
import { ActiveTimerWarningDialog } from '@/components/layout/ActiveTimerWarningDialog'
import { clearAllTimerKeysForUser } from '@/lib/domain/timer'
```

Add state after existing state declarations:
```ts
const [breakWarning, setBreakWarning] = useState<{
  open: boolean
  timerLabel: string | null
  breakType: 'lunch' | 'away' | null
}>({ open: false, timerLabel: null, breakType: null })
```

- [ ] **Step 2: Replace the Almuerzo/Away button handlers**

Remove the inline `handle(() => startBreak('lunch'))` and `handle(() => startBreak('away'))` onClick calls. Replace with a shared `handleStartBreak(type)` function:

```ts
async function handleStartBreak(type: 'lunch' | 'away') {
  setError(null)
  const supabase = createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) { setError('No autenticado'); return }

  const { data: activeEntry } = await supabase
    .from('time_entries')
    .select('id, title, entry_type')
    .eq('user_id', authUser.id)
    .is('ended_at', null)
    .maybeSingle()

  if (activeEntry) {
    const label = activeEntry.title ||
      (activeEntry.entry_type === 'requirement' ? 'requerimiento' : 'tarea administrativa')
    setBreakWarning({ open: true, timerLabel: label, breakType: type })
    return
  }
  handle(() => startBreak(type))
}
```

Update the two break buttons:
```tsx
onClick={() => handleStartBreak('lunch')}
onClick={() => handleStartBreak('away')}
```

- [ ] **Step 3: Add localStorage cleanup to `confirmEndShift()`**

In the existing `confirmEndShift()` function, after `stopActiveEntry()` succeeds, add:

```ts
  // Limpiar localStorage para evitar desfase de estado
  const supabase = createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (authUser) clearAllTimerKeysForUser(authUser.id)
```

- [ ] **Step 4: Mount `ActiveTimerWarningDialog` in the JSX**

Inside the return, alongside the existing `<EndShiftConfirmDialog .../>`:

```tsx
<ActiveTimerWarningDialog
  open={breakWarning.open}
  timerLabel={breakWarning.timerLabel}
  breakType={breakWarning.breakType}
  onDismiss={() => setBreakWarning({ open: false, timerLabel: null, breakType: null })}
/>
```

- [ ] **Step 5: Verify build + lint**

```bash
npm run lint 2>&1 | grep -i "ShiftStatusWidget\|error"
npm run build 2>&1 | tail -15
```

Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/ShiftStatusWidget.tsx
git commit -m "feat: advertencia de timer activo al marcar pausa en ShiftStatusWidget"
```

---

## Task 6 — ShiftPanel: same break warning + localStorage cleanup

**Files:**
- Modify: `src/components/tiempo/ShiftPanel.tsx`

Apply the identical changes from Task 5 to `ShiftPanel.tsx`. The component is a sibling of `ShiftStatusWidget` with the same Almuerzo/Away buttons and the same `confirmEndShift()` flow.

- [ ] **Step 1: Add imports**

```ts
import { ActiveTimerWarningDialog } from '@/components/layout/ActiveTimerWarningDialog'
import { clearAllTimerKeysForUser } from '@/lib/domain/timer'
```

- [ ] **Step 2: Add `breakWarning` state (same shape as in ShiftStatusWidget)**

```ts
const [breakWarning, setBreakWarning] = useState<{
  open: boolean
  timerLabel: string | null
  breakType: 'lunch' | 'away' | null
}>({ open: false, timerLabel: null, breakType: null })
```

- [ ] **Step 3: Add `handleStartBreak()` (identical to ShiftStatusWidget)**

Copy the function verbatim from Task 5 Step 2.

- [ ] **Step 4: Update break button onClick handlers**

```tsx
onClick={() => handleStartBreak('lunch')}
onClick={() => handleStartBreak('away')}
```

- [ ] **Step 5: Add localStorage cleanup to `confirmEndShift()`**

Same as Task 5 Step 3.

- [ ] **Step 6: Mount `ActiveTimerWarningDialog`** inside the return, alongside `<EndShiftConfirmDialog/>`.

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | tail -15
```

- [ ] **Step 8: Commit**

```bash
git add src/components/tiempo/ShiftPanel.tsx
git commit -m "feat: advertencia de timer activo al marcar pausa en ShiftPanel"
```

---

## Task 7 — StillOnlineDialog: clear localStorage on force logout

**Files:**
- Modify: `src/components/layout/StillOnlineDialog.tsx`

- [ ] **Step 1: Import `clearAllTimerKeysForUser`**

```ts
import { clearAllTimerKeysForUser } from '@/lib/domain/timer'
```

- [ ] **Step 2: Add userId resolution in `forceLogout()`**

The function already imports `createClient` pattern indirectly via `stopActiveEntry`. We need to get the auth user ID to clear localStorage. Add at the top of `forceLogout()`:

```ts
async function forceLogout() {
  try {
    // Obtener userId antes de cerrar la sesión
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    await stopActiveEntry().catch(() => {})
    await endShift().catch(() => {})

    // Limpiar claves de localStorage para evitar que timers "fantasma" aparezcan en el próximo login
    if (authUser) clearAllTimerKeysForUser(authUser.id)
  } finally {
    onForceLogout?.()
    window.location.href = '/auth/signout'
  }
}
```

Note: the import inside the function is intentional — this file is `'use client'` but `createClient` from `@/lib/supabase/client` is already available. You can replace the dynamic import with a top-level import if `createClient` isn't already imported:

At the top of the file add:
```ts
import { createClient } from '@/lib/supabase/client'
```

Then simplify `forceLogout()`:
```ts
async function forceLogout() {
  try {
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    await stopActiveEntry().catch(() => {})
    await endShift().catch(() => {})
    if (authUser) clearAllTimerKeysForUser(authUser.id)
  } finally {
    onForceLogout?.()
    window.location.href = '/auth/signout'
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/StillOnlineDialog.tsx
git commit -m "fix: limpiar localStorage de timers al hacer force logout desde StillOnlineDialog"
```

---

## Task 8 — `QuickTimerDialog`: disable start button when no active shift

**Files:**
- Modify: `src/components/pipeline/QuickTimerDialog.tsx`

The dialog currently reads the localStorage timer on open. We also need to check if the user has an active `work_session`.

- [ ] **Step 1: Add `hasActiveShift` state**

```ts
const [hasActiveShift, setHasActiveShift] = useState<boolean | null>(null)
```

`null` = loading; `true` = shift active; `false` = no shift.

- [ ] **Step 2: Check shift in the `open` useEffect**

Add alongside the existing `getActiveTimer()` call inside the `useEffect` that triggers on `open`:

```ts
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.resolve().then(async () => {
      if (cancelled) return
      const t = getActiveTimer(requirementId, currentUserId)
      setActiveTimer(t)
      setElapsed(t ? Math.floor((new Date().getTime() - t.startedAt) / 1000) : 0)
      setError(null)

      // Verificar jornada activa
      const supabase = createClient()
      const { data: shift } = await supabase
        .from('work_sessions')
        .select('id')
        .eq('user_id', currentUserId)
        .is('ended_at', null)
        .maybeSingle()
      if (!cancelled) setHasActiveShift(!!shift)
    })
    return () => { cancelled = true }
  }, [open, requirementId, currentUserId])
```

- [ ] **Step 3: Update the "Iniciar timer" button**

The button is already disabled when `!canStart`. Extend the condition:

```tsx
disabled={busy || !canStart || hasActiveShift === false}
title={
  hasActiveShift === false
    ? 'Debes iniciar tu jornada laboral antes de registrar tiempo'
    : windowLabel ?? undefined
}
```

When `hasActiveShift === null` (loading) keep the button enabled — the server action will catch it anyway.

Also show an info hint below the existing `windowLabel` block when `hasActiveShift === false`:

```tsx
{hasActiveShift === false && (
  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5">
    <span className="material-symbols-outlined text-[16px]">schedule</span>
    Inicia tu jornada laboral antes de registrar tiempo.
  </p>
)}
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/QuickTimerDialog.tsx
git commit -m "feat: deshabilitar inicio de timer en QuickTimerDialog si no hay jornada activa"
```

---

## Task 9 — `ClockInPanel`: disable start button when no active shift

**Files:**
- Modify: `src/components/tiempo/ClockInPanel.tsx`

- [ ] **Step 1: Import `getMyActiveShift`**

```ts
import { getMyActiveShift } from '@/app/actions/work-sessions'
```

- [ ] **Step 2: Add `hasActiveShift` state and effect**

```ts
const [hasActiveShift, setHasActiveShift] = useState<boolean | null>(null)

useEffect(() => {
  let cancelled = false
  getMyActiveShift().then((s) => {
    if (!cancelled) setHasActiveShift(!!s)
  })
  return () => { cancelled = true }
}, [])
```

- [ ] **Step 3: Disable the start button when no shift**

Find the "Iniciar" button (the one that calls `handleStart`). Add:

```tsx
disabled={isPending || hasActiveShift === false}
title={hasActiveShift === false ? 'Debes iniciar tu jornada para registrar tiempo' : undefined}
```

Add the hint below the button group (not inside it, to avoid breaking the layout):

```tsx
{hasActiveShift === false && (
  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
    Inicia tu jornada desde el widget en el header antes de registrar tiempo.
  </p>
)}
```

- [ ] **Step 4: Verify build + lint**

```bash
npm run lint 2>&1 | grep "ClockInPanel\|error" | head -20
npm run build 2>&1 | tail -15
```

Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/tiempo/ClockInPanel.tsx
git commit -m "feat: deshabilitar marcación de asistencia si no hay jornada activa"
```

---

## Task 10 — Final verification

- [ ] **Step 1: Clean build with lint**

```bash
npm run lint 2>&1 | grep " error " | wc -l
npm run build 2>&1 | tail -20
```

Expected: lint error count same as baseline (12); build succeeds.

- [ ] **Step 2: Manual smoke test checklist**

| Scenario | Expected |
|----------|----------|
| Iniciar timer de req sin jornada activa (QuickTimerDialog) | Botón deshabilitado + tooltip |
| Iniciar timer interno sin jornada activa (/tiempo) | Botón deshabilitado + hint |
| Intentar startRequirementTimer sin jornada (API directo) | Error "Inicia tu jornada..." |
| Tener timer activo → click Almuerzo | `ActiveTimerWarningDialog` aparece; jornada NO se pausa; timer sigue abierto |
| Tener timer activo → click Away | Igual |
| Sin timer activo → click Almuerzo | Pausa inmediata (sin diálogo) |
| StillOnlineDialog: countdown → 0 | `stopActiveEntry` + `endShift` + `clearAllTimerKeysForUser` + redirect `/auth/signout` |
| Finalizar jornada con timer activo (widget y /tiempo) | `EndShiftConfirmDialog` → confirmar → cierra timer + jornada + limpia localStorage |
| Abrir QuickTimerDialog después de force logout | Sin timer "fantasma" en localStorage |

- [ ] **Step 3: Tag end state**

```bash
git log --oneline -10
```

Confirm the 9 commits from this plan appear in sequence.

---

## Notes

- No new DB migrations — all changes are client/server logic only.
- `clearAllTimerKeysForUser` iterates `localStorage.length` which is O(n) over all keys. In practice localStorage has < 50 keys; this is not a perf concern.
- The shift guard in server actions (`startRequirementTimer`, `startAdminEntry`) adds 1 extra DB query per timer start — acceptable for correctness.
- The `hasActiveShift` check in `QuickTimerDialog` adds 1 extra DB query on dialog open. The query is lightweight (`select id` with `.maybeSingle()`).
- `ActiveTimerWarningDialog` intentionally does NOT close the timer — the user must do it themselves via `QuickTimerDialog` or `ClockInPanel`. This preserves full control and audit trail.
