# Spec: Sub-Proyecto 2 — Pipeline de Producción

**Fecha:** 2026-04-16  
**Proyecto:** FM CRM — FM Communication Solutions  
**Estado:** Aprobado por usuario

---

## Contexto

El CRM ya registra consumos de contenido que descuentan del plan mensual de cada cliente (Sub-Proyecto 1). El Sub-Proyecto 2 extiende ese modelo con un pipeline de producción: cada pieza de contenido tiene un ciclo de vida desde que se registra hasta que se publica.

---

## Alcance

- Agregar fases de producción a los consumos existentes (excepto tipo `produccion`)
- Vista global tipo kanban con todas las piezas activas de todos los clientes
- Vista por cliente (tab en detalle del cliente) con piezas del ciclo activo
- Registro de historial de movimientos de fase con notas opcionales

---

## Modelo de Datos

### Cambio a `consumptions`

```sql
ALTER TABLE public.consumptions
  ADD COLUMN phase text NOT NULL DEFAULT 'pendiente'
    CHECK (phase IN (
      'pendiente',
      'en_produccion',
      'revision_interna',
      'revision_cliente',
      'aprobado',
      'publicado'
    ));
```

- Las filas con `content_type = 'produccion'` mantienen `phase = 'pendiente'` permanentemente. Su fase **no puede ser modificada** — ver Reglas.
- El DEFAULT asegura que todo consumo nuevo entra en `pendiente` sin lógica adicional en el cliente.

### Nueva tabla `consumption_phase_logs`

```sql
CREATE TABLE public.consumption_phase_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumption_id  uuid NOT NULL REFERENCES public.consumptions(id) ON DELETE CASCADE,
  from_phase      text,              -- NULL en la entrada de creación
  to_phase        text NOT NULL,
  moved_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX phase_logs_consumption_id_idx ON public.consumption_phase_logs(consumption_id);
```

**Notas de esquema:**
- `moved_by` es nullable con `ON DELETE SET NULL`: si un usuario es eliminado del sistema, los logs existentes se conservan con `moved_by = NULL` en lugar de bloquear la eliminación.
- **Los logs son inmutables**: no se permiten UPDATE ni DELETE sobre esta tabla (ni por aplicación ni por RLS).
- El primer log se crea al registrar el consumo: `from_phase = NULL`, `to_phase = 'pendiente'`.

### RLS para `consumption_phase_logs`

```sql
ALTER TABLE public.consumption_phase_logs ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario de la agencia puede leer todos los logs
CREATE POLICY "Agency users can view phase logs"
  ON public.consumption_phase_logs FOR SELECT
  USING (public.is_agency_user());

-- Cualquier usuario de la agencia puede insertar logs
CREATE POLICY "Agency users can insert phase logs"
  ON public.consumption_phase_logs FOR INSERT
  WITH CHECK (public.is_agency_user());

-- No se crean políticas de UPDATE ni DELETE: los logs son inmutables
```

---

## Fases y Reglas

### Secuencia normal (no obligatoria)

```
pendiente → en_produccion → revision_interna → revision_cliente → aprobado → publicado
```

### Reglas

| Regla | Detalle |
|-------|---------|
| Tipos excluidos | `content_type = 'produccion'` no entra al pipeline. Su `phase` permanece en `pendiente` indefinidamente y se excluye de todas las vistas de pipeline. |
| Guard en `movePhase` | La server action valida que `content_type != 'produccion'` antes de ejecutar el UPDATE. Si se intenta mover un item de tipo `produccion`, retorna error. |
| Movimiento libre | Cualquier usuario (Admin u Operator) puede mover a cualquier fase, incluyendo retroceder |
| Consumo anulado | `voided = true` → la pieza desaparece del kanban; logs se conservan |
| Ciclo archivado | Piezas del ciclo se filtran de la vista activa pero siguen accesibles en el historial del cliente |
| "Publicado" | No es estado final bloqueado — se puede retroceder si fue un error |
| Notas | Opcionales en cada movimiento de fase |
| Logs inmutables | Los registros en `consumption_phase_logs` nunca se modifican ni eliminan (excepto cascade al borrar el consumo padre) |

---

## Server Actions

### `registerConsumption` (extensión)

Ya existe. Se extiende para crear el primer `consumption_phase_log` al confirmar el registro:

```ts
// después de insertar en consumptions:
await insertPhaseLog({
  consumption_id: newConsumption.id,
  from_phase: null,
  to_phase: 'pendiente',
  moved_by: currentUser.id,
  notes: null,
});
```

### `movePhase(consumptionId, toPhase, notes?)`

1. Obtiene el consumo por `consumptionId`
2. Valida que `content_type !== 'produccion'` — si es producción, retorna error
3. Valida que `toPhase` es un valor válido del enum de fases
4. Actualiza `consumptions.phase = toPhase`
5. Inserta un registro en `consumption_phase_logs` con `from_phase = phase anterior`, `to_phase`, `moved_by = currentUser.id`, `notes`

### `getPipelineByClient(clientId)`

- Filtra: ciclo activo del cliente + `content_type != 'produccion'` + `voided = false`
- Join: `consumptions → billing_cycles → clients`
- Incluye el último log (último `created_at` de `consumption_phase_logs`) para mostrar "última actualización"
- Retorna forma plana:

```ts
type PipelineItem = {
  id: string;
  content_type: string;
  phase: string;
  billing_cycle_id: string;
  client_id: string;
  client_name: string;
  client_logo_url: string | null;
  last_moved_at: string; // MAX(phase_logs.created_at)
  registered_at: string;
};
```

### `getGlobalPipeline(filters?: { clientId?: string })`

- Filtra: todos los ciclos activos + `content_type != 'produccion'` + `voided = false`
- Filtro opcional por `clientId`
- **Límite de filas: 200** (suficiente para la operación actual de la agencia; se revisará si el volumen crece)
- Join: `consumptions → billing_cycles → clients`
- Incluye el último log para "última actualización"
- Retorna la misma forma `PipelineItem[]` que `getPipelineByClient`

---

## Tipos TypeScript

Se debe actualizar `src/types/db.ts` como parte de la implementación:

1. Agregar campo `phase: string` a `Consumption['Row']` (o al tipo equivalente del tipo `consumptions`)
2. Agregar bloque de tipos para la tabla `consumption_phase_logs`:

```ts
consumption_phase_logs: {
  Row: {
    id: string;
    consumption_id: string;
    from_phase: string | null;
    to_phase: string;
    moved_by: string | null;
    notes: string | null;
    created_at: string;
  };
  Insert: { ... };
  // No existe Update (tabla inmutable)
};
```

---

## UI

### Vista global — `/pipeline`

- Nueva ruta `(app)/pipeline/page.tsx`
- Layout: kanban horizontal con 6 columnas (una por fase)
- Card muestra: logo + nombre del cliente, tipo de contenido (badge), fecha de `last_moved_at`
- Filtro por cliente en la parte superior
- Los ítems de tipo `produccion` no aparecen

### Vista por cliente — Tab en `/clients/[id]`

- Nuevo tab "Pipeline" en la página de detalle del cliente
- Lista de piezas del ciclo activo agrupadas por fase
- Formato lista (no kanban) por espacio disponible

### Sheet de detalle/movimiento

- Al hacer clic en una card o pieza se abre un `Sheet` lateral (shadcn/ui)
- Contenido:
  - Timeline del historial de fases (logs ordenados por `created_at` ASC)
  - Selector de nueva fase (dropdown con las 6 fases)
  - Campo de notas (textarea, opcional)
  - Botón "Mover"

### "Fecha del último movimiento"

- Fuente: `MAX(consumption_phase_logs.created_at)` para esa pieza
- Se obtiene en la query de `getPipelineByClient` / `getGlobalPipeline` mediante subquery o join a logs
- Se muestra en la card del kanban como "Última actualización: hace X días"

### Flujo de registro

- El operador usa "Registrar consumo" exactamente igual que antes
- Al confirmar, el sistema crea el consumo + primer log en background
- No hay cambio visible en el formulario de registro

---

## Fuera de Alcance (este sub-proyecto)

- Notificaciones al cliente al llegar a "Revisión del cliente" (Sub-Proyecto 3)
- Portal del cliente para ver el pipeline (Sub-Proyecto 4)
- Bloqueo automático de fases por rol
- Fechas de entrega o deadlines por pieza
- Paginación avanzada del kanban global (límite fijo de 200 ítems por ahora)
