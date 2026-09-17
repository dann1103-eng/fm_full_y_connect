# Creador de matrices · Bloque 2: conversión automática a requerimientos — Diseño

**Fecha:** 2026-09-17 · **Revisión:** 2 (tras revisión de spec: rollback con cliente de servicio, pool unificado en `over_limit`, filtro de matrices aprobadas en el barrido, guarda de `voided` al replanificar, regla exacta del aviso de ciclo, duplicado copia responsable/estimado)
**Estado:** Aprobado en diseño — pendiente de plan de implementación

## Contexto

El bloque 1 (en producción desde 2026-09-17, migración `0129`) dejó las matrices de contenido
dentro del CRM: `content_matrices` (una por cliente y período objetivo, estados
`draft`/`approved`/`closed`) y `content_matrix_items` (las piezas planificadas). Hoy la matriz
se aprueba y ahí se queda: alguien sigue teniendo que registrar los requerimientos a mano.

Este bloque cierra ese hueco. Una pieza de una matriz aprobada se convierte sola en
requerimiento del pipeline `lead_days` antes de su fecha de entrega.

Campos que el bloque 1 dejó reservados y que aquí empiezan a usarse:
`content_matrix_items.status` (`planned`/`converted`/`blocked`), `requirement_id`,
`blocked_reason`, `converted_at`, y `content_matrices.lead_days` (default 7).

Lee también la sección "Desviaciones implementadas" y "Pendiente para bloques 2–3" del spec del
bloque 1 (`docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md`): manda
sobre el texto original de aquel documento.

## Decisiones tomadas

Todas confirmadas por el usuario en el diseño; no volver a preguntarlas.

| Decisión | Elección | Motivo |
|---|---|---|
| Registro bloqueado por impago | **Pieza `blocked` + aviso, SIN reintento automático**; se destraba con "Convertir ahora" | El usuario no quiere que una pieza entre sola al pipeline días después sin que nadie lo mire |
| Ciclo destino | **Siempre el ciclo `current` del cliente** al momento de convertir | Decisión explícita del usuario sobre emparejar por fecha de entrega |
| Responsable y tiempo estimado | **Se eligen por pieza en la matriz** | La matriz planifica también el quién y el cuánto |
| Obligatoriedad | **Ambos obligatorios para aprobar la matriz** | Todo requerimiento nace asignado y estimado |
| Brief en el pipeline | **Sección "Brief de la matriz" en la ficha del requerimiento**, leída en vivo de la pieza | Sin duplicar texto: corregir el guion en la matriz se ve en el pipeline |
| Edición tras convertir | **Textos editables** (tema, objetivo, copy, guion, estilo visual, hashtags, CTA); tipo, fecha, responsable y estimado fijos | Esos cuatro ya viven en el requerimiento; dos fuentes de verdad serían un bug |
| `needs_production` | **No dispara nada en este bloque** | Se retoma después |
| Requerimiento anulado | La pieza sigue `converted` con aviso + botón **"Volver a planificar"** | Evita que una pieza anulada a propósito reaparezca sola |
| `lead_days` | **Editable en la cabecera de la matriz** (0–30, default 7) | La columna ya existe; cubre "este cliente necesita más aire" |
| Pieza fuera de cupo | Se convierte marcada `over_limit`, **sin consumir créditos** | Gastar un crédito comprado es decisión de plata |
| Dónde corre el barrido | **Ruta Next + cron de Vercel** | Puede reusar el dominio (`matrix.ts`, `plans.ts`); el Edge Function corre en Deno y no importa `src/` |

## Modelo de datos

### Migración `0130_matrix_items_assignment.sql`

```sql
begin;
set local lock_timeout = '5s';

alter table public.content_matrix_items
  add column if not exists assigned_to uuid[],
  add column if not exists estimated_time_minutes integer;

-- Constraint con nombre explícito (convención de 0129), idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_matrix_items_est_minutes_chk'
      and conrelid = 'public.content_matrix_items'::regclass
  ) then
    alter table public.content_matrix_items
      add constraint content_matrix_items_est_minutes_chk
      check (estimated_time_minutes is null or estimated_time_minutes between 1 and 10080);
  end if;
end $$;

commit;
```

`assigned_to` replica el tipo de `requirements.assigned_to` (array de uuid, sin FK, igual que
allí). No se añade índice: nada filtra piezas por responsable en este bloque.

Nada más cambia en el esquema: `status`, `requirement_id`, `blocked_reason`, `converted_at` y
`lead_days` ya existen desde `0129`, con el índice único parcial
`content_matrix_items_requirement_uq` que garantiza una pieza por requerimiento y el índice
parcial `content_matrix_items_planned_idx (deadline) where status = 'planned'` que sirve
exactamente al query del barrido.

Tipos en `src/types/db.ts`: `assigned_to: string[] | null` y `estimated_time_minutes: number | null`
en Row/Insert/Update de `content_matrix_items`.

## Estados de una pieza

```
planned ──(barrido o "Convertir ahora", éxito)──> converted
   │
   └──(barrido o "Convertir ahora", fallo)──────> blocked ──("Convertir ahora", éxito)──> converted

converted ──("Volver a planificar")──> planned     (suelta requirement_id/converted_at)
```

- **`planned`** — estado inicial. Es el único que mira el barrido.
- **`converted`** — tiene `requirement_id` y `converted_at`. Textos editables; tipo, fecha,
  responsable y estimado bloqueados.
- **`blocked`** — el intento falló; `blocked_reason` guarda el mensaje textual. **El barrido no la
  vuelve a mirar**: solo sale con "Convertir ahora".

"Requerimiento anulado" **no es un estado**: se detecta al leer (`requirements.voided`) y se
muestra como aviso sobre una pieza `converted`.

## Selección de piezas — dominio puro

En `src/lib/domain/matrix.ts` (junto al resto de la lógica del bloque 1), con pruebas en
`matrix.test.ts`:

```ts
export interface ConvertibleItem {
  id: string
  matrix_id: string
  deadline: DateString
  status: MatrixItemStatus
}

export interface ConvertibleMatrix {
  id: string
  status: MatrixStatus
  lead_days: number
}

/** ¿Toca convertir esta pieza hoy? Solo piezas `planned` de matrices `approved`. */
export function shouldConvert(
  item: Pick<ConvertibleItem, 'status' | 'deadline'>,
  matrix: Pick<ConvertibleMatrix, 'status' | 'lead_days'>,
  today: DateString,
): boolean

/** Piezas elegibles ordenadas por fecha de entrega (las más urgentes primero). */
export function selectItemsToConvert<T extends ConvertibleItem>(
  items: T[],
  matrices: Map<string, ConvertibleMatrix>,
  today: DateString,
  limit?: number,
): T[]
```

Regla: `matrix.status === 'approved'` && `item.status === 'planned'` &&
`item.deadline <= addDaysString(today, matrix.lead_days)` && `item.deadline >= addDaysString(today, -CATCHUP_DAYS)`
(`CATCHUP_DAYS = 30`). **Las fechas vencidas entran hasta 30 días atrás** (matriz aprobada tarde,
cron caído un par de días); más viejas que eso solo se convierten a mano con "Convertir ahora", para
que una matriz olvidada de hace meses no vuelque trabajo antiguo al pipeline. Orden por `deadline`,
desempate con `compareMatrixItems` (el orden canónico del bloque 1).

Este diseño hace el barrido idempotente por construcción: no depende de "ayer corrió o no".

## Conversión — núcleo compartido

`src/lib/data/matrix-convert.ts`. Una sola función usada por el cron (cliente admin) y por la
acción manual (cliente autenticado), porque el trigger de pago vive en la base y aplica a ambos:

```ts
export type ConvertOutcome =
  | { kind: 'converted'; requirementId: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'skipped'; reason: string }   // ya no está `planned`/`blocked`: otro proceso ganó

export async function convertMatrixItem(
  db: Db,            // cliente que inserta: admin en el cron, autenticado en la acción manual
  itemId: string,
  opts?: {
    /** Quién queda como `registered_by_user_id`. Default: `matrix.approved_by ?? matrix.created_by`. */
    registeredByUserId?: string
    /** Requerimientos del ciclo ya leídos en esta corrida, para no releerlos por pieza. */
    cycleRequirementsCache?: Map<string, Requirement[]>
  },
): Promise<ConvertOutcome>
```

**Quién registra:** el núcleo resuelve `registered_by_user_id` internamente como
`opts.registeredByUserId ?? matrix.approved_by ?? matrix.created_by`. El cron no pasa nada (queda
atribuido a quien aprobó la matriz); `convertItemNow` pasa el `auth.uid()` de quien pulsa el botón.

**Rollback y borrados van SIEMPRE con `createAdminClient()`**, nunca con el cliente autenticado:
`requirements` tiene RLS y **no existe policy `for delete`**, así que un `.delete()` autenticado
devuelve 0 filas sin error y dejaría un requerimiento huérfano consumiendo cupo. Es el mismo motivo
por el que `discardUnlinkedRequirement` (bloque 1) usa el cliente admin.
`requirement_phase_logs.requirement_id` es `ON DELETE CASCADE` (migración 0002), así que basta con
borrar el requerimiento.

Pasos, en orden:

1. **Leer** la pieza con su matriz (`content_matrix_items` + join a `content_matrices`). Si la
   pieza no está en `planned` ni `blocked`, o la matriz no está `approved` → `skipped`.
2. **Ciclo vigente** del cliente (`status='current'`, el más reciente por `created_at` si hay
   varios — reusa `loadCurrentCycle` del bloque 1). Si no hay → `blocked` con
   `'El cliente no tiene ciclo vigente.'`
3. **Fuera de cupo**: misma cadena que usan todos los caminos de registro —
   `effectiveLimits(snapshot, rollover)` → `applyContentLimitsWithOverride(override del ciclo)` →
   **`applyUnifiedPool(limits, snapshot, totals)`** — contra `computeTotals(requirements del ciclo)`.
   El paso del pool es obligatorio: sin él, en un plan con pool unificado los límites por tipo de los
   tippables valen 0 en el snapshot y **toda** pieza nacería `over_limit: true`.
   Si `totals[content_type] >= limits[content_type]` → `over_limit: true`.
   **No se consumen ni se leen créditos.** Consecuencia aceptada y documentada: una pieza que el
   editor muestra dentro de plan porque hay un crédito comprado nace marcada fuera de cupo; aplicar
   el crédito sigue siendo una acción manual del admin (que además limpia la marca, como hoy).
4. **Insertar el requerimiento**:

   | Campo | Valor |
   |---|---|
   | `billing_cycle_id` | ciclo vigente |
   | `content_type` | el de la pieza |
   | `title` | el de la pieza |
   | `deadline` | el de la pieza (puede quedar vencido si la matriz se aprobó tarde: se ve rojo en el pipeline, que es lo correcto) |
   | `assigned_to` | el de la pieza |
   | `estimated_time_minutes` | el de la pieza |
   | `registered_by_user_id` | `matrix.approved_by ?? matrix.created_by` |
   | `priority` | `'media'` |
   | `over_limit` | del paso 3 |
   | `approval_status` | `'approved'` |
   | `includes_story` | `false` |
   | `requested_via` | `'staff'` |
   | `notes` | `null` — el brief se lee en vivo de la pieza |

5. **Log inicial de fase** con `insertInitialPhaseLog` (fase `pendiente`), igual que el registro manual.
6. **Marcar la pieza** con un update condicional:
   `update … set status='converted', requirement_id, converted_at=now(), blocked_reason=null
   where id = :id and status in ('planned','blocked')`, pidiendo la fila de vuelta.
   Si vuelven **0 filas** (otro proceso ganó), **deshacer con el cliente admin**: borrar el
   requerimiento recién creado (sus `requirement_phase_logs` caen por cascade) y devolver `skipped`.
7. **Si el insert del paso 4 falla** → `blocked`, guardando `error.message` tal cual (los mensajes
   del trigger `requirements_check_week_payment_trg` ya vienen en español: "Cliente X suspendido
   por falta de pago", "No se puede registrar requerimientos en la semana 3 sin el pago
   correspondiente"), recortado a 500 caracteres. Se escribe con
   `update … set status='blocked', blocked_reason=… where id=:id and status in ('planned','blocked')`.

Errores de lectura (pasos 1–3) se propagan como `blocked` solo cuando son del negocio (sin ciclo);
un fallo de red o de base devuelve `skipped` con el mensaje, para no marcar como bloqueada una
pieza por un problema transitorio. El barrido cuenta esos casos aparte y los deja para el día siguiente.

## El barrido — ruta con cron

`src/app/api/matrices/convert/route.ts`, calcado del patrón de
`src/app/api/billing/due-reminders/route.ts`:

- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.
- Auth: `Authorization: Bearer <CRON_SECRET>` (lo manda Vercel Cron) **o** header
  `x-trigger-secret` con `AI_JOBS_TRIGGER_SECRET`. Nunca por query param.
- `GET` y `POST` (Vercel Cron manda GET; `GET` delega en `POST`).
- Query: piezas `status='planned'` **cuya matriz esté `approved`** — el filtro va en SQL, con embed
  `matrix:content_matrices!inner(id, status, lead_days, client_id, period_start, approved_by, created_by)`
  y `.eq('matrix.status', 'approved')` — con `deadline` entre `today - 30` y `today + 30` (30 = tope
  de `lead_days`), ordenadas por `deadline`, tope 300 filas leídas. Sin el filtro de matriz en SQL,
  las piezas viejas de matrices en borrador abandonadas o cerradas se acumulan en la cabeza del
  ranking y, pasadas 300, el cron dejaría de encontrar piezas convertibles sin dar error.
  Sobre esas filas se aplica `selectItemsToConvert` con el `lead_days` real de cada matriz.
- Procesa **secuencialmente**, tope **80 conversiones por corrida** (cada conversión son 4–6
  viajes a la base; en paralelo se pisarían los cálculos de cupo del mismo ciclo, y con 200 el lote
  no cabe en los 60 s de `maxDuration`). Los requerimientos de cada ciclo se leen **una vez por
  corrida** y se cachean por `billing_cycle_id`, actualizando el caché con cada requerimiento
  insertado para que el cálculo de cupo de la pieza siguiente del mismo cliente sea correcto.
  Lo que no entra en una corrida entra al día siguiente.
- Responde `{ ok, today, scanned, converted, blocked, skipped, details }` y loguea un resumen.
  `details` se limita a los primeros 50 para no inflar el log.
- `vercel.json`: `{"path": "/api/matrices/convert", "schedule": "0 12 * * *"}` → 6:00 AM en
  El Salvador (GMT-6), antes de que entre el equipo. No colisiona con los crons existentes
  (`* * * * *` de ai-jobs y `0 15 * * *` de due-reminders).

## Server actions

En `src/app/actions/matrices.ts` (mismo `requireManager` que el resto del bloque 1):

| Acción | Qué hace |
|---|---|
| `convertItemNow(itemId)` | Llama `convertMatrixItem` con el **cliente autenticado** y `registeredByUserId = auth.uid()`. Acepta piezas `planned` y `blocked`. Devuelve el resultado tal cual para que el editor muestre el motivo si vuelve a bloquearse |
| `replanItem(itemId)` | "Volver a planificar": `status='planned'`, `requirement_id=null`, `converted_at=null`, `blocked_reason=null`, condicionado a `status='converted'`. **No borra ni anula el requerimiento.** Antes de escribir **relee el requerimiento vinculado y exige que no exista o esté `voided`**; si sigue vivo devuelve "El requerimiento sigue activo: anúlalo primero en el pipeline." Sin esa guarda, el barrido de la mañana siguiente crearía un **segundo** requerimiento para la misma pieza (el índice único no lo ataja, porque el id nuevo es distinto). **Replanificar implica reconversión automática**: la pieza vuelve a `planned` con su fecha original, que por definición ya está dentro de la ventana, así que el próximo barrido la convierte de nuevo. Es lo buscado (la anulación fue un descarte del requerimiento, no de la pieza) y el botón lo dice: "Volver a planificar (se convertirá de nuevo)" |
| `updateMatrix` (existente) | Acepta `lead_days` (ya validado 0–30 en el bloque 1) |
| `updateItem` (existente) | Cambia: hoy rechaza piezas `converted`. Pasa a permitir los campos de texto (`topic`, `objective`, `copy`, `script`, `visual_style`, `hashtags`, `cta`) y a rechazar `content_type`, `deadline`, `assigned_to`, `estimated_time_minutes` en piezas `converted`, con mensaje explícito |
| `addItem` (existente) | Pre-selecciona en `assigned_to` los usuarios con `users.default_assignee = true`, igual que `RequirementModal`. `estimated_time_minutes` nace vacío |
| `deleteItem` (existente) | Sigue rechazando `converted` (hay que volver a planificar primero) |
| `duplicateItem` y `duplicateMatrix` (existentes) | **Copian `assigned_to` y `estimated_time_minutes`.** Ambos arman el insert con columnas explícitas: sin este cambio, duplicar una matriz al período siguiente — su caso de uso principal — produciría una matriz que no se puede aprobar hasta rellenar dos campos por pieza a mano. Las piezas duplicadas nacen `planned`, sin `requirement_id`, `converted_at` ni `blocked_reason` (ya es así) |

## Validación al aprobar

`validateForApproval` (dominio, bloque 1) gana dos motivos nuevos:
`'sin_responsable'` y `'sin_estimado'`, con etiquetas "Sin responsable" y "Sin tiempo estimado" en
`APPROVAL_PROBLEM_LABELS`. Una pieza reporta **un solo** problema (el primero), como hoy.

Dos precisiones obligatorias:

- **Solo se evalúan piezas `planned` y `blocked`.** Una pieza `converted` tiene esos campos
  bloqueados en el editor; exigirle responsable produciría un problema imposible de arreglar.
- `setMatrixStatus` hoy selecciona `id, title, deadline, status` para validar: hay que **añadir
  `assigned_to` y `estimated_time_minutes` a ese select**, y lo mismo en el recálculo en vivo que
  hace el editor tras un intento de aprobación fallido.

Las matrices aprobadas **antes** de esta migración pueden tener piezas sin responsable: no se
migran ni se bloquean. Si esa pieza se convierte, el requerimiento nace sin responsable y sin
estimado, exactamente como un requerimiento tomado por el equipo. La validación solo corre al
aprobar, así que no rompe nada existente.

## Interfaz

- **Panel lateral de la pieza** (`MatrixItemSheet`): dos campos nuevos arriba, responsable
  (multi-selección de usuarios internos, reusando el patrón de checkboxes de `RequirementModal`) y
  tiempo estimado (horas + minutos, mismo patrón del modal). Hoy el panel entero es de solo lectura
  cuando la pieza está `converted` (`MatrixEditor` pasa
  `readOnly={readOnly || selected?.status === 'converted'}`): ese blanket se sustituye por
  **deshabilitado campo por campo** — tipo, fecha, responsable y estimado bloqueados con la nota
  "Ya convertida: edítalo en el requerimiento", textos editables.
- **Usuarios asignables**: `loadMatrixEditorData` no los carga hoy. Se añaden al loader (o a
  `/matrices/[id]/page.tsx`) con el mismo query que usan `clients/[id]/page.tsx` y `pipeline/page.tsx`
  (`users` sin `client`/`agent`, con `default_assignee`).
- **Tabla de piezas**: columna de estado con distintivo (Planificada / Convertida / Bloqueada),
  enlace al requerimiento en las convertidas, y en las bloqueadas el motivo recortado con botón
  "Convertir ahora". Las convertidas cuyo requerimiento esté `voided` muestran "Requerimiento
  anulado" + "Volver a planificar".
- **Cabecera de la matriz**: campo de anticipación (`lead_days`) y contadores
  "N por convertir · N bloqueadas".
- **Aviso de ciclo**: la fila muestra una advertencia discreta cuando
  **`addDaysString(item.deadline, -matrix.lead_days) < matrix.period_start`**, es decir cuando la
  pieza se convertirá *antes* de que empiece el período de la matriz y por lo tanto consumirá el
  cupo del ciclo anterior. Es una comparación de cadenas de fecha, pura, y se calcula en el
  dominio (`convertsBeforePeriodStart(item, matrix)`) con prueba unitaria. No aparece en los demás
  casos: para una matriz del período vigente o para piezas cuya conversión cae dentro del período,
  no hay nada que advertir. Es la consecuencia aceptada de "siempre al ciclo vigente".
- **Chips de cupo con piezas convertidas a otro ciclo**: `computeMatrixUsage` excluye del conteo
  planificado a las `converted` porque asume que ya están dentro de `cycleTotals`, y
  `loadMatrixEditorData` solo lee los requerimientos del ciclo del período de la matriz. Una pieza
  convertida al ciclo anterior desaparecería de los dos lados. Para evitarlo, el loader calcula
  `convertedInCycleIds` (piezas cuyo `requirement_id` aparece entre los requerimientos del ciclo
  leído) y `computeMatrixUsage` recibe ese conjunto: las `converted` que **no** están en él se
  siguen contando como planificadas, así el chip nunca subestima el consumo del mes.
- **Ficha del requerimiento** (`PhaseSheet`): sección "Brief de la matriz" — tema, objetivo, copy,
  guion, estilo visual, hashtags, CTA — leída de la pieza vinculada (`content_matrix_items` por
  `requirement_id`), con enlace a la matriz. Solo admin y supervisor la ven, porque la RLS de
  `content_matrix_items` es de ellos; para un operador la sección simplemente no aparece (la query
  devuelve 0 filas, no error). **Nota:** el portal del cliente no la muestra.
- **Lista `/matrices`**: columna "Convertidas" (`8 / 14`) y distintivo de bloqueadas.
- **Notificaciones** (`/api/notifications`, derivadas, sin tabla): nuevo `kind: 'matrix_blocked'`
  para admin y supervisor, una entrada por matriz con piezas bloqueadas, con nombre del cliente,
  cantidad y enlace a `/matrices/[id]`. Toca además el union de `kind` y los campos en
  `src/types/db.ts`, `NotificationsDropdown.tsx` (render + destino del clic) y `useNotifications.ts`
  (conteo). Como todas las derivadas, nace `read: false` y **no se puede marcar leída**: la campana
  insiste hasta que alguien destrabe o replanifique la pieza. Es el comportamiento buscado, igual
  que `cambio_pending`.

## Manejo de errores y casos borde

| Caso | Comportamiento |
|---|---|
| Cliente suspendido / semana impaga | El trigger rechaza el insert → pieza `blocked` con el mensaje del trigger |
| Sin ciclo vigente | `blocked` con "El cliente no tiene ciclo vigente." |
| Matriz cerrada con piezas `planned` | El barrido la ignora; el editor lo indica |
| Matriz vuelta a borrador | Solo posible si no hay `converted` (regla del bloque 1). Si tenía piezas `blocked`, "Convertir ahora" también falla mientras la matriz no esté `approved`: el mensaje lo dice ("La matriz no está aprobada.") |
| Pieza vencida hace más de 30 días | El barrido no la toca (`CATCHUP_DAYS`); queda `planned` y solo se convierte con "Convertir ahora" |
| Borrar pieza convertida | Rechazado: primero "Volver a planificar" |
| Borrar matriz | Solo en borrador (regla del bloque 1); una matriz con convertidas no está en borrador |
| Cron no corre un día | Sin pérdida: la ventana es "≤ anticipación", no un día exacto |
| Doble ejecución / doble clic | Update condicional + índice único; el perdedor borra su requerimiento y devuelve `skipped` |
| Fallo transitorio de red o base | `skipped`, no `blocked`: se reintenta al día siguiente |
| Pieza fuera de cupo | Convierte con `over_limit: true`, sin tocar créditos |
| Requerimiento anulado luego | La pieza sigue `converted` + aviso + "Volver a planificar" |
| Editor abierto mientras corre el barrido | No se resincroniza solo (limitación conocida del bloque 1); al recargar se ve |

## Verificación

**Unitarias (vitest, `src/lib/domain/matrix.test.ts`):**

- `shouldConvert`: dentro de la ventana, justo en el borde (`deadline == today + lead_days`),
  fuera, vencida dentro de los 30 días de gracia, vencida hace más de 30 (no entra), matriz
  `draft`/`closed`, pieza `converted`/`blocked`.
- `selectItemsToConvert`: orden por fecha, desempate canónico, tope, `lead_days` distintos por
  matriz, matrices ausentes del mapa.
- `convertsBeforePeriodStart`: pieza al inicio del período con anticipación de 7 (avisa), pieza a
  mitad de período (no avisa), `lead_days = 0` (no avisa).
- `validateForApproval`: nuevos motivos, exención de piezas `converted`, prioridad de un solo
  problema por pieza.
- `computeMatrixUsage` con `convertedInCycleIds`: una pieza convertida al ciclo del período no se
  cuenta como planificada; una convertida a otro ciclo sí.

**Manual en el navegador** (con la migración 0130 aplicada):

1. Matriz aprobada con una pieza a menos de 7 días → llamar la ruta del cron con el secret →
   aparece el requerimiento en Pendiente, con responsable, estimado y fecha; la fila queda
   "Convertida" con enlace.
2. Abrir la ficha del requerimiento en el pipeline: se ve "Brief de la matriz". Cambiar el guion
   en la matriz y recargar: el brief cambió.
3. Cliente con la semana impaga → la pieza queda "Bloqueada" con el mensaje del trigger, sale el
   aviso en la campana, y "Convertir ahora" muestra el mismo motivo. Marcar el pago y volver a
   pulsar: convierte.
4. Anular el requerimiento → la pieza muestra "Requerimiento anulado" y "Volver a planificar"
   la devuelve a Planificada.
5. Intentar aprobar una matriz con una pieza sin responsable: la lista de problemas lo marca.
6. Correr la ruta dos veces seguidas: la segunda no crea nada (`skipped`).

**Antes de desplegar:** aplicar `0130` en el Dashboard de Supabase. Sin ella, el editor y las
acciones fallan al leer `assigned_to`; con ella y sin desplegar, nada se rompe (columnas nuevas
nullable).

## Fuera de alcance

- `needs_production` no dispara nada (ni requerimiento de producción, ni aviso).
- Sin reintento automático de piezas bloqueadas.
- El editor abierto no se refresca solo cuando corre el barrido.
- El portal del cliente no ve el brief ni las matrices.
- Agrupar piezas en una producción, exportar la matriz, IA (bloque 3).
