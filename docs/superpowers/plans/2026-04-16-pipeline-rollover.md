# Pipeline Rollover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al crear un nuevo ciclo de facturación, las piezas de contenido que no llegaron a "Publicado" en el ciclo anterior se trasladan automáticamente al nuevo ciclo con su fase y historial completo, sin contar contra los límites del nuevo plan.

**Architecture:** Se agrega `carried_over: boolean` a `consumptions`. Una función de dominio `migrateOpenPipelineItems` encapsula toda la lógica de traslado. Los componentes `RenewalRow` y `ReactivatePanel` la invocan tras crear el nuevo ciclo. `computeTotals` excluye consumos `carried_over`.

**Tech Stack:** Next.js 16, TypeScript, Supabase JS v2, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-04-16-pipeline-rollover.md`

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|----------------|
| Crear | `supabase/migrations/0003_pipeline_rollover.sql` | Columna `carried_over` en consumptions |
| Modificar | `src/types/db.ts` | Agregar `carried_over` a consumptions + `created_at` a phase_logs Insert |
| Modificar | `src/lib/domain/consumption.ts` | Excluir `carried_over` de `computeTotals` |
| Modificar | `src/lib/domain/pipeline.ts` | Agregar `carried_over` a PipelineItem + nueva función `migrateOpenPipelineItems` |
| Modificar | `src/components/renewals/RenewalRow.tsx` | Capturar newCycleId + llamar migrate |
| Modificar | `src/components/clients/ReactivatePanel.tsx` | Secuenciar insert + llamar migrate |
| Modificar | `src/app/(app)/pipeline/page.tsx` | Incluir `carried_over` en query y PipelineItem |
| Modificar | `src/app/(app)/clients/[id]/page.tsx` | Incluir `carried_over` en query y PipelineItem |
| Modificar | `src/components/pipeline/PipelineCard.tsx` | Badge "Traslado" si carried_over |

---

## Task 1: Migración SQL

**Files:**
- Create: `supabase/migrations/0003_pipeline_rollover.sql`

- [ ] **Step 1: Crear el archivo**

```sql
-- ============================================================
-- FM CRM — Migration 0003: Pipeline rollover (carried_over)
-- ============================================================

ALTER TABLE public.consumptions
  ADD COLUMN carried_over boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Aplicar en Supabase Dashboard**

SQL Editor → pegar y ejecutar. Verificar que la columna `carried_over` aparece en la tabla `consumptions`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_pipeline_rollover.sql
git commit -m "feat: add carried_over column to consumptions for pipeline rollover"
```

---

## Task 2: Actualizar tipos TypeScript

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Agregar `carried_over` a `consumptions`**

En `consumptions.Row`, después de `phase: Phase`, agregar:
```typescript
carried_over: boolean
```

En `consumptions.Insert`, después de `phase?: Phase`, agregar:
```typescript
carried_over?: boolean
```

En `consumptions.Update`, después de `phase?: Phase`, agregar:
```typescript
carried_over?: boolean
```

- [ ] **Step 2: Verificar que `consumption_phase_logs.created_at` acepta valores del cliente**

En Supabase Dashboard → SQL Editor, ejecutar:

```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'consumption_phase_logs'
  AND action_statement ILIKE '%created_at%';
```

Esperado: **0 filas** — ningún trigger sobreescribe `created_at`. Si hay filas, actualizar `migrateOpenPipelineItems` en Task 4 para omitir `created_at` del bloque de copia de logs (Supabase usará `now()` y el orden quedará por inserción, no por timestamp original).

- [ ] **Step 3: Agregar `created_at` a `consumption_phase_logs.Insert`**

En el bloque `consumption_phase_logs.Insert`, después de `notes?: string | null`, agregar:
```typescript
created_at?: string
```

- [ ] **Step 4: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add src/types/db.ts
git commit -m "feat: add carried_over to consumptions types and created_at to phase logs Insert"
```

---

## Task 3: Actualizar `computeTotals` en consumption.ts

**Files:**
- Modify: `src/lib/domain/consumption.ts`

- [ ] **Step 1: Cambiar la condición de conteo**

Localizar:
```typescript
  for (const c of consumptions) {
    if (!c.voided) {
      totals[c.content_type]++
    }
  }
```

Reemplazar con:
```typescript
  for (const c of consumptions) {
    if (!c.voided && !c.carried_over) {
      totals[c.content_type]++
    }
  }
```

- [ ] **Step 2: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/domain/consumption.ts
git commit -m "feat: exclude carried_over consumptions from computeTotals"
```

---

## Task 4: Dominio — `PipelineItem` y `migrateOpenPipelineItems`

**Files:**
- Modify: `src/lib/domain/pipeline.ts`

- [ ] **Step 1: Agregar `carried_over` a la interfaz `PipelineItem`**

Localizar la interfaz `PipelineItem` y agregar el campo:
```typescript
  carried_over: boolean
```
después de `notes: string | null`.

- [ ] **Step 2: Agregar la función `migrateOpenPipelineItems` al final del archivo**

```typescript
/**
 * Traslada automáticamente las piezas abiertas del ciclo anterior al nuevo ciclo.
 * - Solo tipos en PIPELINE_CONTENT_TYPES (excluye 'produccion')
 * - Solo no anuladas y en fase distinta a 'publicado'
 * - Las piezas trasladadas tienen carried_over = true (no descuentan del nuevo límite)
 * - Se copian todos los logs históricos + se agrega un log de migración
 */
export async function migrateOpenPipelineItems(
  supabase: SupabaseClient<Database>,
  params: {
    previousCycleId: string
    newCycleId: string
    movedBy: string
  }
): Promise<void> {
  const { previousCycleId, newCycleId, movedBy } = params

  // 1. Obtener piezas abiertas del ciclo anterior
  const { data: openItems } = await supabase
    .from('consumptions')
    .select('id, content_type, phase')
    .eq('billing_cycle_id', previousCycleId)
    .eq('voided', false)
    .neq('phase', 'publicado')
    .in('content_type', PIPELINE_CONTENT_TYPES)

  if (!openItems || openItems.length === 0) return

  for (const item of openItems) {
    // 2. Crear nuevo consumo en el nuevo ciclo
    const { data: newConsumption, error: insertError } = await supabase
      .from('consumptions')
      .insert({
        billing_cycle_id: newCycleId,
        content_type: item.content_type,
        phase: item.phase as Phase,
        carried_over: true,
        registered_by_user_id: movedBy,
        over_limit: false,
        voided: false,
      })
      .select('id')
      .single()

    if (insertError || !newConsumption) {
      console.error('migrateOpenPipelineItems: falló al insertar consumo trasladado', insertError)
      continue
    }

    // 3. Copiar logs históricos del consumo original
    const { data: oldLogs } = await supabase
      .from('consumption_phase_logs')
      .select('*')
      .eq('consumption_id', item.id)
      .order('created_at', { ascending: true })

    // Omitir deliberadamente log.id para que Supabase genere un nuevo UUID por cada copia
    for (const log of oldLogs ?? []) {
      await supabase.from('consumption_phase_logs').insert({
        consumption_id: newConsumption.id,
        from_phase: log.from_phase as Phase | null,
        to_phase: log.to_phase as Phase,
        moved_by: log.moved_by,
        notes: log.notes,
        created_at: log.created_at,
      })
    }

    // 4. Agregar log de migración
    await supabase.from('consumption_phase_logs').insert({
      consumption_id: newConsumption.id,
      from_phase: null,
      to_phase: item.phase as Phase,
      moved_by: movedBy,
      notes: 'Trasladado del ciclo anterior',
    })
  }
}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/domain/pipeline.ts
git commit -m "feat: add carried_over to PipelineItem and migrateOpenPipelineItems function"
```

---

## Task 5: Integrar migración en `RenewalRow.tsx`

**Files:**
- Modify: `src/components/renewals/RenewalRow.tsx`

- [ ] **Step 1: Agregar import de `migrateOpenPipelineItems`**

Al inicio del archivo, junto a los imports existentes de `@/lib/domain/`:
```typescript
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'
```

- [ ] **Step 2: Modificar `handleRenew` para capturar el id del nuevo ciclo**

Localizar el bloque exacto del insert del nuevo ciclo (texto completo, no abreviado):
```typescript
    // Create new cycle
    await supabase.from('billing_cycles').insert({
      client_id: client.id,
      plan_id_snapshot: planId,
      limits_snapshot_json: planLimits,
      rollover_from_previous_json: hasRollover ? rolloverJson : null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'current',
      payment_status: 'unpaid',
    })
```

Reemplazar con:
```typescript
    // Create new cycle
    const { data: newCycle } = await supabase
      .from('billing_cycles')
      .insert({
        client_id: client.id,
        plan_id_snapshot: planId,
        limits_snapshot_json: planLimits,
        rollover_from_previous_json: hasRollover ? rolloverJson : null,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'current',
        payment_status: 'unpaid',
      })
      .select('id')
      .single()
```

- [ ] **Step 3: Llamar `migrateOpenPipelineItems` tras crear el ciclo**

Localizar el tail actual de `handleRenew` (las dos líneas finales antes del cierre de `handlePause`):
```typescript
    setLoading(false)
    router.refresh()
  }

  async function handlePause() {
```

Reemplazar con (agrega el bloque de migración antes del tail, sin eliminar `setLoading`/`router.refresh()`):
```typescript
    // Trasladar piezas abiertas del pipeline al nuevo ciclo
    if (newCycle?.id) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        await migrateOpenPipelineItems(supabase, {
          previousCycleId: cycle.id,
          newCycleId: newCycle.id,
          movedBy: authUser.id,
        })
      }
    }

    setLoading(false)
    router.refresh()
  }

  async function handlePause() {
```

- [ ] **Step 4: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/renewals/RenewalRow.tsx
git commit -m "feat: migrate open pipeline items to new cycle on renewal"
```

---

## Task 6: Integrar migración en `ReactivatePanel.tsx`

**Files:**
- Modify: `src/components/clients/ReactivatePanel.tsx`

- [ ] **Step 1: Agregar import de `migrateOpenPipelineItems`**

```typescript
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'
```

- [ ] **Step 2: Reescribir `handleReactivate` para orden secuencial y migración**

Reemplazar todo el cuerpo de `handleReactivate` con:

```typescript
  async function handleReactivate() {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const plan = plans.find((p) => p.id === selectedPlanId)
    if (!plan) { setError('Plan no encontrado.'); setLoading(false); return }

    // Obtener usuario actual
    const { data: { user: authUser } } = await supabase.auth.getUser()

    // Buscar el último ciclo archivado del cliente (para migración de pipeline)
    const { data: prevCycle } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('client_id', client.id)
      .eq('status', 'archived')
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { periodStart, periodEnd } = firstCycleDates(startDate, client.billing_day)

    // PRIMERO: crear el nuevo ciclo (si falla, cliente sigue paused — estado seguro)
    const { data: newCycle, error: cycleError } = await supabase
      .from('billing_cycles')
      .insert({
        client_id: client.id,
        plan_id_snapshot: plan.id,
        limits_snapshot_json: plan.limits_json,
        rollover_from_previous_json: null,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'current',
        payment_status: 'unpaid',
      })
      .select('id')
      .single()

    if (cycleError || !newCycle) {
      setError('Error al crear el ciclo.')
      setLoading(false)
      return
    }

    // DESPUÉS: actualizar estado del cliente
    const { error: clientError } = await supabase
      .from('clients')
      .update({ status: 'active', current_plan_id: selectedPlanId })
      .eq('id', client.id)

    if (clientError) {
      setError('Error al reactivar el cliente.')
      setLoading(false)
      return
    }

    // Migrar piezas abiertas del pipeline si había ciclo anterior
    if (prevCycle?.id && authUser) {
      await migrateOpenPipelineItems(supabase, {
        previousCycleId: prevCycle.id,
        newCycleId: newCycle.id,
        movedBy: authUser.id,
      })
    }

    setLoading(false)
    router.refresh()
  }
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/ReactivatePanel.tsx
git commit -m "feat: migrate open pipeline items to new cycle on client reactivation"
```

---

## Task 7: Incluir `carried_over` en las páginas del pipeline

**Files:**
- Modify: `src/app/(app)/pipeline/page.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Actualizar la query en `/pipeline/page.tsx`**

Localizar el select de consumptions:
```typescript
.select('id, content_type, phase, billing_cycle_id, registered_at, notes')
```
Reemplazar con:
```typescript
.select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes')
```

Luego en el `items.push({...})`, agregar:
```typescript
carried_over: c.carried_over,
```

- [ ] **Step 2: Actualizar la query en `/clients/[id]/page.tsx`**

Localizar el select de pipelineCons:
```typescript
.select('id, content_type, phase, billing_cycle_id, registered_at, notes')
```
Reemplazar con:
```typescript
.select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes')
```

Luego en el `pipelineItems.push({...})`, agregar:
```typescript
carried_over: c.carried_over,
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```
Esperado: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/pipeline/page.tsx src/app/(app)/clients/[id]/page.tsx
git commit -m "feat: include carried_over field in pipeline page queries"
```

---

## Task 8: Badge "Traslado" en `PipelineCard.tsx`

**Files:**
- Modify: `src/components/pipeline/PipelineCard.tsx`

- [ ] **Step 1: Agregar el badge "Traslado" bajo el badge de tipo de contenido**

Localizar el bloque del badge de tipo de contenido:
```tsx
        <span
          className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${
            CONTENT_TYPE_COLORS[item.content_type] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {CONTENT_TYPE_LABELS[item.content_type]}
        </span>
```

Después de ese bloque, agregar:
```tsx
        {item.carried_over && (
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 bg-amber-100 text-amber-700 ml-1">
            Traslado
          </span>
        )}
```

- [ ] **Step 2: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```

- [ ] **Step 3: Build final**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npm run build 2>&1 | tail -20
```
Esperado: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/PipelineCard.tsx
git commit -m "feat: show Traslado badge on carried-over pipeline cards"
```

---

## Verificación manual

- [ ] Registrar consumos en un cliente → renovar el ciclo → verificar que los no publicados aparecen en el nuevo ciclo con badge "Traslado"
- [ ] Verificar que los consumos trasladados NO descuentan del límite (el contador del panel de consumo no los cuenta)
- [ ] Abrir el Sheet de una pieza trasladada → verificar que el historial muestra los logs anteriores + el log "Trasladado del ciclo anterior"
- [ ] Verificar que piezas en fase "publicado" NO se trasladan
- [ ] Verificar que piezas anuladas NO se trasladan

---

## Resumen de commits esperados

1. `feat: add carried_over column to consumptions for pipeline rollover`
2. `feat: add carried_over to consumptions types and created_at to phase logs Insert`
3. `feat: exclude carried_over consumptions from computeTotals`
4. `feat: add carried_over to PipelineItem and migrateOpenPipelineItems function`
5. `feat: migrate open pipeline items to new cycle on renewal`
6. `feat: migrate open pipeline items to new cycle on client reactivation`
7. `feat: include carried_over field in pipeline page queries`
8. `feat: show Traslado badge on carried-over pipeline cards`
