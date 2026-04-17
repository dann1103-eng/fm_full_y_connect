# Pipeline de Producción — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un pipeline de fases (Pendiente → En Producción → Revisión Interna → Revisión Cliente → Aprobado → Publicado) a cada consumo de contenido, con vista global tipo kanban y tab por cliente.

**Architecture:** La columna `phase` se agrega directamente a `consumptions`. Una tabla nueva `consumption_phase_logs` guarda cada transición. Las páginas del pipeline son Server Components que leen datos vía Supabase; las mutaciones (mover fase) ocurren en el cliente con `createClient()` seguido de `router.refresh()`, igual que `ConsumptionModal`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS 4, shadcn/ui, Supabase JS v2, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-16-pipeline-produccion-design.md`

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|----------------|
| Crear | `supabase/migrations/0002_pipeline.sql` | Columna `phase` + tabla `consumption_phase_logs` + RLS |
| Modificar | `src/types/db.ts` | Tipos `Phase`, `ConsumptionPhaseLogs`, actualizar `Consumption` |
| Crear | `src/lib/domain/pipeline.ts` | Constantes de fases, tipo `PipelineItem`, helper `movePhase()` |
| Crear | `src/components/ui/sheet.tsx` | shadcn Sheet (componente UI base) |
| Modificar | `src/components/clients/ConsumptionModal.tsx` | Insertar primer phase log tras registrar consumo |
| Crear | `src/components/pipeline/PhaseSheet.tsx` | Sheet lateral: timeline de fases + selector + botón mover |
| Crear | `src/components/pipeline/PipelineCard.tsx` | Card individual para el kanban |
| Crear | `src/components/pipeline/KanbanColumn.tsx` | Columna del kanban con su lista de cards |
| Crear | `src/app/(app)/pipeline/page.tsx` | Página global kanban (Server Component) |
| Modificar | `src/app/(app)/clients/[id]/page.tsx` | Agregar tab "Pipeline" + fetching de pipeline items |
| Modificar | `src/components/layout/Sidebar.tsx` | Agregar enlace "Pipeline" en navegación |

---

## Task 1: Migración de base de datos

**Files:**
- Create: `supabase/migrations/0002_pipeline.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- ============================================================
-- FM CRM — Migration 0002: Pipeline de producción
-- ============================================================

-- ── Columna phase en consumptions ────────────────────────────
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

-- ── consumption_phase_logs ───────────────────────────────────
CREATE TABLE public.consumption_phase_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumption_id  uuid NOT NULL REFERENCES public.consumptions(id) ON DELETE CASCADE,
  from_phase      text,
  to_phase        text NOT NULL,
  moved_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX phase_logs_consumption_id_idx
  ON public.consumption_phase_logs(consumption_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.consumption_phase_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency users can view phase logs"
  ON public.consumption_phase_logs FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can insert phase logs"
  ON public.consumption_phase_logs FOR INSERT
  WITH CHECK (public.is_agency_user());

-- No UPDATE / DELETE: logs son inmutables
```

- [ ] **Step 2: Aplicar la migración en Supabase**

Ve al Dashboard de Supabase → SQL Editor → pega el contenido del archivo y ejecuta.

Verificación: en Table Editor deben aparecer la columna `phase` en `consumptions` y la nueva tabla `consumption_phase_logs`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_pipeline.sql
git commit -m "feat: add phase column to consumptions and consumption_phase_logs table"
```

---

## Task 2: Actualizar tipos TypeScript

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 1: Agregar el tipo `Phase` junto a los otros tipos de dominio al inicio del archivo**

```typescript
export type Phase =
  | 'pendiente'
  | 'en_produccion'
  | 'revision_interna'
  | 'revision_cliente'
  | 'aprobado'
  | 'publicado'
```

- [ ] **Step 2: Agregar `phase` al Row de `consumptions` (dentro de `Database['public']['Tables']['consumptions']`)**

En `Row`, después de `over_limit: boolean`, agregar:
```typescript
phase: Phase
```

En `Insert`, después de `over_limit?: boolean`, agregar:
```typescript
phase?: Phase
```

En `Update`, después de `over_limit?: boolean`, agregar:
```typescript
phase?: Phase
```

- [ ] **Step 3: Agregar la tabla `consumption_phase_logs` dentro de `Database['public']['Tables']`**

Agregar después del bloque `consumptions`:
```typescript
consumption_phase_logs: {
  Row: {
    id: string
    consumption_id: string
    from_phase: Phase | null
    to_phase: Phase
    moved_by: string | null
    notes: string | null
    created_at: string
  }
  Insert: {
    id?: string
    consumption_id: string
    from_phase?: Phase | null
    to_phase: Phase
    moved_by?: string | null
    notes?: string | null
  }
  Update: Record<string, never>  // tabla inmutable — no se permiten updates
  Relationships: [
    {
      foreignKeyName: 'phase_logs_consumption_id_fkey'
      columns: ['consumption_id']
      isOneToOne: false
      referencedRelation: 'consumptions'
      referencedColumns: ['id']
    }
  ]
}
```

- [ ] **Step 4: Agregar el alias `ConsumptionPhaseLog` en la sección de derived types al final del archivo**

```typescript
export type ConsumptionPhaseLog = Database['public']['Tables']['consumption_phase_logs']['Row']
```

- [ ] **Step 5: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

Esperado: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts
git commit -m "feat: add Phase type and consumption_phase_logs types to db.ts"
```

---

## Task 3: Lógica de dominio del pipeline

**Files:**
- Create: `src/lib/domain/pipeline.ts`

- [ ] **Step 1: Crear el archivo con constantes, tipo `PipelineItem` y helper `movePhase`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Phase, ContentType, Database } from '@/types/db'

/** Tipos de contenido que participan en el pipeline (excluye produccion) */
export const PIPELINE_CONTENT_TYPES: ContentType[] = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
]

/** Fases en orden de flujo normal */
export const PHASES: Phase[] = [
  'pendiente',
  'en_produccion',
  'revision_interna',
  'revision_cliente',
  'aprobado',
  'publicado',
]

export const PHASE_LABELS: Record<Phase, string> = {
  pendiente: 'Pendiente',
  en_produccion: 'En Producción',
  revision_interna: 'Revisión Interna',
  revision_cliente: 'Revisión Cliente',
  aprobado: 'Aprobado',
  publicado: 'Publicado',
}

/** Shape plana que usan las vistas de pipeline */
export interface PipelineItem {
  id: string
  content_type: ContentType
  phase: Phase
  billing_cycle_id: string
  client_id: string
  client_name: string
  client_logo_url: string | null
  last_moved_at: string
  registered_at: string
  notes: string | null
}

/**
 * Mueve una pieza a una nueva fase.
 * - Valida que no sea tipo 'produccion'.
 * - Actualiza consumptions.phase.
 * - Inserta un log con from_phase, to_phase, moved_by, notes.
 * Retorna { error } si algo falla.
 */
export async function movePhase(
  supabase: SupabaseClient<Database>,
  params: {
    consumptionId: string
    currentPhase: Phase
    contentType: ContentType
    toPhase: Phase
    movedBy: string
    notes?: string
  }
): Promise<{ error: string | null }> {
  const { consumptionId, currentPhase, contentType, toPhase, movedBy, notes } = params

  if (contentType === 'produccion') {
    return { error: 'Las producciones no tienen pipeline de fases.' }
  }

  if (!PHASES.includes(toPhase)) {
    return { error: 'Fase no válida.' }
  }

  const { error: updateError } = await supabase
    .from('consumptions')
    .update({ phase: toPhase })
    .eq('id', consumptionId)

  if (updateError) return { error: updateError.message }

  const { error: logError } = await supabase
    .from('consumption_phase_logs')
    .insert({
      consumption_id: consumptionId,
      from_phase: currentPhase,
      to_phase: toPhase,
      moved_by: movedBy,
      notes: notes?.trim() || null,
    })

  if (logError) return { error: logError.message }

  return { error: null }
}

/**
 * Inserta el log inicial (from_phase = null, to_phase = 'pendiente').
 * Llamado inmediatamente después de insertar un consumo nuevo.
 */
export async function insertInitialPhaseLog(
  supabase: SupabaseClient<Database>,
  params: { consumptionId: string; movedBy: string }
): Promise<void> {
  await supabase.from('consumption_phase_logs').insert({
    consumption_id: params.consumptionId,
    from_phase: null,
    to_phase: 'pendiente',
    moved_by: params.movedBy,
  })
}
```

- [ ] **Step 2: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

Esperado: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/domain/pipeline.ts
git commit -m "feat: add pipeline domain logic (movePhase, insertInitialPhaseLog, PipelineItem)"
```

---

## Task 4: Agregar componente Sheet de shadcn/ui

**Files:**
- Create: `src/components/ui/sheet.tsx`

- [ ] **Step 1: Instalar el componente via CLI**

```bash
cd "fm-crm" && npx shadcn@latest add sheet
```

Esperado: crea `src/components/ui/sheet.tsx` automáticamente.

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls "fm-crm/src/components/ui/sheet.tsx"
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/sheet.tsx
git commit -m "feat: add Sheet UI component (shadcn)"
```

---

## Task 5: Extender ConsumptionModal para crear el primer phase log

**Files:**
- Modify: `src/components/clients/ConsumptionModal.tsx`

El modal actualmente inserta en `consumptions` y luego llama `router.refresh()`. Hay que agregar `insertInitialPhaseLog` justo después de la inserción exitosa, pero **solo si `content_type !== 'produccion'`**.

- [ ] **Step 1: Agregar el import de `insertInitialPhaseLog`**

Al inicio del archivo, después de los imports existentes, agregar:
```typescript
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
```

- [ ] **Step 2: Insertar el log inicial después del insert exitoso**

Localizar el bloque en `handleSubmit` donde se hace `supabase.from('consumptions').insert(...)`. Después del bloque `if (insertError) { ... }` agregar:

```typescript
// Crear log inicial del pipeline (solo tipos que tienen fases)
if (selectedType !== 'produccion') {
  const newConsumption = data as { id: string } | null
  if (newConsumption?.id) {
    await insertInitialPhaseLog(supabase, {
      consumptionId: newConsumption.id,
      movedBy: user.id,
    })
  }
}
```

**Nota:** El insert actual usa `.insert({...})` sin `.select()`. Cambia la línea de insert para retornar el id:

```typescript
const { data, error: insertError } = await supabase
  .from('consumptions')
  .insert({
    billing_cycle_id: cycle.id,
    content_type: selectedType,
    registered_by_user_id: user.id,
    notes: notes.trim() || null,
    voided: false,
    over_limit: !allowed,
  })
  .select('id')
  .single()
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 4: Probar manualmente**

1. `npm run dev`
2. Ir a cualquier cliente con ciclo activo
3. Registrar un consumo (no producción)
4. En Supabase Table Editor → `consumption_phase_logs`: debe aparecer una fila con `from_phase = null`, `to_phase = 'pendiente'`
5. Registrar una producción: **no** debe crear log

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/ConsumptionModal.tsx
git commit -m "feat: insert initial phase log when registering a consumption"
```

---

## Task 6: Componente PhaseSheet (slide-over de detalle y movimiento)

**Files:**
- Create: `src/components/pipeline/PhaseSheet.tsx`

- [ ] **Step 1: Crear la carpeta y el archivo**

```bash
mkdir -p "fm-crm/src/components/pipeline"
```

- [ ] **Step 2: Crear `PhaseSheet.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import {
  PHASES,
  PHASE_LABELS,
  movePhase,
} from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType, ConsumptionPhaseLog } from '@/types/db'

interface PhaseSheetProps {
  open: boolean
  onClose: () => void
  consumptionId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  logs: ConsumptionPhaseLog[]
  currentUserId: string
}

export function PhaseSheet({
  open,
  onClose,
  consumptionId,
  contentType,
  currentPhase,
  clientName,
  logs,
  currentUserId,
}: PhaseSheetProps) {
  const router = useRouter()
  const [toPhase, setToPhase] = useState<Phase>(currentPhase)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMove() {
    if (toPhase === currentPhase) {
      setError('Selecciona una fase diferente a la actual.')
      return
    }
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: moveError } = await movePhase(supabase, {
      consumptionId,
      currentPhase,
      contentType,
      toPhase,
      movedBy: currentUserId,
      notes,
    })

    setLoading(false)

    if (moveError) {
      setError(moveError)
      return
    }

    setNotes('')
    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[#2c2f31]">
            {CONTENT_TYPE_LABELS[contentType]}
          </SheetTitle>
          <p className="text-sm text-[#595c5e]">{clientName}</p>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wide mb-3">
              Historial
            </p>
            <ol className="relative border-l border-[#dfe3e6] space-y-4 ml-2">
              {logs.map((log) => (
                <li key={log.id} className="ml-4">
                  <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-[#00675c]" />
                  <p className="text-xs text-[#747779]">
                    {new Date(log.created_at).toLocaleDateString('es-SV', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-sm font-medium text-[#2c2f31]">
                    {log.from_phase
                      ? `${PHASE_LABELS[log.from_phase as Phase]} → ${PHASE_LABELS[log.to_phase as Phase]}`
                      : `Creado en ${PHASE_LABELS[log.to_phase as Phase]}`}
                  </p>
                  {log.notes && (
                    <p className="text-xs text-[#595c5e] mt-0.5">{log.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Mover de fase */}
          <div className="space-y-3 border-t border-[#dfe3e6] pt-5">
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wide">
              Mover a fase
            </p>

            <div>
              <Label className="text-sm text-[#2c2f31] mb-1.5 block">Nueva fase</Label>
              <Select value={toPhase} onValueChange={(v) => setToPhase(v as Phase)}>
                <SelectTrigger className="rounded-xl border-[#dfe3e6]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHASES.map((phase) => (
                    <SelectItem key={phase} value={phase}>
                      {PHASE_LABELS[phase]}
                      {phase === currentPhase ? ' (actual)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="phase-notes" className="text-sm text-[#2c2f31] mb-1.5 block">
                Notas <span className="text-[#747779] font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="phase-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. cliente pidió cambiar el copy..."
                className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl"
                rows={3}
              />
            </div>

            {error && (
              <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl border-[#dfe3e6] text-[#595c5e]"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleMove}
                disabled={loading || toPhase === currentPhase}
                className="flex-1 rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading ? 'Moviendo...' : 'Mover'}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/PhaseSheet.tsx
git commit -m "feat: add PhaseSheet component for phase history and movement"
```

---

## Task 7: Componentes PipelineCard y KanbanColumn

**Files:**
- Create: `src/components/pipeline/PipelineCard.tsx`
- Create: `src/components/pipeline/KanbanColumn.tsx`

- [ ] **Step 1: Crear `PipelineCard.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { PhaseSheet } from './PhaseSheet'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { ConsumptionPhaseLog, Phase } from '@/types/db'

const CONTENT_TYPE_COLORS: Record<string, string> = {
  historia: 'bg-purple-100 text-purple-700',
  estatico: 'bg-blue-100 text-blue-700',
  video_corto: 'bg-orange-100 text-orange-700',
  reel: 'bg-pink-100 text-pink-700',
  short: 'bg-yellow-100 text-yellow-700',
}

interface PipelineCardProps {
  item: PipelineItem
  logs: ConsumptionPhaseLog[]
  currentUserId: string
  /** Si true, muestra el nombre del cliente en la card (vista global) */
  showClient?: boolean
}

export function PipelineCard({ item, logs, currentUserId, showClient = true }: PipelineCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const relativeDate = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (diff === 0) return 'hoy'
    if (diff === 1) return 'hace 1 día'
    return `hace ${diff} días`
  }

  return (
    <>
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full text-left bg-white rounded-2xl border border-[#dfe3e6] p-3 shadow-sm hover:shadow-md hover:border-[#00675c]/30 transition-all"
      >
        {showClient && (
          <div className="flex items-center gap-2 mb-2">
            {item.client_logo_url ? (
              <img
                src={item.client_logo_url}
                alt={item.client_name}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-[#00675c]/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-[#00675c]">
                  {item.client_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <span className="text-xs font-medium text-[#2c2f31] truncate">
              {item.client_name}
            </span>
          </div>
        )}

        <span
          className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${
            CONTENT_TYPE_COLORS[item.content_type] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {CONTENT_TYPE_LABELS[item.content_type]}
        </span>

        {item.notes && (
          <p className="text-xs text-[#595c5e] line-clamp-2 mb-2">{item.notes}</p>
        )}

        <p className="text-xs text-[#abadaf]">
          {relativeDate(item.last_moved_at)}
        </p>
      </button>

      <PhaseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        consumptionId={item.id}
        contentType={item.content_type}
        currentPhase={item.phase as Phase}
        clientName={item.client_name}
        logs={logs}
        currentUserId={currentUserId}
      />
    </>
  )
}
```

- [ ] **Step 2: Crear `KanbanColumn.tsx`**

```typescript
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import { PipelineCard } from './PipelineCard'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface KanbanColumnProps {
  phase: Phase
  items: PipelineItem[]
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
}

export function KanbanColumn({ phase, items, logsMap, currentUserId }: KanbanColumnProps) {
  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#2c2f31]">{PHASE_LABELS[phase]}</h3>
        {items.length > 0 && (
          <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      <div className="flex-1 bg-[#f5f7f9] rounded-2xl p-2 space-y-2 min-h-[120px]">
        {items.length === 0 ? (
          <p className="text-xs text-[#abadaf] text-center py-4">Sin piezas</p>
        ) : (
          items.map((item) => (
            <PipelineCard
              key={item.id}
              item={item}
              logs={logsMap[item.id] ?? []}
              currentUserId={currentUserId}
              showClient
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/PipelineCard.tsx src/components/pipeline/KanbanColumn.tsx
git commit -m "feat: add PipelineCard and KanbanColumn components"
```

---

## Task 8: Página global del pipeline `/pipeline`

**Files:**
- Create: `src/app/(app)/pipeline/page.tsx`

Esta página es un Server Component. Hace 3 queries:
1. Todas las piezas del pipeline (consumptions activos, no voided, no produccion, ciclo current)
2. Todos los logs de esas piezas
3. Usuario actual (para pasar `currentUserId` a los componentes cliente)

- [ ] **Step 1: Crear `src/app/(app)/pipeline/page.tsx`**

La query se hace en tres pasos separados (patrón del proyecto: no se usa `.eq()` cross-table):
1. Obtener IDs de ciclos actuales (opcionalmente filtrados por cliente)
2. Obtener consumos de esos ciclos
3. Obtener info de clientes para armar `PipelineItem`

También se lee `searchParams.clientId` para el filtro por cliente (URL param: `/pipeline?clientId=xxx`).

```typescript
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { KanbanColumn } from '@/components/pipeline/KanbanColumn'
import { PHASES, PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog, Client } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const { clientId } = await searchParams
  const supabase = await createClient()

  // Usuario actual
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  // 1. Ciclos activos (current), opcionalmente filtrados por cliente
  let cyclesQuery = supabase
    .from('billing_cycles')
    .select('id, client_id')
    .eq('status', 'current')

  if (clientId) cyclesQuery = cyclesQuery.eq('client_id', clientId)

  const { data: currentCycles } = await cyclesQuery
  const currentCycleIds = (currentCycles ?? []).map((c) => c.id)

  // 2. Consumos de esos ciclos (no voided, no produccion)
  const items: PipelineItem[] = []
  const logsMap: Record<string, ConsumptionPhaseLog[]> = {}

  if (currentCycleIds.length > 0) {
    const { data: consumptionsRaw } = await supabase
      .from('consumptions')
      .select('id, content_type, phase, billing_cycle_id, registered_at, notes')
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
      .in('billing_cycle_id', currentCycleIds)
      .order('registered_at', { ascending: false })
      .limit(200)

    // 3. Info de clientes (mapa cycle_id → client_id, luego clientes)
    const cycleClientMap: Record<string, string> = {}
    for (const c of currentCycles ?? []) cycleClientMap[c.id] = c.client_id

    const uniqueClientIds = [...new Set(Object.values(cycleClientMap))]
    const { data: clientsRaw } = await supabase
      .from('clients')
      .select('id, name, logo_url')
      .in('id', uniqueClientIds)

    const clientMap: Record<string, Pick<Client, 'id' | 'name' | 'logo_url'>> = {}
    for (const cl of clientsRaw ?? []) clientMap[cl.id] = cl

    // Armar PipelineItem
    for (const c of consumptionsRaw ?? []) {
      const clientId = cycleClientMap[c.billing_cycle_id]
      const cl = clientMap[clientId]
      if (!cl) continue

      items.push({
        id: c.id,
        content_type: c.content_type,
        phase: c.phase,
        billing_cycle_id: c.billing_cycle_id,
        client_id: cl.id,
        client_name: cl.name,
        client_logo_url: cl.logo_url,
        last_moved_at: c.registered_at,
        registered_at: c.registered_at,
        notes: c.notes,
      })
    }

    // Logs de todas las piezas
    if (items.length > 0) {
      const { data: logsRaw } = await supabase
        .from('consumption_phase_logs')
        .select('*')
        .in('consumption_id', items.map((i) => i.id))
        .order('created_at', { ascending: true })

      for (const log of logsRaw ?? []) {
        if (!logsMap[log.consumption_id]) logsMap[log.consumption_id] = []
        logsMap[log.consumption_id].push(log as ConsumptionPhaseLog)
      }

      // Actualizar last_moved_at con el máximo del log
      for (const item of items) {
        const itemLogs = logsMap[item.id] ?? []
        if (itemLogs.length > 0) {
          item.last_moved_at = itemLogs[itemLogs.length - 1].created_at
        }
      }
    }
  }

  // Agrupar por fase
  const byPhase: Record<Phase, PipelineItem[]> = {
    pendiente: [],
    en_produccion: [],
    revision_interna: [],
    revision_cliente: [],
    aprobado: [],
    publicado: [],
  }
  for (const item of items) {
    byPhase[item.phase as Phase]?.push(item)
  }

  // Lista de clientes para el filtro (todos los que tienen ciclo actual)
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('status', 'active')
    .order('name')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Pipeline" />

      <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
        {/* Filtro por cliente */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#595c5e]">Cliente:</span>
          <form method="GET">
            <select
              name="clientId"
              defaultValue={clientId ?? ''}
              onChange={(e) => {
                // Este select está en un Server Component — usamos un form submit normal
                // El 'onChange' aquí no funciona en SSR; el usuario presiona Enter o se usa un button
              }}
              className="text-sm border border-[#dfe3e6] rounded-xl px-3 py-1.5 bg-white text-[#2c2f31]"
            >
              <option value="">Todos los clientes</option>
              {(allClients ?? []).map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 text-sm px-3 py-1.5 rounded-xl bg-[#00675c] text-white"
            >
              Filtrar
            </button>
          </form>
        </div>

        {/* Kanban */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 min-w-max h-full">
            {PHASES.map((phase) => (
              <KanbanColumn
                key={phase}
                phase={phase}
                items={byPhase[phase]}
                logsMap={logsMap}
                currentUserId={authUser.id}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Nota sobre el filtro:** El `<select>` con `<form method="GET">` y un botón "Filtrar" funciona como filtro URL-based sin JS del lado cliente. Al seleccionar un cliente y presionar "Filtrar", la página recarga con `?clientId=xxx` en la URL.

- [ ] **Step 2: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 3: Probar en el navegador**

```bash
npm run dev
```

Ir a `/pipeline`. Debe mostrarse el kanban con 6 columnas. Si no hay consumos aún, todas las columnas aparecen vacías con "Sin piezas".

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/pipeline/page.tsx
git commit -m "feat: add global pipeline kanban page"
```

---

## Task 9: Tab de pipeline en detalle del cliente

**Files:**
- Create: `src/components/pipeline/ClientPipelineTab.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Crear `ClientPipelineTab.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { PipelineCard } from './PipelineCard'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface ClientPipelineTabProps {
  items: PipelineItem[]
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
}

export function ClientPipelineTab({ items, logsMap, currentUserId }: ClientPipelineTabProps) {
  const byPhase: Record<Phase, PipelineItem[]> = {
    pendiente: [],
    en_produccion: [],
    revision_interna: [],
    revision_cliente: [],
    aprobado: [],
    publicado: [],
  }
  for (const item of items) {
    byPhase[item.phase as Phase]?.push(item)
  }

  const nonEmptyPhases = PHASES.filter((p) => byPhase[p].length > 0)

  if (items.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-[#595c5e]">
        No hay piezas en el pipeline para este ciclo.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {nonEmptyPhases.map((phase) => (
        <div key={phase}>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-[#2c2f31]">{PHASE_LABELS[phase]}</h4>
            <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full">
              {byPhase[phase].length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {byPhase[phase].map((item) => (
              <PipelineCard
                key={item.id}
                item={item}
                logs={logsMap[item.id] ?? []}
                currentUserId={currentUserId}
                showClient={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Actualizar `src/app/(app)/clients/[id]/page.tsx`**

Agregar las siguientes queries después de la query de `users` ya existente:

```typescript
// Pipeline items del ciclo actual
const pipelineItems: PipelineItem[] = []
const pipelineLogsMap: Record<string, ConsumptionPhaseLog[]> = {}

if (currentCycle) {
  const { data: pipelineCons } = await supabase
    .from('consumptions')
    .select('id, content_type, phase, billing_cycle_id, registered_at, notes')
    .eq('billing_cycle_id', currentCycle.id)
    .eq('voided', false)
    .in('content_type', PIPELINE_CONTENT_TYPES)
    .order('registered_at', { ascending: false })

  for (const c of pipelineCons ?? []) {
    pipelineItems.push({
      id: c.id,
      content_type: c.content_type,
      phase: c.phase,
      billing_cycle_id: c.billing_cycle_id,
      client_id: id,
      client_name: client.name,
      client_logo_url: client.logo_url,
      last_moved_at: c.registered_at,
      registered_at: c.registered_at,
      notes: c.notes,
    })
  }

  if (pipelineItems.length > 0) {
    const { data: logsRaw } = await supabase
      .from('consumption_phase_logs')
      .select('*')
      .in('consumption_id', pipelineItems.map((i) => i.id))
      .order('created_at', { ascending: true })

    for (const log of logsRaw ?? []) {
      if (!pipelineLogsMap[log.consumption_id]) pipelineLogsMap[log.consumption_id] = []
      pipelineLogsMap[log.consumption_id].push(log as ConsumptionPhaseLog)
    }

    for (const item of pipelineItems) {
      const logs = pipelineLogsMap[item.id] ?? []
      if (logs.length > 0) item.last_moved_at = logs[logs.length - 1].created_at
    }
  }
}
```

Agregar imports necesarios al inicio del archivo:
```typescript
import { ClientPipelineTab } from '@/components/pipeline/ClientPipelineTab'
import { PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { ConsumptionPhaseLog } from '@/types/db'
```

Agregar el tab de pipeline al JSX. Localizar el cierre de la sección `<ConsumptionPanel ... />` y después del bloque `pastCycles`, agregar:

```tsx
{/* Pipeline del ciclo actual — siempre visible cuando hay ciclo activo */}
{cycle && (
  <div className="glass-panel rounded-[2rem] p-6 space-y-4">
    <h3 className="text-base font-semibold text-[#2c2f31]">Pipeline</h3>
    <ClientPipelineTab
      items={pipelineItems}
      logsMap={pipelineLogsMap}
      currentUserId={authUser?.id ?? ''}
    />
  </div>
)}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 4: Probar manualmente**

Ir a un cliente con consumos → debe verse la sección "Pipeline" con las piezas agrupadas por fase. Hacer clic en una card → abre el Sheet → verificar timeline y botón Mover.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/ClientPipelineTab.tsx src/app/(app)/clients/[id]/page.tsx
git commit -m "feat: add Pipeline tab to client detail page"
```

---

## Task 10: Agregar Pipeline al Sidebar

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Agregar el item de Pipeline al array `navItems`**

Localizar el array `navItems` en `Sidebar.tsx`. Agregar después del item de "Clientes" y antes de "Renovaciones":

```typescript
{
  href: '/pipeline',
  label: 'Pipeline',
  icon: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
    </svg>
  ),
},
```

- [ ] **Step 2: Verificar tipos**

```bash
cd "fm-crm" && npx tsc --noEmit
```

- [ ] **Step 3: Build final de verificación**

```bash
cd "fm-crm" && npm run build
```

Esperado: build exitoso sin errores de TypeScript ni de Next.js.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add Pipeline link to sidebar navigation"
```

---

## Verificación final

- [ ] Registrar un consumo no-produccion → verificar que aparece en `/pipeline` en columna "Pendiente"
- [ ] Hacer clic en la card → Sheet se abre con el log inicial
- [ ] Mover a "En Producción" con nota → Card se mueve de columna, timeline muestra el movimiento
- [ ] Ir a detalle del cliente → tab/sección Pipeline muestra las piezas del ciclo activo
- [ ] Registrar una Produccion → NO aparece en ninguna vista de pipeline
- [ ] Anular un consumo → desaparece del kanban

---

## Resumen de commits esperados

1. `feat: add phase column to consumptions and consumption_phase_logs table`
2. `feat: add Phase type and consumption_phase_logs types to db.ts`
3. `feat: add pipeline domain logic (movePhase, insertInitialPhaseLog, PipelineItem)`
4. `feat: add Sheet UI component (shadcn)`
5. `feat: insert initial phase log when registering a consumption`
6. `feat: add PhaseSheet component for phase history and movement`
7. `feat: add PipelineCard and KanbanColumn components`
8. `feat: add global pipeline kanban page`
9. `feat: add Pipeline tab to client detail page`
10. `feat: add Pipeline link to sidebar navigation`
