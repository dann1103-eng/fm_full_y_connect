# Bot de WhatsApp — Acciones y consultas para clientes con marca · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ampliar el bot de WhatsApp (audience `client`) para que consulte el pool de cambios del mes y registre dos acciones nuevas (pedir cambios, reprogramar fecha) bajo el patrón "registrar, equipo confirma", reusando los feeds de notificación derivados que ya existen.

**Architecture:** Toda la lógica con DB vive en `src/lib/ai/tools.ts` (`TOOL_DEFS` + `TOOL_FNS`). La aritmética y reglas puras se extraen a `src/lib/domain/credits.ts` y `src/lib/domain/pipeline.ts` y se testean con Vitest. Las escrituras usan `createAdminClient()` (RLS) y `FM_BOT_USER_ID` como autor. No hay migraciones de código: las tools se habilitan editando `wa_bot_configs` (audience `client`) en `/admin/whatsapp`.

**Tech Stack:** Next.js 16, TypeScript, Supabase JS, Vitest, Anthropic tool-use.

**Spec:** `docs/superpowers/specs/2026-06-18-bot-whatsapp-clientes-con-marca-design.md`

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/lib/domain/credits.ts` | Conteo y aritmética del pool de cambios (compartido bot + CRM) | Modificar: añadir `countApprovedCambiosInCycle`, `countPendingCambiosInCycle`, `computeCambiosBalance` (pura), `getCambiosBalance` (DB). |
| `src/lib/domain/credits.test.ts` | Tests de la aritmética pura | Crear |
| `src/app/actions/cambioLogs.ts` | Consumo de cupo de cambios | Modificar: `consumeCambioSlot` reusa `countApprovedCambiosInCycle` (parity) |
| `src/lib/domain/pipeline.ts` | Fases del pipeline | Modificar: `CHANGE_ELIGIBLE_PHASES` + `canRequestChangeForPhase` |
| `src/lib/domain/pipeline.test.ts` | Test de fase elegible | Crear |
| `src/lib/ai/dates.ts` | Validación de fecha deseada (pura) | Crear |
| `src/lib/ai/dates.test.ts` | Tests de validación de fecha | Crear |
| `src/lib/ai/tools.ts` | Tools del bot | Modificar: 3 tools nuevas, 2 modificaciones |
| `src/lib/bot.ts` | Helpers FM Bot | Reusar `botPostMessage`, `FM_BOT_USER_ID` (sin cambios) |
| `wa_bot_configs` (DB) | Prompt + enabled_tools | Manual en `/admin/whatsapp` (Task 9) |

**Comandos del proyecto:** `npm run test` (vitest run) · `npm run lint` · `npm run build`. Tests junto al código (`src/**/*.test.ts`).

---

## Task 1: Helpers compartidos del pool de cambios (aritmética pura)

**Files:**
- Modify: `src/lib/domain/credits.ts`
- Test: `src/lib/domain/credits.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/domain/credits.test.ts
import { describe, it, expect } from 'vitest'
import { computeCambiosBalance } from './credits'

describe('computeCambiosBalance', () => {
  it('calcula remaining y total sumando créditos extra', () => {
    const b = computeCambiosBalance({ included: 5, used: 2, extraCredits: 3, pending: 1 })
    expect(b).toEqual({
      included: 5, used: 2, remaining_cycle: 3, extra_credits: 3, total_available: 6, pending: 1,
    })
  })

  it('no deja remaining negativo cuando se excede el cupo', () => {
    const b = computeCambiosBalance({ included: 4, used: 6, extraCredits: 0, pending: 0 })
    expect(b.remaining_cycle).toBe(0)
    expect(b.total_available).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test -- src/lib/domain/credits.test.ts`
Expected: FAIL — `computeCambiosBalance is not a function`.

- [ ] **Step 3: Implementar la función pura + tipos**

Añadir al final de `src/lib/domain/credits.ts`:

```ts
export interface CambiosBalance {
  included: number
  used: number
  remaining_cycle: number
  extra_credits: number
  total_available: number
  pending: number
}

/** Aritmética pura del pool de cambios. Sin DB — testeable directo. */
export function computeCambiosBalance(input: {
  included: number
  used: number
  extraCredits: number
  pending: number
}): CambiosBalance {
  const remaining_cycle = Math.max(0, input.included - input.used)
  return {
    included: input.included,
    used: input.used,
    remaining_cycle,
    extra_credits: input.extraCredits,
    total_available: remaining_cycle + input.extraCredits,
    pending: input.pending,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test -- src/lib/domain/credits.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/credits.ts src/lib/domain/credits.test.ts
git commit -m "feat: computeCambiosBalance (aritmetica pura del pool de cambios)"
```

---

## Task 2: Contadores DB del pool + `getCambiosBalance`

**Files:**
- Modify: `src/lib/domain/credits.ts`

> Sin test unitario (toca DB; el repo no tiene infra de mocks de Supabase). Se verifica con `npm run build` + uso real. La aritmética ya quedó cubierta en Task 1.

- [ ] **Step 1: Añadir los contadores DB y el wrapper**

Añadir a `src/lib/domain/credits.ts` (importa `createAdminClient` arriba: `import { createAdminClient } from '@/lib/supabase/admin'`):

```ts
/**
 * Cuenta cambios APROBADOS (no-crédito, no anulados) en todo el ciclo.
 * Misma cuenta que consumeCambioSlot — fuente única de verdad del cupo usado.
 */
export async function countApprovedCambiosInCycle(
  admin: SupabaseClient,
  billingCycleId: string,
): Promise<number> {
  const { data: cycleReqs } = await admin
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', billingCycleId)
  const reqIds = (cycleReqs ?? []).map((r: { id: string }) => r.id)
  if (reqIds.length === 0) return 0
  const { count } = await admin
    .from('requirement_cambio_logs')
    .select('id', { count: 'exact', head: true })
    .in('requirement_id', reqIds)
    .eq('status', 'approved')
    .neq('voided', true)
    .is('paid_from_credit_id', null)
  return count ?? 0
}

/** Cuenta cambios PENDIENTES de aprobación en el ciclo (los ya pedidos, aún sin aplicar). */
export async function countPendingCambiosInCycle(
  admin: SupabaseClient,
  billingCycleId: string,
): Promise<number> {
  const { data: cycleReqs } = await admin
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', billingCycleId)
  const reqIds = (cycleReqs ?? []).map((r: { id: string }) => r.id)
  if (reqIds.length === 0) return 0
  const { count } = await admin
    .from('requirement_cambio_logs')
    .select('id', { count: 'exact', head: true })
    .in('requirement_id', reqIds)
    .eq('status', 'pending')
    .neq('voided', true)
  return count ?? 0
}

/**
 * Saldo del pool de cambios del mes para un cliente. Crea su propio admin client
 * (igual que checkRequestEligibilityForClient). Devuelve `null` si no hay ciclo activo.
 */
export async function getCambiosBalance(clientId: string): Promise<CambiosBalance | null> {
  const admin = createAdminClient()
  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycle?.id) return null

  const { data: clientRow } = await admin
    .from('clients')
    .select('plan:plans(cambios_included)')
    .eq('id', clientId)
    .maybeSingle()
  const included: number =
    (clientRow?.plan as { cambios_included: number } | null)?.cambios_included ?? 0

  const [used, pending, extraCredits] = await Promise.all([
    countApprovedCambiosInCycle(admin, cycle.id as string),
    countPendingCambiosInCycle(admin, cycle.id as string),
    getAvailableCambiosCredits(admin, clientId),
  ])

  return computeCambiosBalance({ included, used, extraCredits, pending })
}
```

> `SupabaseClient` ya está importado en el archivo (línea 13). `getAvailableCambiosCredits` ya existe.

- [ ] **Step 2: Verificar tipos**

Run: `npm run build`
Expected: build OK (sin errores de tipos nuevos).

- [ ] **Step 3: Commit**

```bash
git add src/lib/domain/credits.ts
git commit -m "feat: getCambiosBalance + contadores de cambios por ciclo"
```

---

## Task 3: `consumeCambioSlot` reusa el contador compartido (parity)

**Files:**
- Modify: `src/app/actions/cambioLogs.ts:16-45`

> Garantiza que el saldo que ve el bot coincida EXACTO con el que el CRM consume.

- [ ] **Step 1: Reemplazar el conteo inline por el helper compartido**

En `src/app/actions/cambioLogs.ts`, importar arriba:

```ts
import { consumeCredit, refundCredit, countApprovedCambiosInCycle } from '@/lib/domain/credits'
```

Eliminar el bloque de conteo local `cambioLogs.ts:20-37` (desde `const { data: cycleReqs }` hasta `globalUsed = count ?? 0`) y dejar el cuerpo de `consumeCambioSlot` así (las líneas 39-44 con `consumeCredit`/returns se conservan, reproducidas aquí):

```ts
  const globalUsed = await countApprovedCambiosInCycle(admin, args.billingCycleId)

  if (globalUsed < args.cambiosIncluidos) {
    return { ok: true, creditId: null }
  }
  const creditId = await consumeCredit(admin, { clientId: args.clientId, kind: 'cambios' })
  if (!creditId) return { ok: false }
  return { ok: true, creditId }
```

(Eliminar el bloque local `const { data: cycleReqs } ... globalUsed = count ?? 0`.)

- [ ] **Step 2: Verificar tipos + lint**

Run: `npm run build && npm run lint`
Expected: OK. Confirmar que `consumeCambioSlot` sigue devolviendo `{ ok, creditId }` igual que antes.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/cambioLogs.ts
git commit -m "refactor: consumeCambioSlot reusa countApprovedCambiosInCycle"
```

---

## Task 4: Fase elegible para cambios (regla pura)

**Files:**
- Modify: `src/lib/domain/pipeline.ts`
- Test: `src/lib/domain/pipeline.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/domain/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { canRequestChangeForPhase } from './pipeline'

describe('canRequestChangeForPhase', () => {
  it('permite cambios en fases de trabajo y revisión', () => {
    expect(canRequestChangeForPhase('revision_cliente')).toBe(true)
    expect(canRequestChangeForPhase('proceso_diseno')).toBe(true)
    expect(canRequestChangeForPhase('pendiente')).toBe(true)
  })
  it('bloquea cambios en fases finales', () => {
    expect(canRequestChangeForPhase('aprobado')).toBe(false)
    expect(canRequestChangeForPhase('pendiente_publicar')).toBe(false)
    expect(canRequestChangeForPhase('publicado_entregado')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test -- src/lib/domain/pipeline.test.ts`
Expected: FAIL — `canRequestChangeForPhase is not a function`.

- [ ] **Step 3: Implementar la regla**

Añadir a `src/lib/domain/pipeline.ts` (usa el tipo `Phase` ya definido en el archivo):

```ts
/** Fases en las que NO tiene sentido pedir un cambio (contenido ya cerrado). */
const CHANGE_BLOCKED_PHASES: Phase[] = ['aprobado', 'pendiente_publicar', 'publicado_entregado']

/** True si en esta fase interna el cliente todavía puede pedir un cambio. */
export function canRequestChangeForPhase(phase: Phase): boolean {
  return !CHANGE_BLOCKED_PHASES.includes(phase)
}
```

> `Phase` ya está importado en `pipeline.ts:2` (`import type { Phase, ... } from '@/types/db'`). NO volver a importarlo (sería redeclaración).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test -- src/lib/domain/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/pipeline.ts src/lib/domain/pipeline.test.ts
git commit -m "feat: canRequestChangeForPhase (fase elegible para cambios)"
```

---

## Task 5: Validación pura de fecha deseada

**Files:**
- Create: `src/lib/ai/dates.ts`
- Test: `src/lib/ai/dates.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/ai/dates.test.ts
import { describe, it, expect } from 'vitest'
import { isPlausibleDesiredDate } from './dates'

describe('isPlausibleDesiredDate', () => {
  it('acepta fecha YYYY-MM-DD', () => {
    expect(isPlausibleDesiredDate('2026-07-01')).toBe(true)
  })
  it('acepta datetime ISO con hora', () => {
    expect(isPlausibleDesiredDate('2026-07-01T15:30')).toBe(true)
  })
  it('rechaza basura o vacío', () => {
    expect(isPlausibleDesiredDate('mañana')).toBe(false)
    expect(isPlausibleDesiredDate('')).toBe(false)
    expect(isPlausibleDesiredDate('2026/07/01')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test -- src/lib/ai/dates.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el validador**

```ts
// src/lib/ai/dates.ts
/**
 * Valida que una fecha deseada tenga formato aceptable para el bot:
 *  - Fecha: "YYYY-MM-DD"
 *  - Datetime: "YYYY-MM-DDTHH:MM" (opcionalmente con segundos)
 * No valida rango (el staff confirma); solo descarta texto libre.
 */
export function isPlausibleDesiredDate(value: string): boolean {
  if (!value) return false
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
  if (!dateOnly.test(value) && !dateTime.test(value)) return false
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test -- src/lib/ai/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/dates.ts src/lib/ai/dates.test.ts
git commit -m "feat: isPlausibleDesiredDate (validacion de fecha del bot)"
```

---

## Task 6: Tool `get_changes_balance`

**Files:**
- Modify: `src/lib/ai/tools.ts` (`TOOL_DEFS` + `TOOL_FNS`)

> DB-bound; verificación por build/lint. La aritmética ya está testeada (Task 1).

- [ ] **Step 1: Importar el helper**

Arriba de `src/lib/ai/tools.ts`:

```ts
import { getCambiosBalance } from '@/lib/domain/credits'
```

- [ ] **Step 2: Añadir la definición en `TOOL_DEFS`**

```ts
  get_changes_balance: {
    name: 'get_changes_balance',
    description:
      'Cuántos cambios le quedan al cliente en el MES (pool del plan + créditos extra). Úsalo cuando el cliente pregunte por cambios o ANTES de registrar una solicitud de cambio. Devuelve: included (cupo del plan), used (ya aprobados), remaining_cycle, extra_credits, total_available y pending (cambios ya pedidos sin aprobar aún).',
    input_schema: { type: 'object', properties: {} },
  },
```

- [ ] **Step 3: Añadir el ejecutor en `TOOL_FNS`**

```ts
  get_changes_balance: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const bal = await getCambiosBalance(ctx.clientId)
    if (!bal) return { error: 'No hay ciclo activo.' }
    return bal
  },
```

- [ ] **Step 4: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools.ts
git commit -m "feat: tool get_changes_balance (pool de cambios del mes)"
```

---

## Task 7: Modificar `get_requirement_detail` (añadir `cambios_count`)

**Files:**
- Modify: `src/lib/ai/tools.ts` (`get_requirement_detail` en `TOOL_FNS`, ~líneas 241-266)

- [ ] **Step 1: Añadir `cambios_count` al select y al output**

En el `.select(...)` de `get_requirement_detail` agregar `cambios_count`:

```ts
      .select('id, title, content_type, phase, deadline, cambios_count, billing_cycles!inner ( client_id )')
```

Ampliar el tipo `row` con `cambios_count: number | null` y añadir al objeto retornado:

```ts
      cambios_count: row.cambios_count ?? 0,
```

Actualizar la descripción de la tool en `TOOL_DEFS` para mencionar "incluye cambios ya aplicados (informativo)".

- [ ] **Step 2: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/tools.ts
git commit -m "feat: get_requirement_detail incluye cambios_count"
```

---

## Task 8: Tool `request_requirement_change`

**Files:**
- Modify: `src/lib/ai/tools.ts`

> Patrón "registrar, equipo confirma": inserta un cambio `pending` (aparece solo en la campana de admin/supervisor vía feed `cambio_pending`) + deja mensaje de contexto. NO consume el pool.

- [ ] **Step 1: Imports necesarios**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { canRequestChangeForPhase } from '@/lib/domain/pipeline'
import { botPostMessage, FM_BOT_USER_ID } from '@/lib/bot'
```

- [ ] **Step 2: Definición en `TOOL_DEFS`**

```ts
  request_requirement_change: {
    name: 'request_requirement_change',
    description:
      'Registra una SOLICITUD de cambio del cliente sobre un contenido existente (no lo aplica; el equipo lo revisa y aplica). Antes de llamarla: (1) identifica el requirement_id correcto (usa get_requirements_by_phase / get_requirement_detail), (2) verifica con get_changes_balance que total_available > 0. Si no hay cambios disponibles, NO la llames: explica que se agotaron y ofrece escalar.',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string' },
        change_notes: { type: 'string', description: 'Qué quiere cambiar el cliente, en sus palabras.' },
      },
      required: ['requirement_id', 'change_notes'],
    },
  },
```

- [ ] **Step 3: Ejecutor en `TOOL_FNS`**

```ts
  request_requirement_change: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const reqId = String(input.requirement_id ?? '').trim()
    const notes = String(input.change_notes ?? '').trim()
    if (!reqId) return { error: 'Falta requirement_id' }
    if (!notes) return { error: 'Falta la descripción del cambio' }

    const admin = createAdminClient()
    const { data } = await admin
      .from('requirements')
      .select('id, phase, billing_cycles!inner ( client_id )')
      .eq('id', reqId)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as { id: string; phase: Phase; billing_cycles?: { client_id: string } }

    // Ownership estricto positivo.
    if (row.billing_cycles?.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }
    if (!canRequestChangeForPhase(row.phase)) {
      return { error: 'Ese contenido ya está aprobado/publicado y no admite cambios.' }
    }

    const bal = await getCambiosBalance(ctx.clientId)
    if (!bal || bal.total_available <= 0) {
      return {
        error: 'Se agotaron los cambios del plan para este mes.',
        suggestion: 'Ofrecer paquete de cambios extra o escalar con handoff_to_human.',
      }
    }

    const { data: log, error } = await admin
      .from('requirement_cambio_logs')
      .insert({ requirement_id: reqId, notes, created_by: FM_BOT_USER_ID, status: 'pending', voided: false })
      .select('id')
      .single()
    if (error || !log) return { error: 'No se pudo registrar el cambio' }

    // Contexto en el chat del requerimiento (interno).
    await botPostMessage(admin, {
      requirementId: reqId,
      body: `✏️ Cambio solicitado por el cliente (vía WhatsApp): ${notes}`,
      visibleToClient: false,
    })

    return {
      ok: true,
      cambio_log_id: (log as { id: string }).id,
      message: 'Registré tu solicitud de cambio. El equipo la revisará y la aplicará pronto.',
    }
  },
```

> `Phase` ya está importado en tools.ts (línea 3). `createAdminClient` retorna `SupabaseClient<Database>`, compatible con `botPostMessage`.

- [ ] **Step 4: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools.ts
git commit -m "feat: tool request_requirement_change (registrar cambio pendiente)"
```

---

## Task 9: Tool `request_reschedule`

**Files:**
- Modify: `src/lib/ai/tools.ts`

> Sin feed derivado de "reschedule": notifica vía menciones (mensaje primero, luego requirement_mentions). Fallback obligatorio a admins/supervisores si no hay asignados.

- [ ] **Step 1: Import del validador de fecha**

```ts
import { isPlausibleDesiredDate } from '@/lib/ai/dates'
```

- [ ] **Step 2: Definición en `TOOL_DEFS`**

```ts
  request_reschedule: {
    name: 'request_reschedule',
    description:
      'Registra una SOLICITUD del cliente para reprogramar la fecha de un contenido ya solicitado (no cambia la fecha real; el equipo confirma). Necesita requirement_id y la nueva fecha. Para reunión/producción usa "YYYY-MM-DDTHH:MM"; para los demás "YYYY-MM-DD".',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string' },
        new_desired_date: { type: 'string', description: 'Nueva fecha deseada (YYYY-MM-DD o YYYY-MM-DDTHH:MM).' },
        reason: { type: 'string', description: 'Motivo del cambio de fecha (opcional).' },
      },
      required: ['requirement_id', 'new_desired_date'],
    },
  },
```

- [ ] **Step 3: Ejecutor en `TOOL_FNS`**

```ts
  request_reschedule: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const reqId = String(input.requirement_id ?? '').trim()
    const newDate = String(input.new_desired_date ?? '').trim()
    const reason = input.reason ? String(input.reason).trim() : null
    if (!reqId) return { error: 'Falta requirement_id' }
    if (!isPlausibleDesiredDate(newDate)) {
      return { error: 'Fecha inválida. Pide al cliente una fecha concreta (ej. 2026-07-15).' }
    }

    const admin = createAdminClient()
    const { data } = await admin
      .from('requirements')
      .select('id, assigned_to, billing_cycles!inner ( client_id )')
      .eq('id', reqId)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as {
      id: string; assigned_to: string[] | null; billing_cycles?: { client_id: string }
    }
    if (row.billing_cycles?.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }

    const body = `📅 El cliente pide reprogramar a ${newDate}${reason ? ` — motivo: ${reason}` : ''}`
    const posted = await botPostMessage(admin, { requirementId: reqId, body, visibleToClient: false })
    if (!posted.ok) return { error: posted.error }

    // Destinos de la mención: asignados, o fallback a admins/supervisores.
    let targets = (row.assigned_to ?? []).filter(Boolean)
    if (targets.length === 0) {
      const { data: staff } = await admin
        .from('users')
        .select('id')
        .in('role', ['admin', 'supervisor'])
      targets = (staff ?? []).map((u: { id: string }) => u.id)
    }
    if (targets.length > 0) {
      const rows = targets.map((uid) => ({
        message_id: posted.messageId,
        requirement_id: reqId,
        mentioned_user_id: uid,
        mentioned_by_user_id: FM_BOT_USER_ID,
      }))
      await admin.from('requirement_mentions').upsert(rows, { onConflict: 'message_id,mentioned_user_id' })
    }

    return { ok: true, message: 'Avisé al equipo tu nueva fecha deseada. Te confirmarán pronto.' }
  },
```

- [ ] **Step 4: Verificar build + lint**

Run: `npm run build && npm run lint`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools.ts
git commit -m "feat: tool request_reschedule (registrar reprogramacion)"
```

---

## Task 10: `check_request_eligibility` suma créditos extra de contenido (A1.4)

**Files:**
- Modify: `src/lib/ai/requirementRequestHelpers.ts`
- Test: `src/lib/ai/requirementRequestHelpers.test.ts` (crear, solo la fusión pura)

> Hoy `available = limit − used` ignora `client_credits` de contenido. Esto solo afecta el NÚMERO que el bot informa (la creación no enforce límites). Se corrige para que el mensaje al cliente sea exacto.

- [ ] **Step 1: Extraer una función pura de fusión + test que falla**

```ts
// src/lib/ai/requirementRequestHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { applyExtraCreditsToAvailability } from './requirementRequestHelpers'
import type { RequestEligibilityResult } from './requirementRequestHelpers'

describe('applyExtraCreditsToAvailability', () => {
  it('suma créditos extra al available por tipo', () => {
    const types: RequestEligibilityResult['available_content_types'] = [
      { type: 'short', label: 'Short', used: 2, limit: 2, available: 0, allows_extra_story: true },
    ]
    const out = applyExtraCreditsToAvailability(types, { short: 3 })
    expect(out[0].available).toBe(3)
  })
  it('no altera tipos sin crédito', () => {
    const types: RequestEligibilityResult['available_content_types'] = [
      { type: 'reel', label: 'Reel', used: 1, limit: 4, available: 3, allows_extra_story: true },
    ]
    const out = applyExtraCreditsToAvailability(types, {})
    expect(out[0].available).toBe(3)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test -- src/lib/ai/requirementRequestHelpers.test.ts`
Expected: FAIL — `applyExtraCreditsToAvailability is not a function`.

- [ ] **Step 3: Implementar la función pura y usarla en el helper**

Añadir a `requirementRequestHelpers.ts` (`ContentType` ya está importado en la línea 6 — NO volver a importarlo):

```ts
/** Suma créditos extra de contenido al `available` de cada tipo (pura). */
export function applyExtraCreditsToAvailability(
  types: RequestEligibilityResult['available_content_types'],
  credits: Partial<Record<ContentType, number>>,
): RequestEligibilityResult['available_content_types'] {
  return types.map((t) => ({ ...t, available: t.available + (credits[t.type] ?? 0) }))
}
```

Luego, en `checkRequestEligibilityForClient`, antes del `return`, traer créditos y aplicarlos:

```ts
import { getAvailableContentCredits } from '@/lib/domain/credits'
// ...
const extraCredits = await getAvailableContentCredits(admin, clientId)
const merged = applyExtraCreditsToAvailability(available_content_types, extraCredits)
```

Y devolver `available_content_types: merged` en el objeto final.

- [ ] **Step 4: Correr tests + build**

Run: `npm run test -- src/lib/ai/requirementRequestHelpers.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/requirementRequestHelpers.ts src/lib/ai/requirementRequestHelpers.test.ts
git commit -m "feat: check_request_eligibility suma creditos extra de contenido"
```

---

## Task 11: Habilitar tools nuevas + ajustar prompt (manual, DB)

**Files:** ninguno de código. Se hace en `/admin/whatsapp` (tab Clientes) o por SQL sobre `wa_bot_configs` (audience `client`).

> No commit de código. Documentar el cambio aquí y avisar al usuario.

- [ ] **Step 1: Añadir a `enabled_tools` (audience `client`)**

Agregar: `get_changes_balance`, `request_requirement_change`, `request_reschedule`. Mantener las existentes.

- [ ] **Step 2: Ajustar el `system_prompt` (audience `client`)**

Incluir instrucciones:
- **Disponibilidad proactiva (A1.2/A1.3):** ante una petición vaga de pedir contenido ("quiero pedir algo", "qué puedo pedir"), llamar `check_request_eligibility` y listar lo disponible por tipo, mencionando lo usado cuando aporte ("tienes 2 shorts y 3 estáticos disponibles; ya usaste 1 reel de 4").
- **Cambios:** para pedir un cambio, primero identificar el `requirement_id` (mostrar lista si hace falta), luego `get_changes_balance`; si `total_available > 0`, confirmar con el cliente y llamar `request_requirement_change`; si es 0, explicar que se agotaron y ofrecer escalar.
- **Reprogramar:** pedir la nueva fecha concreta y llamar `request_reschedule`. Aclarar que el equipo confirmará.
- Recalcar que nada se aplica solo: el bot **registra** y el equipo confirma.

- [ ] **Step 3: Revisar `max_tokens`**

Si el flujo nuevo trunca respuestas, subir `max_tokens` (hoy 800) a ~1000.

- [ ] **Step 4: Prueba humo en producción/staging**

Desde un número de cliente vinculado, probar: (a) "¿qué puedo pedir?", (b) "quiero un cambio en mi short", (c) "¿cuántos cambios me quedan?", (d) "muevan la fecha de X a Y". Verificar que aparezcan: el cambio `pending` en la campana de admin/supervisor y el mensaje en el chat del requerimiento.

---

## Task 12: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npm run test`
Expected: todos los tests PASS (incluye los nuevos: credits, pipeline, dates, requirementRequestHelpers).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: 0 errores nuevos, build OK.

- [ ] **Step 3: Actualizar memoria del proyecto**

Anotar en `project_whatsapp_bot.md` las 3 tools nuevas + el modelo de pool de cambios + que las notificaciones se reusan de los feeds derivados. Mover del backlog el ítem #8 ("acciones del cliente vía chat") a capacidades actuales (parcial: cambios + reprogramar; aprobar sigue fuera).

---

## Notas de implementación

- **DRY:** el conteo del pool vive en un solo lugar (`countApprovedCambiosInCycle`), consumido por el bot y por `consumeCambioSlot`.
- **YAGNI:** no se construye sistema de notificaciones; se reusan `cambio_pending` y `mention`.
- **Seguridad:** todas las escrituras usan `createAdminClient()` + ownership estricto positivo + `FM_BOT_USER_ID`.
- **Fuera de alcance:** aprobar contenido desde el chat; aplicar cambios/fechas directo; comprar paquetes extra desde el chat.
