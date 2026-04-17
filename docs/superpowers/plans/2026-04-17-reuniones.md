# Reuniones — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-17-reuniones.md`
**Goal:** Agregar 'reunion' como tipo de consumo con límite por plan y sin fases de pipeline.
**Tech Stack:** Next.js 16, TypeScript, Supabase JS v2, Tailwind CSS 4.

---

## File Map

| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/0004_reuniones.sql` |
| Modificar | `src/types/db.ts` |
| Modificar | `src/lib/domain/plans.ts` |
| Modificar | `src/components/clients/ConsumptionModal.tsx` |

---

## Task 1: Migración SQL

**Files:** `supabase/migrations/0004_reuniones.sql`

- [ ] **Step 1: Crear el archivo**

```sql
-- ============================================================
-- FM CRM — Migration 0004: Tipo de consumo "reunion"
-- ============================================================

-- 1. Actualizar CHECK constraint en consumptions
ALTER TABLE public.consumptions
  DROP CONSTRAINT consumptions_content_type_check;

ALTER TABLE public.consumptions
  ADD CONSTRAINT consumptions_content_type_check
  CHECK (content_type IN (
    'historia', 'estatico', 'video_corto', 'reel',
    'short', 'produccion', 'reunion'
  ));

-- 2. Agregar reuniones a los tres planes existentes
UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 1, "reunion_duracion_horas": 1}'::jsonb
  WHERE name = 'Básico';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 1}'::jsonb
  WHERE name = 'Profesional';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 2}'::jsonb
  WHERE name = 'Premium';
```

- [ ] **Step 2: Aplicar en Supabase Dashboard**

SQL Editor → pegar y ejecutar. Verificar que `consumptions_content_type_check` acepta `'reunion'` y que los tres planes tienen los nuevos campos en `limits_json`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_reuniones.sql
git commit -m "feat: add reunion content type and update plan limits"
```

---

## Task 2: Actualizar tipos TypeScript

**Files:** `src/types/db.ts`

- [ ] **Step 1: Agregar 'reunion' a ContentType**

Localizar:
```typescript
export type ContentType =
  | 'historia'
  | 'estatico'
  | 'video_corto'
  | 'reel'
  | 'short'
  | 'produccion'
```

Reemplazar con:
```typescript
export type ContentType =
  | 'historia'
  | 'estatico'
  | 'video_corto'
  | 'reel'
  | 'short'
  | 'produccion'
  | 'reunion'
```

- [ ] **Step 2: Agregar campos a PlanLimits**

Localizar:
```typescript
export interface PlanLimits {
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
}
```

Reemplazar con:
```typescript
export interface PlanLimits {
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
  reuniones?: number              // opcional: ciclos anteriores a la migración no lo tienen
  reunion_duracion_horas?: number // opcional: ídem
}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```

Esperado: errores de tipo (los archivos que usan ContentType y PlanLimits aún no tienen 'reunion'). Esto es normal — se resolverán en los siguientes tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types/db.ts
git commit -m "feat: add reunion to ContentType and PlanLimits types"
```

---

## Task 3: Actualizar dominio plans.ts

**Files:** `src/lib/domain/plans.ts`

- [ ] **Step 1: Agregar label para reunion**

Localizar:
```typescript
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  historia: 'Historias',
  estatico: 'Estáticos',
  video_corto: 'Videos Cortos',
  reel: 'Video Largo',
  short: 'Shorts',
  produccion: 'Producciones',
}
```

Reemplazar con:
```typescript
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  historia: 'Historias',
  estatico: 'Estáticos',
  video_corto: 'Videos Cortos',
  reel: 'Video Largo',
  short: 'Shorts',
  produccion: 'Producciones',
  reunion: 'Reuniones',
}
```

- [ ] **Step 2: Agregar 'reunion' a CONTENT_TYPES**

Localizar:
```typescript
export const CONTENT_TYPES: ContentType[] = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
  'produccion',
]
```

Reemplazar con:
```typescript
export const CONTENT_TYPES: ContentType[] = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
  'produccion',
  'reunion',
]
```

- [ ] **Step 3: Agregar 'reunion' a limitsToRecord**

Localizar:
```typescript
export function limitsToRecord(limits: PlanLimits): Record<ContentType, number> {
  return {
    historia: limits.historias,
    estatico: limits.estaticos,
    video_corto: limits.videos_cortos,
    reel: limits.reels,
    short: limits.shorts,
    produccion: limits.producciones,
  }
}
```

Reemplazar con:
```typescript
export function limitsToRecord(limits: PlanLimits): Record<ContentType, number> {
  return {
    historia: limits.historias,
    estatico: limits.estaticos,
    video_corto: limits.videos_cortos,
    reel: limits.reels,
    short: limits.shorts,
    produccion: limits.producciones,
    reunion: limits.reuniones ?? 0,  // ?? 0: ciclos antiguos sin este campo devuelven 0
  }
}
```

- [ ] **Step 4: Agregar 'reunion' a effectiveLimits**

Localizar el bloque `roll` dentro de `effectiveLimits`:
```typescript
  const roll: Partial<Record<ContentType, number>> = {
    historia: rollover.historias ?? 0,
    estatico: rollover.estaticos ?? 0,
    video_corto: rollover.videos_cortos ?? 0,
    reel: rollover.reels ?? 0,
    short: rollover.shorts ?? 0,
    produccion: rollover.producciones ?? 0,
  }

  return {
    historia: base.historia + (roll.historia ?? 0),
    estatico: base.estatico + (roll.estatico ?? 0),
    video_corto: base.video_corto + (roll.video_corto ?? 0),
    reel: base.reel + (roll.reel ?? 0),
    short: base.short + (roll.short ?? 0),
    produccion: base.produccion + (roll.produccion ?? 0),
  }
```

Reemplazar con:
```typescript
  const roll: Partial<Record<ContentType, number>> = {
    historia: rollover.historias ?? 0,
    estatico: rollover.estaticos ?? 0,
    video_corto: rollover.videos_cortos ?? 0,
    reel: rollover.reels ?? 0,
    short: rollover.shorts ?? 0,
    produccion: rollover.producciones ?? 0,
    reunion: rollover.reuniones ?? 0,
  }

  return {
    historia: base.historia + (roll.historia ?? 0),
    estatico: base.estatico + (roll.estatico ?? 0),
    video_corto: base.video_corto + (roll.video_corto ?? 0),
    reel: base.reel + (roll.reel ?? 0),
    short: base.short + (roll.short ?? 0),
    produccion: base.produccion + (roll.produccion ?? 0),
    reunion: base.reunion + (roll.reunion ?? 0),
  }
```

- [ ] **Step 5: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```

Esperado: 1 error restante en ConsumptionModal (falta el icono de 'reunion' en CONTENT_ICONS). Se resuelve en Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain/plans.ts
git commit -m "feat: add reunion to content type labels, list, and limit functions"
```

---

## Task 4: Actualizar ConsumptionModal

**Files:** `src/components/clients/ConsumptionModal.tsx`

- [ ] **Step 1: Agregar icono para 'reunion'**

Localizar el bloque de `produccion` al final de `CONTENT_ICONS`:
```typescript
  produccion: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
    </svg>
  ),
}
```

Reemplazar con:
```typescript
  produccion: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
    </svg>
  ),
  reunion: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  ),
}
```

- [ ] **Step 2: Excluir 'reunion' del log inicial de pipeline**

Localizar:
```typescript
    // Crear log inicial del pipeline (solo tipos que tienen fases)
    if (selectedType !== 'produccion' && newConsumption?.id) {
```

Reemplazar con:
```typescript
    // Crear log inicial del pipeline (solo tipos que tienen fases; excluye produccion y reunion)
    if (selectedType !== 'produccion' && selectedType !== 'reunion' && newConsumption?.id) {
```

- [ ] **Step 3: Mostrar duración informativa cuando se selecciona 'reunion'**

Localizar el bloque de "Impact preview":
```typescript
          {/* Impact preview */}
          {selectedType && (
            <div className="bg-[#f5f7f9] rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-[#595c5e]">
                {CONTENT_TYPE_LABELS[selectedType]}
              </span>
              <span className="text-sm font-semibold text-[#2c2f31]">
                {totals[selectedType]} → <span className="text-[#00675c]">{totals[selectedType] + 1}</span>
                <span className="text-[#595c5e] font-normal"> /{limits[selectedType]}</span>
              </span>
            </div>
          )}
```

Reemplazar con:
```typescript
          {/* Impact preview */}
          {selectedType && (
            <div className="bg-[#f5f7f9] rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#595c5e]">
                  {CONTENT_TYPE_LABELS[selectedType]}
                </span>
                <span className="text-sm font-semibold text-[#2c2f31]">
                  {totals[selectedType]} → <span className="text-[#00675c]">{totals[selectedType] + 1}</span>
                  <span className="text-[#595c5e] font-normal"> /{limits[selectedType]}</span>
                </span>
              </div>
              {selectedType === 'reunion' && cycle.limits_snapshot_json.reunion_duracion_horas && (
                <p className="text-xs text-[#747779]">
                  Duración por reunión: <span className="font-semibold">{cycle.limits_snapshot_json.reunion_duracion_horas}h</span>
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Verificar tipos**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npx tsc --noEmit 2>&1
```

Esperado: 0 errores.

- [ ] **Step 5: Build final**

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm" && npm run build 2>&1 | tail -20
```

Esperado: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add src/components/clients/ConsumptionModal.tsx
git commit -m "feat: add reunion type to ConsumptionModal with icon and duration display"
```

---

## Verificación manual

- [ ] Abrir ficha de un cliente → modal de consumo muestra "Reuniones" con su ícono y cupo (ej. 0/1 en Básico)
- [ ] Registrar una reunión → aparece en consumos, no en el pipeline
- [ ] Al seleccionar "Reuniones" en el modal → aparece "Duración por reunión: Xh"
- [ ] Los planes en la página de renovación muestran el cupo de reuniones correctamente

## Resumen de commits

1. `feat: add reunion content type and update plan limits`
2. `feat: add reunion to ContentType and PlanLimits types`
3. `feat: add reunion to content type labels, list, and limit functions`
4. `feat: add reunion type to ConsumptionModal with icon and duration display`
