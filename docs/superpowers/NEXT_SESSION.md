# FM CRM — Handoff para la siguiente sesión

> **Objetivo de la siguiente sesión:** implementar los sub-proyectos y mejoras pendientes listados más abajo.  
> **Estado actual:** rama `master`, todo commiteado y pusheado (14 commits de features recientes).

---

## Contexto del proyecto

CRM para **FM Communication Solutions** (agencia de marketing, El Salvador).  
Seguimiento de consumo mensual de contenido por cliente según plan contratado.

**Stack:** Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres + Auth + RLS + Storage) · Vercel

**Reglas del dominio:**
- Ciclo mensual por `billing_day` de cada cliente (no el 1° del mes)
- Renovación híbrida: auto-renueva mismo plan; marca moroso si no hay pago registrado
- Rollover solo con autorización manual del admin
- Snapshot del plan al abrir ciclo (cambios al catálogo no afectan ciclos anteriores)

**Roles:** `admin` (CRUD completo, forzar límites, autorizar rollover) · `operator` (registrar/anular consumos, ver todo)

**UI Workflow:** Para pantallas nuevas → primero Google Stitch MCP. Claude genera prompt → usuario ejecuta Stitch → devuelve HTML → Claude itera. **Nunca** empezar a codificar una UI nueva sin este ciclo de mockup.

---

## Estructura de archivos relevante

```
src/
├── app/(app)/
│   ├── clients/
│   │   ├── [id]/
│   │   │   ├── edit/page.tsx       ← Edición de cliente (admin only)
│   │   │   ├── report/page.tsx     ← Reporte por cliente
│   │   │   └── page.tsx            ← Detalle de cliente
│   │   └── page.tsx                ← Lista de clientes
│   ├── dashboard/page.tsx
│   ├── pipeline/page.tsx           ← Kanban drag & drop (KanbanBoard)
│   ├── plans/page.tsx
│   ├── renewals/page.tsx
│   └── reports/page.tsx
├── components/
│   ├── clients/
│   │   ├── ConsumptionPanel.tsx    ← Panel consumo + progress bars semanales
│   │   ├── ConsumptionModal.tsx
│   │   ├── ConsumptionHistory.tsx
│   │   ├── ClientForm.tsx
│   │   └── ...
│   └── pipeline/
│       ├── KanbanBoard.tsx         ← DndContext + DragOverlay + MovePhaseModal
│       ├── KanbanColumn.tsx        ← useDroppable
│       ├── PipelineCard.tsx        ← CardBody exportado + useDraggable gated
│       ├── MovePhaseModal.tsx      ← Modal confirmación de fase
│       ├── ClientPipelineTab.tsx   ← Pestaña pipeline dentro de cliente (sin DnD)
│       └── PhaseSheet.tsx          ← Click-to-move (solo en ClientPipelineTab)
├── lib/domain/
│   ├── consumption.ts              ← computeTotals, weeklyTarget, effectiveWeeklyTarget
│   ├── cycles.ts
│   ├── pipeline.ts                 ← movePhase()
│   └── plans.ts                    ← limitsToRecord()
└── types/db.ts                     ← Database types, ContentType, Phase, PlanLimits, etc.
```

---

## Lo que se implementó en la sesión anterior

### Feature 1: Weekly Consumption Targets
- Migración `supabase/migrations/0006_client_weekly_targets.sql` — agrega columna `weekly_targets_json jsonb` a `clients`
  - **⚠ PENDIENTE EJECUTAR EN SUPABASE DASHBOARD** si no se hizo: `ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS weekly_targets_json jsonb;`
- `src/types/db.ts` — `weekly_targets_json` agregado a Client Row/Insert/Update
- `src/lib/domain/consumption.ts` — helpers `weeklyTarget()` y `effectiveWeeklyTarget()`
- `src/components/clients/ConsumptionPanel.tsx` — weekly cards con progress bars por tipo (verde/ámbar/gris)
- `src/app/(app)/clients/[id]/edit/page.tsx` — sección "Objetivos semanales" con inputs por tipo activo

### Feature 2: Pipeline Drag & Drop
- `@dnd-kit/core` + `@dnd-kit/utilities` instalados
- `PipelineCard` — prop `draggable?: boolean`; cuando true usa `useDraggable`, cuando false mantiene `PhaseSheet`
- `CardBody` exportado por separado (sin hooks) para el `DragOverlay`
- `KanbanColumn` — `useDroppable`, resaltado verde-dashed en hover
- `KanbanBoard` — `DndContext` + `PointerSensor` (5px constraint) + `DragOverlay` + `MovePhaseModal`
- `MovePhaseModal` — confirmación de movimiento de fase, notas opcionales, error handling
- `pipeline/page.tsx` — usa `KanbanBoard` en lugar de columns directas

---

## Pendientes para esta sesión

### 1. Página de gestión de usuarios (PRIORIDAD ALTA)
Crear/invitar usuarios desde dentro del CRM, sin tener que ir al Dashboard de Supabase.

**Contexto:**
- Actualmente los usuarios se crean manualmente en Supabase Auth
- La tabla `users` en `src/types/db.ts` tiene: `id`, `email`, `full_name`, `role: 'admin' | 'operator'`, `created_at`
- Solo admins deben poder gestionar usuarios
- Supabase tiene `supabase.auth.admin.inviteUserByEmail()` (requiere service role key, solo en servidor)

**Lo que se necesita:**
- Una página `/users` (solo admin) con lista de usuarios actuales
- Formulario para invitar nuevo usuario (email + nombre + rol)
- Posibilidad de cambiar el rol de un usuario existente
- Posiblemente desactivar/eliminar usuarios

---

### 2. Detalle de registro de producciones y reuniones
Las producciones (`produccion`) y reuniones (`reunion`) no pasan por fases del pipeline igual que el resto de contenido. Necesitan tracking/display separado.

**Contexto:**
- `ContentType` incluye `'produccion'` y `'reunion'`
- Actualmente se registran como consumos normales pero no aparecen en el pipeline
- En `ConsumptionPanel` se muestran en el conteo mensual pero sin detalle
- `PlanLimits` incluye `reuniones?: number` y `reunion_duracion_horas?: number`

**Lo que se necesita (por definir con usuario):**
- ¿Cómo se muestran en el panel del cliente?
- ¿Tienen fases propias o solo fechas y notas?
- ¿El campo `reunion_duracion_horas` del plan se usa para algo visual?

---

### 3. Verificación de página de reportes
Confirmar que la página `/reports` muestra datos correctos.

**Contexto:**
- Existe `src/app/(app)/reports/page.tsx` y componentes `CsvDownloadButton`, `PrintButton`
- No se ha verificado después de los cambios recientes

---

### 4. UI de carga de logo del cliente
Permitir que admins suban el logo del cliente desde la página de edición.

**Contexto:**
- `clients.logo_url` existe en el schema (string | null)
- Supabase Storage está disponible en el stack
- La página de edición está en `src/app/(app)/clients/[id]/edit/page.tsx`
- Actualmente el campo `logo_url` se edita como texto plano (URL directa)

---

## Tipos principales del sistema

```ts
export type ContentType =
  | 'historia' | 'estatico' | 'video_corto' | 'reel'
  | 'short' | 'produccion' | 'reunion'

export type Phase =
  | 'pendiente' | 'en_produccion' | 'revision_interna'
  | 'revision_cliente' | 'aprobado' | 'publicado'

export type ClientStatus = 'active' | 'paused' | 'overdue'
export type CycleStatus = 'current' | 'archived' | 'pending_renewal'
export type PaymentStatus = 'paid' | 'unpaid'
export type UserRole = 'admin' | 'operator'

export interface PlanLimits {
  historias: number
  estaticos: number
  videos_cortos: number
  reels: number
  shorts: number
  producciones: number
  reuniones?: number
  reunion_duracion_horas?: number
}
```

---

## Planes activos en producción

| Plan | Precio | Historias | Estáticos | Videos C. | Reels | Shorts | Producciones |
|------|--------|-----------|-----------|-----------|-------|--------|--------------|
| Básico | $200 | 12 | 4 | 2 | 2 | 0 | 1 |
| Profesional | $300 | 16 | 8 | 4 | 4 | 4 | 2 |
| Premium | $400 | 16 | 8 | 8 | 4 | 6 | 3 |

---

## Sub-proyectos a futuro (no para esta sesión)

1. **Webhook Connect → n8n → CRM** — ingesta de datos externos
2. **Portal del cliente** — vista read-only para clientes
3. **Facturación de excedentes** — cálculo y cobro de contenido extra

---

## Instrucciones para el agente al iniciar la sesión

1. Leer este archivo primero
2. Confirmar con el usuario cuál pendiente atacar primero
3. Seguir el flujo de brainstorming → spec → plan → subagent-driven-development
4. Para cualquier UI nueva: pasar primero por Google Stitch MCP (Claude da prompt → usuario ejecuta → devuelve HTML)
5. Rama de trabajo: crear branch desde `master` para cada feature

---

*Generado al final de la sesión 2026-04-17. Commits en master hasta `4dc6e78`.*
