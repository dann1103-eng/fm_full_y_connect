# Spec: Reuniones — Nuevo tipo de consumo

**Fecha:** 2026-04-17
**Proyecto:** FM CRM — FM Communication Solutions
**Estado:** Aprobado por usuario

---

## Contexto

Los planes de FM incluyen un cupo mensual de reuniones con duración fija por plan. Las reuniones no pasan por el pipeline de fases (se registran y se cuentan como unidades consumidas, igual que 'produccion'). La duración por reunión varía según el plan contratado.

---

## Alcance

- Agregar el tipo de contenido `'reunion'` al sistema
- Actualizar el CHECK constraint de `consumptions.content_type`
- Actualizar los tres planes con cupo de reuniones y duración
- Actualizar tipos TypeScript, dominio y UI para incluir reuniones
- La duración por reunión es informativa (no se rastrea por consumo) — se almacena en `limits_json` del plan

---

## Reglas de negocio

| Plan | Reuniones/mes | Duración por reunión |
|------|--------------|----------------------|
| Básico | 1 | 1 hora |
| Profesional | 2 | 1 hora |
| Premium | 2 | 2 horas |

- Las reuniones **no tienen fases de pipeline** (igual que 'produccion')
- Se registran, se cuentan contra el límite mensual, y pueden anularse
- El pipeline rollover **no aplica** a reuniones (excluidas de `PIPELINE_CONTENT_TYPES`)
- La duración por reunión se almacena como `reunion_duracion_horas` en `limits_json`

---

## Modelo de datos

### Migración `0004_reuniones.sql`

```sql
-- 1. Actualizar CHECK constraint en consumptions
ALTER TABLE public.consumptions
  DROP CONSTRAINT consumptions_content_type_check;

ALTER TABLE public.consumptions
  ADD CONSTRAINT consumptions_content_type_check
  CHECK (content_type IN (
    'historia', 'estatico', 'video_corto', 'reel',
    'short', 'produccion', 'reunion'
  ));

-- 2. Agregar reuniones a los tres planes
UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 1, "reunion_duracion_horas": 1}'
  WHERE name = 'Básico';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 1}'
  WHERE name = 'Profesional';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 2}'
  WHERE name = 'Premium';
```

---

## Tipos TypeScript

### `src/types/db.ts`

`ContentType` — agregar `'reunion'`:
```typescript
export type ContentType =
  | 'historia' | 'estatico' | 'video_corto'
  | 'reel' | 'short' | 'produccion' | 'reunion'
```

`PlanLimits` — agregar dos campos:
```typescript
reuniones: number
reunion_duracion_horas: number
```

---

## Cambios en dominio

### `src/lib/domain/plans.ts`

- `CONTENT_TYPE_LABELS`: agregar `reunion: 'Reuniones'`
- `CONTENT_TYPES`: agregar `'reunion'` al final de la lista
- `limitsToRecord`: agregar `reunion: limits.reuniones`
- `effectiveLimits`: agregar `reunion` en el cómputo (rollover base)

### `src/lib/domain/pipeline.ts`

- `PIPELINE_CONTENT_TYPES`: ya excluye 'produccion'; mantener 'reunion' también excluida (sin cambio si se filtra por `!= 'produccion'` — pero la lista es explícita, así que agregar verificación)

### `src/components/clients/ConsumptionModal.tsx`

- Al seleccionar tipo `'reunion'`, **no** llamar `insertInitialPhaseLog` (mismo comportamiento que 'produccion')
- El modal muestra la duración de reunión informativa: `"Cada reunión: Xh"` — obtenida de `cycle.limits_snapshot_json.reunion_duracion_horas`

---

## Fuera de alcance

- Rastrear duración real de cada reunión por consumo
- Calendario de reuniones
- Notificaciones de reuniones agendadas
