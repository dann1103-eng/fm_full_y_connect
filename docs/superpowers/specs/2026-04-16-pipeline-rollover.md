# Spec: Pipeline Rollover — Traslado automático de piezas al nuevo ciclo

**Fecha:** 2026-04-16
**Proyecto:** FM CRM — FM Communication Solutions
**Estado:** Aprobado por usuario

---

## Contexto

El pipeline de producción (Sub-Proyecto 2) muestra las piezas de contenido del ciclo activo. Al iniciar un nuevo ciclo, las piezas que no llegaron a "Publicado" en el ciclo anterior deben trasladarse automáticamente al nuevo ciclo, conservando su fase actual y su historial completo.

---

## Alcance

- Agregar campo `carried_over` a `consumptions` para identificar piezas trasladadas
- Al crear un nuevo ciclo (renovación o reactivación), migrar automáticamente las piezas abiertas del ciclo anterior
- Las piezas trasladadas **no descuentan** del límite del nuevo ciclo
- La historia completa de fases de la pieza se preserva en el nuevo ciclo
- Badge visual "Traslado" en las cards del pipeline para piezas trasladadas

---

## Modelo de Datos

### Migración `0003_pipeline_rollover.sql`

```sql
ALTER TABLE public.consumptions
  ADD COLUMN carried_over boolean NOT NULL DEFAULT false;
```

- `carried_over = true` → pieza trasladada de un ciclo anterior; se excluye del cómputo de límites
- `carried_over = false` → pieza normal (default)

---

## Reglas de negocio

| Regla | Detalle |
|-------|---------|
| Qué se traslada | `voided = false`, `phase != 'publicado'`, `content_type` en PIPELINE_CONTENT_TYPES (excluye `produccion`) |
| Cuándo ocurre | Al crear un nuevo ciclo vía `RenewalRow` (renovación) o `ReactivatePanel` (reactivación) |
| `ClientForm` (cliente nuevo) | No hay ciclo previo → no se ejecuta traslado |
| Conteo de límites | `computeTotals` excluye `carried_over = true` → no afecta el cupo del nuevo ciclo |
| Historial | Se copian todos los logs del consumo original al nuevo consumo (conservando timestamps), seguido de un log de migración |
| Log de migración | `from_phase = null`, `to_phase = fase_actual`, `notes = "Trasladado del ciclo anterior"` |
| Piezas ya publicadas | NO se trasladan (`phase = 'publicado'` queda en el ciclo anterior) |
| Piezas anuladas | NO se trasladan (`voided = true`) |

---

## Función de dominio: `migrateOpenPipelineItems`

Nueva función en `src/lib/domain/pipeline.ts`:

```typescript
async function migrateOpenPipelineItems(
  supabase: SupabaseClient<Database>,
  params: {
    previousCycleId: string
    newCycleId: string
    movedBy: string
  }
): Promise<void>
```

**Flujo interno:**
1. Fetch consumos del ciclo anterior: `billing_cycle_id = previousCycleId`, `voided = false`, `phase != 'publicado'`, `content_type` en `PIPELINE_CONTENT_TYPES`
2. Por cada consumo encontrado:
   a. Insertar nuevo consumo en `consumptions`: mismo `content_type` y `phase`, `billing_cycle_id = newCycleId`, `carried_over = true`, `registered_by_user_id = movedBy`, `over_limit = false`, `voided = false`
   b. Fetch todos los logs del consumo original (`consumption_phase_logs` ordenados por `created_at ASC`)
   c. Insertar copias de los logs apuntando al nuevo `consumption_id` (mismos `from_phase`, `to_phase`, `moved_by`, `notes`, `created_at`)
   d. Insertar log de migración: `from_phase = null`, `to_phase = fase_actual`, `moved_by = movedBy`, `notes = "Trasladado del ciclo anterior"`, `created_at = now()`
3. Si no hay consumos abiertos → no hace nada (no es error)

---

## Cambios en componentes existentes

### `RenewalRow.tsx`

En `handleRenew`, tras archivar el ciclo anterior:
1. Modificar el `.insert()` del nuevo ciclo para agregar `.select('id').single()` y capturar `newCycleId`
2. Obtener `currentUserId` via `supabase.auth.getUser()`
3. Llamar `migrateOpenPipelineItems(supabase, { previousCycleId: cycle.id, newCycleId, movedBy: currentUserId })`

### `ReactivatePanel.tsx`

En `handleReactivate`, **el orden secuencial es obligatorio** (ciclo primero, luego cliente) para evitar estado inconsistente:

1. Obtener `currentUserId` via `supabase.auth.getUser()`
2. Buscar el último ciclo archivado del cliente: `billing_cycles` donde `client_id = client.id`, `status = 'archived'`, ordenado por `period_end DESC`, `limit 1`
3. **Primero:** Insertar el nuevo ciclo con `.select('id').single()` para capturar `newCycleId` — si falla aquí, el cliente sigue `paused` (estado seguro)
4. **Después:** Actualizar el cliente a `status = 'active'` — si falla aquí, el cliente queda `paused` con un ciclo huérfano `current`, que se resuelve la próxima vez que se abre el panel
5. Si existe ciclo previo archivado: llamar `migrateOpenPipelineItems(supabase, { previousCycleId: prevCycle.id, newCycleId, movedBy: currentUserId })`

> Razón del orden: insertar ciclo antes de actualizar el cliente garantiza que un fallo en el insert deja el cliente en estado consistente (`paused`, sin ciclo `current`). Un fallo en la actualización del cliente es recuperable: el panel de reactivación simplemente vuelve a aparecer.

### `PipelineItem` (interface en `pipeline.ts`)

Agregar campo `carried_over: boolean`.

### Páginas de pipeline (`/pipeline/page.tsx` y `clients/[id]/page.tsx`)

Incluir `carried_over` en el `select()` de consumptions y mapearlo al `PipelineItem`.

### `PipelineCard.tsx`

Si `item.carried_over === true`, mostrar un badge pequeño "Traslado" debajo del badge de tipo de contenido.

---

## Tipos TypeScript

### `src/types/db.ts`

- `consumptions.Row`: agregar `carried_over: boolean`
- `consumptions.Insert`: agregar `carried_over?: boolean`
- `consumptions.Update`: agregar `carried_over?: boolean`
- `consumption_phase_logs.Insert`: agregar `created_at?: string` — necesario para copiar timestamps históricos durante la migración (sin este campo, Supabase siempre asigna `now()` y se pierde el orden cronológico original)

---

## Impacto en `computeTotals`

En `src/lib/domain/consumption.ts`, la condición de conteo cambia de:

```typescript
if (!c.voided) {
```

a:

```typescript
if (!c.voided && !c.carried_over) {
```

---

## Fuera de alcance

- UI para ver piezas trasladadas por ciclo histórico
- Notificación al equipo cuando se ejecuta el traslado
- Opción de cancelar el traslado de una pieza específica (el admin puede anular la pieza trasladada si no la quiere)
