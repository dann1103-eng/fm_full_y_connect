@AGENTS.md

# FM CRM — Claude Context

## Proyecto
CRM interno para FM Communication Solutions. Gestiona clientes, ciclos de facturación, consumos de contenido, y pipeline de producción.

## Stack
- Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui
- Supabase (Postgres + Auth + Storage) — `@supabase/supabase-js@2`
- @dnd-kit/core para drag-and-drop en pipeline
- Rama principal activa: `qa-reports-logo-upload` (features en curso)

## Comandos esenciales
```bash
npm run dev          # localhost:3000
npm run lint         # debe dar 0 errors antes de commit
npm run build        # verificación final de tipos y build
git add <files> && git commit -m "feat|fix|docs: mensaje en español"
```

## Arquitectura de archivos clave
| Archivo | Rol |
|---------|-----|
| `src/types/db.ts` | Tipos TS manuales (NO auto-generados). Editar directamente al cambiar el schema. |
| `src/lib/domain/pipeline.ts` | `PipelineItem` interface — fuente de verdad para todos los componentes del pipeline. Incluye `migrateOpenPipelineItems`. |
| `src/lib/domain/consumption.ts` | Lógica de cálculo de límites y semanas |
| `src/lib/domain/plans.ts` | `limitsToRecord`, `CONTENT_TYPE_LABELS` |
| `src/app/actions/` | Server Actions (`'use server'`) |
| `supabase/migrations/` | Migraciones SQL (`NNNN_description.sql`) — aplicar manualmente en Supabase Dashboard |

## Supabase — dos clientes, nunca confundir
```ts
// Server components / Server Actions:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()   // ← async

// 'use client' components:
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()          // ← sync
```

## Reglas ESLint que muerden
- **`react-hooks/purity`**: Nunca `Date.now()` en render/hooks → usar `new Date().getTime()`
- **`react-hooks/set-state-in-effect`**: No llamar `setState` sincrónicamente en el body de `useEffect`. Estado derivado → `useMemo`. Operaciones async → setState solo en `.then()` / callbacks.
- `redirect()` de `next/navigation` lanza internamente — siempre última línea en Server Actions.

## Modelo de datos (tablas principales)
```
clients         → billing_cycles → consumptions → consumption_phase_logs
                                              ↘ voided_by_user_id (→ users, NO se borra)
clients.max_cambios       — límite de cambios por consumo (default 2)
consumptions.title        — requerido en UI, DEFAULT '' en DB (legacy rows ok)
consumptions.cambios_count — contador, sin decremento por diseño
consumptions.phase        — fase actual en pipeline
```

### Cascade delete (orden obligatorio)
`consumption_phase_logs` → `consumptions` → `billing_cycles` → `clients`
No hay FK CASCADE en DB — el app borra en secuencia.

## Pipeline — arquitectura de componentes
```
pipeline/page.tsx (server)
  └─ KanbanBoard ('use client')
       ├─ KanbanColumn (threads onDoubleClick)
       │    └─ PipelineCard — rama DRAGGABLE (@dnd-kit, onDoubleClick → PhaseSheet sin move)
       ├─ MovePhaseModal   — abre al soltar en nueva columna (DnD)
       └─ PhaseSheet       — abre en doble clic, showMoveSection=false, logs on-demand

clients/[id]/page.tsx (server)
  └─ ClientPipelineTab ('use client')
       └─ PipelineCard — rama NO-DRAGGABLE (onClick → PhaseSheet con move section)
```
- `PipelineItem` (en `pipeline.ts`): al agregar columnas a `consumptions`/`clients`, actualizar interfaz Y `migrateOpenPipelineItems`.
- `PhaseSheet` props clave: `showMoveSection` (default true), `title`, `consumptionNotes`, `cambiosCount`, `maxCambios`.
- `KanbanBoard`: logs del consumo se cargan on-demand en `.then()` del useEffect (no setState síncrono).

## Storage — logos de clientes
- Bucket público: `client-logos` (crear manualmente en Supabase Dashboard)
- Helper: `src/lib/supabase/upload-logo.ts`
- Componente: `src/components/clients/LogoUploader.tsx`
- Policies en: `supabase/migrations/0007_client_logos_bucket.sql`

## Patrones UI
- Colores: teal `#00675c` / rojo `#b31b25` / gris `#595c5e` / borde `#dfe3e6` / fondo `#f5f7f9`
- CSS class `glass-panel` definida en `globals.css`
- Admin check: `supabase.from('users').select('role').eq('id', user.id).single()` → `role === 'admin'`
- Todo el texto UI y los mensajes de error van en **español**
- Commits en español: `feat:`, `fix:`, `docs:`

## Migraciones aplicadas
| Migración | Contenido |
|-----------|-----------|
| 0007 | Storage bucket client-logos (policies) |
| 0008 | `consumptions.title`, `consumptions.cambios_count`, `clients.max_cambios` |
