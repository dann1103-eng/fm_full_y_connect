# Spec: Borrar cliente · Contador de cambios · Título de consumo · Edición en pipeline

**Fecha:** 2026-04-18  
**Rama:** desde `qa-reports-logo-upload` (o nueva desde `master`)

---

## Contexto

Tres mejoras de operación diaria en el CRM FM Communication Solutions:

1. Los admins necesitan poder eliminar clientes con todos sus datos.
2. Los operadores necesitan trackear cuántas revisiones/cambios pide el cliente por cada pieza de contenido.
3. Cada consumo registrado debe tener un título que lo identifique claramente.
4. Desde el pipeline, al hacer doble clic en una tarjeta, debe abrirse un panel con toda la información editable del consumo.

---

## 1. Base de datos — Migración `0008`

```sql
-- Título requerido por consumo (existentes quedan con string vacío)
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- Contador de cambios por consumo
ALTER TABLE public.consumptions
  ADD COLUMN IF NOT EXISTS cambios_count INTEGER NOT NULL DEFAULT 0;

-- Límite de cambios por defecto del cliente
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS max_cambios INTEGER NOT NULL DEFAULT 2;
```

**TypeScript (`src/types/db.ts`):**
- `consumptions.Row/Insert/Update`: añadir `title: string`, `cambios_count: number`
- `clients.Row`: añadir `max_cambios: number`
- `clients.Update`: añadir `max_cambios?: number`

---

## 2. Feature: Borrar cliente

### Dónde
Botón "Eliminar cliente" al fondo de `/clients/[id]`, visible solo para admins.

### Flujo
1. Admin hace clic → dialog de confirmación con nombre del cliente + aviso de irreversibilidad
2. Confirma → Server Action `deleteClient(clientId)` ejecuta borrado en cascada
3. Redirige a `/clients`

### Server Action (`src/app/actions/deleteClient.ts`)
Borrado secuencial para respetar FK constraints:
1. Obtener `cycleIds` donde `client_id = clientId`
2. Obtener `consumptionIds` donde `billing_cycle_id IN cycleIds`
3. `DELETE consumption_phase_logs` donde `consumption_id IN consumptionIds`
4. `DELETE consumptions` donde `billing_cycle_id IN cycleIds`
5. `DELETE billing_cycles` donde `client_id = clientId`
6. `DELETE clients` donde `id = clientId`

### Archivos
- **Nuevo:** `src/app/actions/deleteClient.ts`
- **Modificado:** `src/app/(app)/clients/[id]/page.tsx` (botón + dialog de confirmación)

---

## 3. Feature: Contador de cambios por consumo

### Configuración del límite
- Campo "Máx. cambios por consumo" en `/clients/[id]/edit` (número, default 2)
- Se guarda en `clients.max_cambios`

### Registro de cambios
- Botón `+1 cambio` en cada item del historial (`ConsumptionHistory`)
- Solo visible en consumos no anulados
- Al hacer clic: `UPDATE consumptions SET cambios_count = cambios_count + 1 WHERE id = ?` + router.refresh()
- No bloquea: si `cambios_count >= max_cambios`, el badge se pone rojo pero el botón sigue activo

### Display en historial
Badge `cambios: N/max` junto a los badges "Anulado" / "Excedente":
- Verde cuando `cambios_count < max_cambios`
- Rojo cuando `cambios_count >= max_cambios`

### Props nuevos en `ConsumptionHistory`
```ts
maxCambios: number  // viene de client.max_cambios
```

### Archivos
- **Modificado:** `src/components/clients/ConsumptionHistory.tsx`
- **Modificado:** `src/app/(app)/clients/[id]/edit/page.tsx`
- **Modificado:** `src/app/(app)/clients/[id]/page.tsx` (pasar `max_cambios` como prop)

---

## 4. Feature: Título de consumo

### Registro
- Campo "Título" **requerido** en `ConsumptionModal`, aparece tras seleccionar el tipo, antes de las notas
- Botón Confirmar deshabilitado si título vacío
- Se inserta con `title: title.trim()` en el payload

### Display en historial (`ConsumptionHistory`)
- Título como texto principal en negrita (reemplaza `TYPE_ACTION[type]`)
- Tipo de contenido pasa a texto secundario pequeño/gris
- Notas siguen apareciendo debajo si existen

### Display en pipeline (`PipelineCard`)
- Título como texto principal de la tarjeta
- `title` debe añadirse al SELECT de consumos en `pipeline/page.tsx` y en la query de `ClientPipelineTab`

### Archivos
- **Modificado:** `src/components/clients/ConsumptionModal.tsx`
- **Modificado:** `src/components/clients/ConsumptionHistory.tsx`
- **Modificado:** `src/components/pipeline/PipelineCard.tsx`
- **Modificado:** `src/app/(app)/pipeline/page.tsx` (añadir `title` al select)
- **Modificado:** `src/components/pipeline/ClientPipelineTab.tsx` (añadir `title` al select)

---

## 5. Feature: Edición de consumo desde el pipeline

### Interacciones
| Acción | Resultado |
|--------|-----------|
| Drag → soltar en otra columna | `MovePhaseModal` (notas de fase) — sin cambio |
| Doble clic en tarjeta | `PhaseSheet` — edición completa del consumo |
| Clic simple (en `ClientPipelineTab`, sin DnD) | `PhaseSheet` — ídem |

### `PhaseSheet` — nuevas props
```ts
title: string
consumptionNotes: string | null
cambiosCount: number
maxCambios: number
showMoveSection?: boolean  // default true; false en KanbanBoard
```

### Estructura del panel (cuerpo scrollable)
1. **Sección "Información del consumo"** (nueva, al tope):
   - Input "Título" (editable)
   - Textarea "Notas del consumo" (editable, distinto a notas de fase)
   - Badge de cambios `N/max` + botón `+1`
   - Botón "Guardar" → `UPDATE consumptions SET title=?, notes=? WHERE id=?` + refresh
2. **Sección "Historial de fases"** (existente, sin cambio)
3. **Sección "Mover a fase"** (solo si `showMoveSection=true`)

### Carga de logs on-demand (en `KanbanBoard`)
Al abrir el sheet con doble clic, se hace una query client-side:
```ts
supabase.from('consumption_phase_logs')
  .select('*')
  .eq('consumption_id', id)
  .order('created_at')
```

### Trigger de doble clic
- `PipelineCard` recibe prop `onDoubleClick?: () => void`
- `KanbanBoard` trackea `activeDetailId: string | null` y abre `PhaseSheet` correspondiente

### Archivos
- **Modificado:** `src/components/pipeline/PhaseSheet.tsx`
- **Modificado:** `src/components/pipeline/PipelineCard.tsx`
- **Modificado:** `src/components/pipeline/KanbanBoard.tsx`
- **Modificado:** `src/components/pipeline/ClientPipelineTab.tsx` (pasar nuevos props)

---

## Orden de implementación

1. Migración DB + actualizar `db.ts`
2. Borrar cliente (Server Action + UI)
3. Título en consumos (modal + historial + pipeline cards)
4. Contador de cambios (historial + edición de cliente)
5. `PhaseSheet` expandido (doble clic + edición inline)
6. `npm run lint && npm run build`

---

## Verificación

- Registrar consumo → título es requerido, aparece en historial y pipeline card
- Borrar cliente como admin → dialog → confirmación → redirige a lista, datos eliminados
- +1 cambio → badge actualiza, rojo al superar límite
- Cambiar `max_cambios` en edición de cliente → afecta nuevos badges
- Doble clic en tarjeta del pipeline → PhaseSheet con título, notas, cambios e historial de fases
- DnD sigue funcionando independientemente del doble clic
- `npm run lint` 0 errores · `npm run build` limpio
