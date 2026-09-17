# Creador de matrices · Bloque 1: matrices manuales — Diseño

**Fecha:** 2026-09-16 · **Revisión:** 2 (tras revisión de spec: soporte 8 semanas en la distribución, chips bajo pool unificado, deadline del requerimiento vinculado)
**Estado:** Aprobado en diseño — pendiente de plan de implementación

## Contexto

Los requerimientos que hoy entran al pipeline no nacen sueltos: salen de una **matriz de
contenido** mensual que una persona arma en Excel después de reunirse con el cliente, y que
luego otra persona transcribe a mano como requerimientos. El plan de cada cliente ya incluye
una "matriz de contenido" por ciclo (`ContentType = 'matriz_contenido'`, `PlanLimits.matrices_contenido`),
pero en el CRM eso es solo un contador y una tarjeta con timer (`MatrixContentCard`). El
contenido real de la matriz no existe en el sistema.

El proyecto completo "Creador de matrices" se dividió en tres bloques independientes, cada
uno con su propio spec y plan:

| Bloque | Qué entrega | Estado |
|---|---|---|
| **1. Matrices manuales** | Modelo de datos, editor tipo tabla, cupos del plan, estados, vínculo con el requerimiento de matriz | **Este documento** |
| 2. Conversión automática | Barrido diario que convierte piezas aprobadas en requerimientos `lead_days` antes de la entrega, manejo del candado de pago y del ciclo inexistente, brief visible en el pipeline | Pendiente |
| 3. Asistencia con IA | Perfil de marca por cliente, jobs `ai_jobs` de generación por matriz y por pieza, regenerar con instrucciones, etiqueta de producción propuesta por IA | Pendiente |

Este bloque no toca IA ni crea requerimientos de contenido. Deja preparados los campos que
los bloques 2 y 3 necesitan para no migrar dos veces.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Quién planifica | `admin` y `supervisor` | Misma regla que `canCreateRequirement`. Operadores y clientes no ven la sección en este bloque |
| Ancla temporal | **Ciclo de facturación del cliente**, no mes calendario | Los ciclos arrancan en `billing_day`; anclar al mes calendario haría caer piezas en el ciclo equivocado |
| Ciclo objetivo inexistente | La matriz guarda `period_start/period_end` propios; `billing_cycle_id` se llena solo si el ciclo ya existe | Las matrices se hacen un mes antes; la fila del ciclo suele crearse días antes de arrancar |
| Cupos excedidos | **Aviso, no bloqueo**: la pieza se marca "fuera de plan" | Coherente con el registro manual actual, donde el admin puede forzar `over_limit` |
| Marca fuera de plan | Calculada al leer, no almacenada | Refleja cambios de plan, overrides y créditos comprados sin recalcular nada |
| Requerimiento de matriz del plan | Se registra **automáticamente** en el ciclo vigente al crear la matriz y queda vinculado | La matriz nueva es la entrega del plan; el requerimiento queda como registro contable y del timer, sin doble captura |
| Campos de la pieza | Título, tipo, tema, objetivo, copy, guión, estilo visual, hashtags, CTA, fecha de entrega, necesita producción | Red social, referencias, "incluye historia" y responsable quedan fuera por decisión del usuario |
| Vista principal del editor | **Tabla + panel lateral** | Lo más cercano al Excel actual; densa y ordenable. Tablero semanal y calendario descartados |
| Dónde vive | Sección propia `/matrices` en el menú + tarjeta en el perfil del cliente | Da al supervisor la vista de qué clientes ya tienen matriz y cuáles no |
| Orden de las piezas | Por `deadline`, luego `created_at`. Sin campo de orden manual | En una tabla se espera orden cronológico; menos estado |
| Persistencia | Tablas propias (`content_matrices`, `content_matrix_items`), una fila por pieza | El bloque 2 necesita barrer, indexar y enlazar piezas una por una. Descartados: JSON único por matriz, o piezas como requerimientos en estado previo |
| Unicidad | Una matriz por `(client_id, period_start)` | Evita duplicados; "duplicar" siempre apunta a otro período |

## Modelo de datos

### Migración `0129_content_matrices.sql`

```sql
create table public.content_matrices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  period_start          date not null,
  period_end            date not null,
  billing_cycle_id      uuid references public.billing_cycles(id) on delete set null,
  title                 text not null default '',
  status                text not null default 'draft'
                        check (status in ('draft','approved','closed')),
  topics_json           jsonb not null default '[]'::jsonb,   -- [{ name: string, note?: string }]
  notes                 text,                                 -- enfoque del mes / apuntes de la reunión
  lead_days             smallint not null default 7 check (lead_days between 0 and 30),
  matrix_requirement_id uuid references public.requirements(id) on delete set null,
  created_by            uuid not null references public.users(id),
  approved_by           uuid references public.users(id),
  approved_at           timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint content_matrices_period_chk check (period_end > period_start),
  constraint content_matrices_client_period_uq unique (client_id, period_start)
);

create table public.content_matrix_items (
  id               uuid primary key default gen_random_uuid(),
  matrix_id        uuid not null references public.content_matrices(id) on delete cascade,
  content_type     text not null
                   check (content_type in ('historia','estatico','video_corto','reel','short')),
  title            text not null default '',
  topic            text,
  objective        text check (objective in ('venta','alcance','educacion','comunidad','otro')),
  copy             text,
  script           text,
  visual_style     text,
  hashtags         text,
  cta              text,
  deadline         date not null,
  needs_production boolean not null default false,
  status           text not null default 'planned'
                   check (status in ('planned','converted','blocked')),
  requirement_id   uuid references public.requirements(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index content_matrices_client_idx      on public.content_matrices (client_id, period_start desc);
create index content_matrix_items_matrix_idx  on public.content_matrix_items (matrix_id, deadline, created_at);
-- Reservado para el barrido diario del bloque 2:
create index content_matrix_items_planned_idx on public.content_matrix_items (deadline)
  where status = 'planned';

-- updated_at: reutiliza public.update_updated_at() (0001_init.sql)
create trigger content_matrices_updated_at      before update on public.content_matrices
  for each row execute procedure public.update_updated_at();
create trigger content_matrix_items_updated_at  before update on public.content_matrix_items
  for each row execute procedure public.update_updated_at();
```

**RLS.** Ambas tablas con RLS activo. Cuatro políticas por tabla (select / insert / update /
delete) con la misma condición, siguiendo el patrón de `0117_assigned_tasks.sql`:

```sql
exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
```

El bloque 2 correrá con el cliente de servicio (bypass RLS); no necesita políticas propias.

**Semántica de campos reservados.** En este bloque `content_matrix_items.status` es siempre
`'planned'` y `requirement_id` siempre `null`. `lead_days` se guarda pero no se usa. `notes`
y `topics_json` alimentarán los prompts del bloque 3.

### Tipos TypeScript (`src/types/db.ts`, manuales)

- Filas `content_matrices` y `content_matrix_items` en `Database['public']['Tables']` con Row / Insert / Update.
- `export type MatrixStatus = 'draft' | 'approved' | 'closed'`
- `export type MatrixItemStatus = 'planned' | 'converted' | 'blocked'`
- `export type MatrixObjective = 'venta' | 'alcance' | 'educacion' | 'comunidad' | 'otro'`
- `export interface MatrixTopic { name: string; note?: string }`
- Aliases `ContentMatrix`, `ContentMatrixItem`.

## Lógica de dominio — `src/lib/domain/matrix.ts`

Módulo puro, sin acceso a base de datos, con pruebas en `matrix.test.ts`.

### Constantes

```ts
export const MATRIX_CONTENT_TYPES: ContentType[] = ['historia','estatico','video_corto','reel','short']
export const MATRIX_OBJECTIVES: MatrixObjective[] = ['venta','alcance','educacion','comunidad','otro']
export const MATRIX_OBJECTIVE_LABELS: Record<MatrixObjective, string>   // Venta, Alcance, Educación, Comunidad, Otro
export const MATRIX_STATUS_LABELS: Record<MatrixStatus, string>         // Borrador, Aprobada, Cerrada
```

### `computeTargetPeriods(input) → TargetPeriod[]`

```ts
interface TargetPeriodsInput {
  currentCycle: { period_start: DateString; period_end: DateString } | null
  billingDay: number
  billingPeriod: BillingPeriod
  today: DateString
  count?: number            // default 4 (vigente + 3 siguientes)
}
interface TargetPeriod { periodStart: DateString; periodEnd: DateString; label: string; isCurrent: boolean }
```

- Con `currentCycle`: el primero es el ciclo vigente tal cual; los siguientes se encadenan con
  `nextCycleDates(prevEnd, { billingPeriod })` (`src/lib/domain/cycles.ts`).
- Sin ciclo vigente: `periodStart = currentCycleDates(billingDay, today).periodStart` y luego
  `firstCycleDates(periodStart, { billingPeriod })` para respetar quincenal / bimestral; el
  resto se encadena igual. Para quincenal sin ciclo vigente el ancla mensual de
  `currentCycleDates` es una aproximación intencional: el caso real (cliente con plan pero sin
  ciclo) es raro y el admin corrige al crear el ciclo.
- `label` con `formatDateEs`: "15 oct al 14 nov 2026".

### `resolveMatrixLimits(input) → MatrixLimits`

```ts
interface MatrixLimitsInput {
  cycle: BillingCycle | null                // ciclo objetivo si ya existe
  plan: Plan                                // plan actual del cliente
  cycleRequirements: Requirement[]          // reqs del ciclo objetivo (vacío si no existe)
  credits: Partial<Record<ContentType, number>>   // créditos de contenido disponibles
}
interface MatrixLimits {
  limits: Record<ContentType, number>       // cupo del plan por tipo
  cycleTotals: Record<ContentType, number>  // ya consumido en el ciclo objetivo (0 si no existe)
  credits: Partial<Record<ContentType, number>>
  unifiedPool: number | null                // pool compartido de tippables, si aplica
  estimated: boolean                        // true cuando no hay ciclo y se usó el plan actual
}
```

- Con ciclo: `effectiveLimits(snapshot, rollover)` → `applyContentLimitsWithOverride(override)`;
  `cycleTotals = computeTotals(cycleRequirements)`; `unifiedPool = snapshot.unified_content_limit ?? null`.
- Sin ciclo: `limitsToRecord(plan.limits_json)`; `cycleTotals` en cero; `unifiedPool = plan.unified_content_limit`;
  `estimated = true`.
- `credits` viene de `getAvailableContentCredits(supabase, clientId)` (`src/lib/domain/credits.ts`,
  la función de dominio, no la server action). Solo existen créditos para `estatico`,
  `video_corto`, `reel` y `short`; nunca para `historia`.

**Planes con pool unificado.** `PlanForm` pone en 0 los límites individuales de
`historias, estaticos, videos_cortos, reels, shorts` cuando el plan usa pool, y
`TIPPABLE_CONTENT_TYPES` (`plans.ts`) es `['estatico','video_corto','reel','short']`, sin
`historia`. Consecuencias que el editor debe reflejar:

- Los cuatro tippables se cuentan contra `unifiedPool` (más sus créditos) en un solo contador.
- `historia` no entra al pool y su límite es 0: cada historia planificada queda fuera de plan.
  Es el mismo comportamiento que hoy tiene `RequirementPanel` (historia inactiva bajo pool) y
  se acepta tal cual.

### `computeMatrixUsage(items, ml: MatrixLimits) → MatrixUsage`

```ts
interface MatrixUsage {
  byType: Record<ContentType, { planned: number; used: number; limit: number; credits: number; over: number }>
  pool: { used: number; limit: number } | null
  overPlanItemIds: Set<string>
}
```

- `planned[t]` = piezas con `status !== 'converted'` de tipo `t` (las convertidas ya cuentan en `cycleTotals`).
- `used[t] = cycleTotals[t] + planned[t]`.
- Marcado fuera de plan: recorrer las piezas ordenadas por `deadline, created_at`. Para cada
  tipo se lleva un contador que arranca en `cycleTotals[t]`; la pieza queda fuera de plan cuando
  el contador supera `limit[t] + credits[t]`. Con `unifiedPool`, los tipos de
  `TIPPABLE_CONTENT_TYPES` comparten un solo contador que arranca en la suma de sus
  `cycleTotals` y se compara contra `pool + sum(credits tippables)`; `pool.used / pool.limit`
  se llenan con esos valores.
- **Chips de la cabecera.** Sin pool: un chip por cada tipo de `MATRIX_CONTENT_TYPES` que
  tenga `limit > 0`, `credits > 0` o `planned > 0` (así una pieza de un tipo sin cupo revela
  su chip en rojo, "Historias 1 / 0"). Con pool: un solo chip "Contenidos N / M" para los
  cuatro tippables, más el chip de `historia` solo si cumple la misma regla. Color: verde
  cuando `used === limit`, rojo cuando `used > limit + credits`, neutro en el resto; en el chip
  de pool `limit` es `pool.limit`. Si hay créditos se muestran como "+N créditos".
- **Tipos planificables activos** (`activeMatrixTypes`): los que muestran chip. Sin pool, los
  tipos de `MATRIX_CONTENT_TYPES` que cumplen `limit > 0 || credits > 0 || planned > 0`. Con
  pool, siempre los cuatro tippables (cubiertos por el chip único) más `historia` si cumple esa
  misma regla. Es la lista que alimenta `buildEffectiveDistribution.pipelineTypes` y el selector
  de "Agregar pieza" en primer lugar; los demás tipos de `MATRIX_CONTENT_TYPES` se ofrecen
  debajo de un separador "sin cupo" (regla de aviso, no bloqueo).

### `buildEffectiveDistribution(input) → WeeklyDistribution`

Extrae a `src/lib/domain/weekly-distribution.ts` la cadena de cuatro pasos que hoy vive
inline en `RequirementPanel.tsx:247-263` (resolveDistribution → augmentDistribution →
applyOverride → addRollover). `RequirementPanel` pasa a llamarla. Sin ciclo objetivo, los
pasos de override y rollover se omiten.

```ts
interface EffectiveDistributionInput {
  clientDistribution: WeeklyDistribution | null | undefined   // clients.weekly_distribution_json
  planDistribution: WeeklyDistribution | null | undefined     // plans.default_weekly_distribution_json
  pipelineTypes: ContentType[]                                 // matriz: activeMatrixTypes
  limits: Record<ContentType, number>                          // ya con content_limits_override_json aplicado
  cycleOverride?: WeeklyDistribution | null                    // billing_cycles.weekly_distribution_override_json
  rollover?: Partial<PlanLimits> | null                        // billing_cycles.rollover_from_previous_json
  weeks?: ReadonlyArray<WeekKey>                               // default WEEKS_BASE (S1..S4)
}
```

**Soporte de 8 semanas.** Hoy `augmentDistribution`, `applyOverride` y `addRollover` iteran
una constante fija `S1..S4` y `augmentDistribution` rellena con `ceil(limit / 4)`. Para que
un ciclo bimestral proponga fechas en S5..S8, las tres funciones ganan un último parámetro
opcional `weeks: ReadonlyArray<WeekKey> = WEEKS`: `augmentDistribution` divide entre
`weeks.length`, y `addRollover` reemplaza sus `/ 4`, `% 4` e `i < 4` hardcodeados por
`weeks.length`. Con el valor por defecto el comportamiento y las pruebas actuales no cambian;
`buildProrateOverride` y `buildAccumulateOverride` no se tocan. `buildEffectiveDistribution`
convierte `rollover` con `rolloverToContentType` (`plans.ts`) antes de `addRollover`, igual
que hoy `RequirementPanel`, y reenvía `weeks` a las tres funciones. Quien la llama decide las
semanas: `loadMatrixEditorData` envía `weeks: weeksForBillingPeriod(client.billing_period)`
(`src/types/db.ts`); `RequirementPanel` sigue llamando con el default en este bloque (su
breakdown bimestral tiene la misma limitación hoy y no se corrige aquí).

### `proposeDeadline(input) → DateString`

```ts
interface ProposeDeadlineInput {
  contentType: ContentType
  items: Pick<ContentMatrixItem, 'content_type' | 'deadline'>[]
  distribution: WeeklyDistribution
  periodStart: DateString
  periodEnd: DateString
  maxWeek: 4 | 8
}
```

- Para cada semana `S1..Smax`: `budget = distribution[Sw]?.[type] ?? 0`; `used` = piezas del
  mismo tipo cuya `weekIndexInCycle(new Date(deadline), periodStart, maxWeek)` es `w`.
  `weekIndexInCycle` recibe un `Date`; se construye con `new Date(deadline)` para que sea
  consistente con el `new Date(periodStart)` interno (ambos a medianoche UTC). No usar
  `parseDate` de `dates.ts` en un solo lado.
- Primera semana con `used < budget` → `periodStart + (w-1)*7 + 2` días, recortado a `periodEnd`.
- Si ninguna tiene hueco → la última semana con la misma fórmula.

### Estados y validaciones

```ts
export function canTransition(from: MatrixStatus, to: MatrixStatus, ctx: { hasConvertedItems: boolean }): boolean
```

| De | A | Regla |
|---|---|---|
| draft | approved | `validateForApproval` sin problemas |
| approved | draft | Permitido si `!hasConvertedItems` (en este bloque siempre true) |
| draft, approved | closed | Siempre |
| closed | cualquiera | Nunca |

```ts
export function validateForApproval(items): { ok: boolean; problems: Array<{ itemId: string; reason: 'sin_titulo' | 'fecha_fuera_de_periodo' }> }
export function validateItemPatch(patch, ctx: { periodStart; periodEnd; topics: MatrixTopic[] }): { ok: boolean; error?: string }
export function shiftDeadline(deadline, from: { start; end }, to: { start; end }): DateString  // mismo offset en días, recortado a to.end
```

- Aprobar exige al menos una pieza, todas con `title` no vacío y `deadline` dentro del período.
- `deadline` siempre dentro de `[period_start, period_end]`, también al guardar borrador.
- `topic` debe coincidir con el `name` de un tema de la matriz, o ser `null`.
- `objective` debe estar en `MATRIX_OBJECTIVES` o ser `null`.

## Server actions — `src/app/actions/matrices.ts`

Todas: `'use server'`, cliente autenticado (`@/lib/supabase/server`), verificación de rol
en servidor (`users.role in ('admin','supervisor')`, patrón de `contentPackage.ts`), retorno
`{ ok: true, ... } | { ok: false, error: string }`, y `revalidatePath` de `/matrices`,
`/matrices/[id]` y `/clients/[clientId]`.

| Acción | Entrada | Comportamiento |
|---|---|---|
| `createMatrix` | `clientId, periodStart, periodEnd, title, topics, notes` | Pre-chequea unicidad; resuelve `billing_cycle_id` si existe un ciclo del cliente con ese `period_start` (status `current` o `scheduled`); inserta; intenta vincular requerimiento (abajo). Devuelve `{ id, link: { ok, error? } }` |
| `updateMatrix` | `id, patch { title?, topics?, notes?, lead_days? }` | Si se quitan temas, limpia `topic` de las piezas que los usaban (la UI confirma antes) |
| `deleteMatrix` | `id` | Solo `status = 'draft'`. Si hay `matrix_requirement_id` sin `time_entries` (`time_entries.requirement_id` es `ON DELETE CASCADE`, por eso la precomprobación es obligatoria), borra `requirement_phase_logs` → `requirements` (orden obligatorio del proyecto). Si tiene tiempo, primero se pone `matrix_requirement_id = null` y luego se borra la matriz; el requerimiento sobrevive. Cada `.delete()` de Supabase debe leer `{ error }` (no lanza), patrón de `deleteClient.ts` |
| `setMatrixStatus` | `id, to` | Aplica `canTransition` + `validateForApproval`; setea `approved_by/approved_at` o `closed_at`. Devuelve los `problems` si no se puede aprobar |
| `addItem` | `matrixId, contentType, deadline?` | Si no viene `deadline`, la calcula con `proposeDeadline` usando los datos cargados en servidor. Devuelve la pieza |
| `updateItem` | `itemId, patch` | `validateItemPatch` contra período y temas de la matriz |
| `duplicateItem` | `itemId` | Copia todos los campos, mismo `deadline`, `status = 'planned'`, `requirement_id = null` |
| `deleteItem` | `itemId` | Borra la fila |
| `duplicateMatrix` | `id, periodStart, periodEnd` | Nueva matriz en `draft` con mismos `title` (ajustado al mes), `topics_json`, `notes`, `lead_days`; piezas copiadas con `shiftDeadline`. Intenta vincular requerimiento igual que `createMatrix` |
| `retryMatrixRequirementLink` | `id` | Reintenta el vínculo (abajo) |

### Vínculo con el requerimiento de matriz

Ejecutado por `createMatrix`, `duplicateMatrix` y `retryMatrixRequirementLink`, **con el
cliente autenticado** (no el de servicio) para que el trigger de pago
`requirements_check_week_payment_trg` y el resto de reglas apliquen igual que a un registro manual:

1. Buscar el ciclo `current` del cliente. Si no hay → `{ ok: false, error: 'El cliente no tiene ciclo vigente.' }`.
2. Cupos: `effectiveLimits` + `applyContentLimitsWithOverride` del ciclo; totales con
   `computeTotals` de sus requerimientos. Si `totals.matriz_contenido >= limits.matriz_contenido`
   → `{ ok: false, error: 'El plan no tiene cupo de matriz en el ciclo vigente.' }`.
3. Insertar `requirements` con `billing_cycle_id`, `content_type: 'matriz_contenido'`,
   `title` = título de la matriz, `registered_by_user_id` = usuario, `priority: 'media'`,
   `over_limit: false`, `approval_status: 'approved'` (explícito; `RequirementModal` usa el
   default de DB, que es el mismo valor). **Deadline:** si `period_start > today()` (zona
   `APP_TZ`), `deadline = period_start` (la matriz debe estar lista antes de que arranque su
   ciclo); si la matriz es del período vigente o de uno pasado, `deadline = addDaysString(today(), 3)`
   para que no nazca vencida.
4. `insertInitialPhaseLog` (`src/lib/domain/pipeline.ts`), como hace `RequirementModal`.
5. Guardar `matrix_requirement_id`. Si el insert falla, devolver `insertError.message` tal cual
   (así llegan los mensajes en español del trigger) y dejar el vínculo vacío.

## Carga de datos — `src/lib/data/matrices.ts`

Funciones de servidor reutilizadas por páginas y acciones:

- `loadMatrixEditorData(matrixId)` → matriz, piezas ordenadas, cliente con plan, ciclo objetivo
  si existe (`billing_cycles` por `client_id` + `period_start`, **sin filtrar por status**: un
  ciclo `pending_renewal` o `archived` también cuenta), requerimientos de ese ciclo, créditos
  de contenido (`getAvailableContentCredits`), `MatrixLimits`, `MatrixUsage`,
  `activeMatrixTypes`, distribución efectiva y `maxWeek`. Si el ciclo existe y
  `content_matrices.billing_cycle_id` está vacío, la siguiente acción de escritura lo rellena
  (oportunista; nada depende de esa columna en este bloque).
- `loadMatricesList(filters)` → filas para la tabla con `client(name, logo_url)`, conteo de
  piezas (una query agregada, no las piezas completas) y cupo total: suma de `limits` de todos
  los `MATRIX_CONTENT_TYPES` (los tipos sin cupo suman 0), o `pool.limit + limits.historia`
  bajo pool. No carga créditos ni piezas por matriz; el número coincide con el del editor.
- `loadMissingMatrices()` → clientes `status = 'active'` cuyo plan tiene
  `limitsToRecord(limits_json).matriz_contenido > 0` (incluye a propósito planes legacy sin la
  clave, que `limitsToRecord` resuelve a 1) y que no tienen `content_matrices` con
  `period_start` igual al del **próximo** período (`computeTargetPeriods(...)[1]`).
- `loadClientMatrices(clientId)` → matrices del período vigente y del siguiente para la tarjeta del perfil.

## Pantallas y componentes

### Navegación y permisos

- `src/lib/domain/permissions.ts`: `canManageMatrices = role === 'admin' || role === 'supervisor'`.
- `Sidebar.tsx`: nuevo `NavItem` `{ href: '/matrices', label: 'Matrices', icon: <svg…/>, allowedRoles: ['admin','supervisor'] }`
  colocado después de "Solicitudes" (`icon` es obligatorio en `NavItem`; usar un ícono de
  cuadrícula como el `grid_view` de `MatrixContentCard`). Las páginas redirigen a `/dashboard`
  si el rol no cumple.

### `/matrices` — `src/app/(app)/matrices/page.tsx` (server)

- `MissingMatricesPanel`: hasta 8 clientes activos sin matriz para el próximo ciclo, cada uno
  con botón "Crear" que abre el diálogo prellenado. Se oculta si no falta ninguna.
- `MatricesTable` (client): columnas cliente (logo + nombre), período, estado (badge),
  piezas "12 / 14", última edición, aprobada por. Filtros: estado, cliente
  (`ClientSearchSelect` existente), mes de `period_start`. Clic en fila → `/matrices/[id]`.
- `NewMatrixDialog` (client, `dialog.tsx`): cliente → al elegirlo se cargan los períodos con
  `computeTargetPeriods` (server action ligera `listTargetPeriods(clientId)`), radio de 4
  opciones con la vigente marcada; título propuesto "Matriz {mes dominante} {año}"
  (`dominantCycleMonth`); temas como chips (Enter agrega, × quita, nota opcional al pasar el
  mouse); notas. Si ya existe matriz para ese período muestra "Ya existe, abrir" en vez de crear.
  Al crear, `router.push('/matrices/[id]')`.

### `/matrices/[id]` — `src/app/(app)/matrices/[id]/page.tsx` (server) → `MatrixEditor` (client)

- `MatrixHeader`: nombre y logo del cliente, período con etiqueta, badge de estado, título
  editable inline, indicador "Guardado / Guardando…", chips de cupo según la regla de
  `computeMatrixUsage` (`CONTENT_ICONS` de `src/lib/domain/content-icons.ts` +
  `CONTENT_TYPE_LABELS`; con `estimated` muestra "cupos estimados según plan actual"; bajo pool
  un chip único "Contenidos N / M"), y acciones: **Aprobar** (o **Volver a borrador**), **Cerrar**, **Duplicar**,
  **Eliminar** (solo draft, con confirmación). Franja de aviso cuando `matrix_requirement_id`
  es null con el motivo guardado en memoria de la última acción y botón "Reintentar".
- `MatrixTopicsBar`: chips editables inline. Quitar un tema en uso → confirmación
  "N piezas usan este tema, se les quitará".
- `MatrixItemsTable`: columnas entrega, tipo (badge de color por tipo), tema, título,
  objetivo, icono de producción, badge "Fuera de plan". Orden fijo por fecha. Fila activa
  resaltada. Clic en fila abre `MatrixItemSheet`. Clic en un chip de cupo → `addItem` de ese
  tipo y abre su hoja. Botón "Agregar pieza" con selector de tipo. Acciones por fila:
  duplicar, eliminar. Al aprobar con problemas, las filas afectadas se resaltan y la cabecera
  lista los motivos.
- `MatrixItemSheet` (`sheet.tsx`, lateral en escritorio, inferior en móvil): tipo, tema
  (select de temas de la matriz), objetivo, título, fecha (input date limitado al período),
  copy, guión, estilo visual, hashtags, CTA, casilla "Necesita producción". Cada campo se
  guarda al perder foco con `updateItem` y actualización optimista; en error revierte y muestra
  el mensaje.
- Estado `closed`: todo en solo lectura salvo "Duplicar".

### Perfil del cliente — `ClientMatricesCard`

Componente a **nivel de página** en `clients/[id]/page.tsx`, insertado entre el
`RequirementPanel` y la sección "Pipeline" (no dentro de `RequirementPanel`, cuyo bloque de
matriz/producciones/reuniones se deja intacto; así no hay que atravesar props). Muestra la
matriz del período vigente y la del siguiente, con estado y enlace, o botón "Crear matriz" que
abre `NewMatrixDialog` con el cliente fijo. Se renderiza solo si `canManageMatrices(role)`.

### Guardado y concurrencia

Guardado por campo al perder foco, sin autosave por temporizador. Última escritura gana por
campo. Sin realtime en este bloque; `router.refresh()` tras acciones estructurales (agregar,
borrar, cambiar estado).

## Manejo de errores y casos borde

| Caso | Comportamiento |
|---|---|
| Cliente pausado o inactivo | Se puede crear la matriz; franja de aviso. El vínculo del requerimiento fallará y muestra el motivo del trigger |
| Cliente cambia de plan tras crear la matriz | Cupos recalculados al leer; piezas que ahora exceden aparecen fuera de plan. Nada se borra |
| Ya existe matriz para cliente + período | El diálogo lo detecta antes de guardar y ofrece abrirla. La `unique` es la red de seguridad; su error se traduce a "Ya existe una matriz para ese período" |
| Fecha fuera del período | `updateItem` rechaza; la hoja muestra el rango válido |
| Pieza sin título al aprobar | `setMatrixStatus` devuelve `problems`; la tabla resalta las filas |
| Borrar matriz con requerimiento vinculado con tiempo registrado | Se conserva el requerimiento y se limpia la FK antes de borrar. Confirmación explícita lo advierte |
| Falla el vínculo del requerimiento | La matriz se crea igual; franja con el mensaje real y botón "Reintentar" |
| Duplicar hacia un período de distinto largo | `shiftDeadline` mantiene el día relativo y recorta a `period_end` |
| Ciclo objetivo se crea después que la matriz | `loadMatrixEditorData` lo resuelve por `client_id + period_start` en cada carga; no hace falta guardar `billing_cycle_id` para que funcione. Se actualiza la columna de forma oportunista en la siguiente acción |
| Usuario sin rol | Páginas redirigen; acciones devuelven `{ ok: false, error: 'Sin permisos' }`; RLS bloquea de todas formas |

## Verificación

**Unitarias (vitest, `src/lib/domain/matrix.test.ts` y `weekly-distribution.test.ts`):**

- `computeTargetPeriods`: mensual con clamp a fin de mes (31 ene → 28 feb), quincenal, bimestral, con y sin ciclo vigente.
- `resolveMatrixLimits`: con ciclo (rollover + override), sin ciclo (`estimated`), pool unificado.
- `computeMatrixUsage`: marcado fuera de plan por orden de fecha, con créditos, con pool unificado (contador compartido, historia fuera del pool con límite 0), chips visibles según la regla `limit > 0 || credits > 0 || planned > 0`, piezas convertidas excluidas del conteo planificado.
- `proposeDeadline`: primera semana con hueco, todas llenas → última, recorte a `period_end`, ciclo de 8 semanas con distribución construida con `weeks` de 8 (verifica que S5..S8 reciben presupuesto `ceil(limit/8)`).
- `augmentDistribution` / `applyOverride` / `addRollover` con `weeks` de 8: producen S5..S8; con el default, salida idéntica a la actual (las pruebas existentes no cambian).
- `canTransition` y `validateForApproval`: matriz vacía, pieza sin título, fecha fuera de rango.
- `shiftDeadline`: mismo offset y recorte.
- `buildEffectiveDistribution`: paridad con el cálculo inline previo de `RequirementPanel` (fixture con override y rollover).

**Base de datos:** migración aplicada a mano en el dashboard de Supabase; verificar con un
insert por rol (`admin` ok, `operator` rechazado por RLS) y la `unique` con un duplicado.

**Manual en navegador:** crear matriz desde `/matrices` y desde el perfil del cliente; ver la
franja cuando el vínculo falla y reintentar tras marcar pago; agregar piezas por chip y por
botón; editar en la hoja; ver chips verde y rojo y el badge fuera de plan; intentar aprobar con
una pieza sin título; aprobar; volver a borrador; duplicar a otro período; borrar en borrador;
móvil con hoja inferior. `npm run lint` y `npm run build` limpios antes de commit.

## Orden sugerido para el plan

1. Dominio puro con pruebas (`matrix.ts`, extensión de `weekly-distribution.ts`).
2. Migración `0129` + tipos en `db.ts` + `canManageMatrices`.
3. Carga de datos y server actions.
4. UI: lista y diálogo → editor → tarjeta del cliente → menú.
5. Verificación manual, lint, build.

## Fuera de alcance (este bloque)

- Conversión a requerimientos, barrido diario, cierre automático (bloque 2).
- Generación con IA, perfil de marca, etiqueta de producción propuesta (bloque 3).
- Portal del cliente (ver o aprobar matriz), exportar a PDF o Excel, agrupar piezas en una producción, tiempo real en el editor, acceso de operadores, red social / referencias / historia / responsable por pieza.

## Desviaciones implementadas (2026-09-17)

Diferencias entre el texto de este diseño y lo que quedó en la rama `feat/creador-matrices-bloque-1`,
verificadas contra el código. Donde chocan, manda esta sección.

**Migración `0129`**

- Índices del vínculo a requerimientos **únicos** parciales: `content_matrices_matrix_requirement_uq`
  (a lo sumo una matriz por requerimiento de matriz) y `content_matrix_items_requirement_uq` (a lo
  sumo una pieza por requerimiento convertido).
- Columnas reservadas para el bloque 2 en `content_matrix_items`: `blocked_reason text` y
  `converted_at timestamptz` (nulas, sin uso en este bloque).
- Checks de longitud `*_len_chk` con los mismos topes que `MATRIX_TEXT_LIMITS`: título 200, notas y
  copy 5000, guion 10000, estilo visual / hashtags / CTA 2000, tema 60 (tope de `sanitizeTopics`).
  `char_length` cuenta code points y la app mide `.length` (UTF-16), así que la base nunca es más
  estricta que la app.
- Además: `check (jsonb_typeof(topics_json) = 'array')`, `set local lock_timeout = '5s'`, sin
  `content_matrices_client_idx` (lo cubre el único `(client_id, period_start)`) y una sola policy
  `for all` por tabla en vez de cuatro (misma condición admin/supervisor).

**Dominio (`matrix.ts`)**

- `resolveMatrixLimits` con ciclo: `credits` = créditos restantes **más** los consumidos por
  requerimientos del ciclo que cuentan en `computeTotals` (no anulados, no arrastrados, con
  `paid_from_credit_id`): 1 unidad del `content_type` del requerimiento (lo que consume
  `consumeContentCreditForRequirement`), solo si ese tipo sigue contando en su consumo. Sin esto, la
  pieza pagada con crédito contaba como usada y su crédito desaparecía del cupo, marcando "fuera de
  plan" de más; también corrige el pool unificado. Sin ciclo, los créditos no cambian.
- `MatrixUsage.overPlanItemIds` es `string[]` (no `Set`: cruza la frontera server → client);
  `MatrixUsage.pool` incluye `credits` y `activeTypes` vive en `MatrixUsage`.
- Orden canónico `compareMatrixItems`: `deadline` → `created_at` (numérico) → `id`, igual en servidor y cliente.
- `proposeDeadline` acepta `today` (no propone semanas ya cerradas ni fechas pasadas) y `sharedTypes`
  (los tippables bajo pool comparten el conteo semanal).
- `pickCycleForPeriod`: si varios ciclos comparten `period_start`, gana current > pending_renewal >
  scheduled > archived y, a igual estado, el `created_at` más reciente.
- `MATRIX_TEXT_LIMITS` se aplica en tres capas: `maxLength` en la UI, validación en las server
  actions y checks en la base.

**Server actions**

- Solo clientes `active`/`paused`/`overdue` reciben una matriz nueva (`canCreateMatrixForClient`); los
  `inactive_payment`/`inactive_manual` no (la tabla de casos borde permitía crear y avisar). Se filtra
  en la UI y se revalida en `createMatrix`/`duplicateMatrix`.
- `deleteMatrix` borra **primero** la matriz en borrador (condicional a `status = 'draft'`; las piezas
  caen por cascade) y después intenta limpiar el requerimiento vinculado. Lo conserva si tiene
  cualquier fila dependiente (`time_entries`, `requirement_messages`, `review_assets`,
  `requirement_cambio_logs`, `ai_jobs`), dejó la fase `pendiente`, se pagó con crédito, ya no es
  `matriz_contenido` o su ciclo no es `current`.
- El requerimiento de matriz se inserta con `requested_via = 'staff'`. El vínculo es a prueba de
  carrera (`update … is('matrix_requirement_id', null)`) y borra el requerimiento propio si pierde.
- Vínculo anulado: si el requerimiento vinculado está anulado (o ya no existe), `linkMatrixRequirement`
  suelta el vínculo con un update condicional y registra uno nuevo. El editor muestra "El requerimiento
  de matriz vinculado fue anulado." con "Reintentar" (salvo matriz cerrada). `retryMatrixRequirementLink`
  rechaza matrices cerradas.
- Quitar temas suelta las piezas por `id`, no con `.in('topic', …)` (postgrest-js no escapa comillas).
- Los guardados por campo (`updateItem`, y `updateMatrix` salvo el título) no llaman `revalidatePath`:
  en Next 16 re-renderiza la página actual completa.

**UI**

- El editor nunca llama `router.refresh()` (la spec lo pedía tras acciones estructurales): estado local
  inicializado desde props, aplica la fila que devuelve cada acción.
- Un guardado de texto fallido conserva lo escrito ("· sin guardar"), con franja "Hay cambios sin
  guardar" + "Descartar cambios sin guardar" y aviso `beforeunload`.
- El motivo de un vínculo fallido al crear o duplicar llega al editor por `sessionStorage`
  (`matrixLinkError.ts`), no "en memoria de la última acción".
- `/matrices` lista matrices con `period_start` de los últimos 365 días (tope 1000 filas, con aviso si
  se trunca).
- `/matrices/[id]` redirige a `/matrices` si el id no es un UUID o la matriz no existe.

### Pendiente para bloques 2–3

- RPC atómica de insertar matriz + vincular requerimiento: hoy son dos viajes, así que una matriz puede
  quedar sin vínculo y se reintenta a mano.
- La matriz se cruza con su ciclo y los períodos se validan por `period_start` **exacto**: una renovación
  anclada a la fecha de hoy o un cambio de `billing_period` desalinean los períodos (cupos estimados,
  período inválido).
- Relleno oportunista de `content_matrices.billing_cycle_id` no implementado (nada depende de la
  columna todavía).
- El editor no se resincroniza desde el servidor; la conversión (bloque 2) y la IA (bloque 3) van a
  necesitar refresco o realtime.
- Ciclos quincenales usan la distribución de 4 semanas sobre ~14 días: las semanas 3–4 caen después de
  `period_end` y las fechas propuestas se amontonan al final del período.
- Quitar temas no es atómico: soltar las piezas y guardar `topics_json` son dos escrituras.
