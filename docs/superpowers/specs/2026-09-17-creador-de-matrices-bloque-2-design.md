# Creador de matrices · Bloque 2: conversión automática a requerimientos — Diseño

**Fecha:** 2026-09-17 · **Revisión:** 1
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
alter table public.content_matrix_items
  add column if not exists assigned_to uuid[],
  add column if not exists estimated_time_minutes integer
    check (estimated_time_minutes is null or estimated_time_minutes between 1 and 10080);
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
`item.deadline <= addDaysString(today, matrix.lead_days)`. **Las fechas ya vencidas entran**
(matriz aprobada tarde, cron caído): no hay piso. Orden por `deadline`, desempate con
`compareMatrixItems` (el orden canónico del bloque 1).

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
  db: Db,
  itemId: string,
  ctx: { registeredByUserId: string },
): Promise<ConvertOutcome>
```

Pasos, en orden:

1. **Leer** la pieza con su matriz (`content_matrix_items` + join a `content_matrices`). Si la
   pieza no está en `planned` ni `blocked`, o la matriz no está `approved` → `skipped`.
2. **Ciclo vigente** del cliente (`status='current'`, el más reciente por `created_at` si hay
   varios — reusa `loadCurrentCycle` del bloque 1). Si no hay → `blocked` con
   `'El cliente no tiene ciclo vigente.'`
3. **Fuera de cupo**: `effectiveLimits(snapshot, rollover)` + `applyContentLimitsWithOverride`
   contra `computeTotals(requirements del ciclo)`. Si sumar la pieza excede el límite de su
   `content_type` → `over_limit: true`. **No se consumen créditos** (ni se leen).
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
   Si vuelven **0 filas** (otro proceso ganó), **deshacer**: borrar `requirement_phase_logs` y el
   requerimiento recién creado, y devolver `skipped`.
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
- Query: piezas `status='planned'` con `deadline <= today + 30` (30 = tope de `lead_days`, cota
  barata en SQL) y su matriz `approved`, ordenadas por `deadline`, tope 300 filas leídas. Sobre
  esas se aplica `selectItemsToConvert` con el `lead_days` real de cada matriz y un tope de
  **200 conversiones por corrida**.
- Procesa **secuencialmente** (cada conversión son 4–6 queries; en paralelo se pisarían los
  cálculos de cupo del mismo ciclo).
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
| `replanItem(itemId)` | "Volver a planificar": `status='planned'`, `requirement_id=null`, `converted_at=null`, `blocked_reason=null`, condicionado a `status='converted'`. **No borra ni anula el requerimiento** — eso ya lo hizo (o no) un humano en el pipeline |
| `updateMatrix` (existente) | Acepta `lead_days` (ya validado 0–30 en el bloque 1) |
| `updateItem` (existente) | Cambia: hoy rechaza piezas `converted`. Pasa a permitir los campos de texto (`topic`, `objective`, `copy`, `script`, `visual_style`, `hashtags`, `cta`) y a rechazar `content_type`, `deadline`, `assigned_to`, `estimated_time_minutes` en piezas `converted`, con mensaje explícito |
| `addItem` / `deleteItem` (existentes) | `deleteItem` sigue rechazando `converted` (hay que volver a planificar primero) |

## Validación al aprobar

`validateForApproval` (dominio, bloque 1) gana dos motivos nuevos:
`'sin_responsable'` y `'sin_estimado'`, con etiquetas "Sin responsable" y "Sin tiempo estimado" en
`APPROVAL_PROBLEM_LABELS`. Una pieza reporta **un solo** problema (el primero), como hoy.

Las matrices aprobadas **antes** de esta migración pueden tener piezas sin responsable: no se
migran ni se bloquean. Si esa pieza se convierte, el requerimiento nace sin responsable y sin
estimado, exactamente como un requerimiento tomado por el equipo. La validación solo corre al
aprobar, así que no rompe nada existente.

## Interfaz

- **Panel lateral de la pieza** (`MatrixItemSheet`): dos campos nuevos arriba, responsable
  (multi-selección de usuarios internos, reusando la lista que ya recibe `RequirementModal`) y
  tiempo estimado (horas + minutos, mismo patrón del modal). En piezas `converted` estos dos,
  el tipo y la fecha quedan deshabilitados con una nota "Ya convertida: edítalo en el requerimiento".
- **Tabla de piezas**: columna de estado con distintivo (Planificada / Convertida / Bloqueada),
  enlace al requerimiento en las convertidas, y en las bloqueadas el motivo recortado con botón
  "Convertir ahora". Las convertidas cuyo requerimiento esté `voided` muestran "Requerimiento
  anulado" + "Volver a planificar".
- **Cabecera de la matriz**: campo de anticipación (`lead_days`) y contadores
  "N por convertir · N bloqueadas".
- **Aviso de ciclo**: si la fecha de entrega de una pieza cae fuera del ciclo que estará vigente al
  convertir (comparando contra el ciclo vigente de hoy), la fila muestra una advertencia discreta:
  el requerimiento consumirá el cupo del ciclo anterior. Es la consecuencia aceptada de "siempre
  al ciclo vigente".
- **Ficha del requerimiento** (`PhaseSheet`): sección "Brief de la matriz" — tema, objetivo, copy,
  guion, estilo visual, hashtags, CTA — leída de la pieza vinculada (`content_matrix_items` por
  `requirement_id`), con enlace a la matriz. Solo admin y supervisor la ven, porque la RLS de
  `content_matrix_items` es de ellos; para un operador la sección simplemente no aparece (la query
  devuelve 0 filas, no error). **Nota:** el portal del cliente no la muestra.
- **Lista `/matrices`**: columna "Convertidas" (`8 / 14`) y distintivo de bloqueadas.
- **Notificaciones** (`/api/notifications`, derivadas, sin tabla): nuevo `kind: 'matrix_blocked'`
  para admin y supervisor, una entrada por matriz con piezas bloqueadas, con nombre del cliente,
  cantidad y enlace a `/matrices/[id]`.

## Manejo de errores y casos borde

| Caso | Comportamiento |
|---|---|
| Cliente suspendido / semana impaga | El trigger rechaza el insert → pieza `blocked` con el mensaje del trigger |
| Sin ciclo vigente | `blocked` con "El cliente no tiene ciclo vigente." |
| Matriz cerrada con piezas `planned` | El barrido la ignora; el editor lo indica |
| Matriz vuelta a borrador | Ya imposible si hay convertidas (regla del bloque 1) |
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
  fuera, vencida, matriz `draft`/`closed`, pieza `converted`/`blocked`.
- `selectItemsToConvert`: orden por fecha, desempate canónico, tope, `lead_days` distintos por
  matriz, matrices ausentes del mapa.
- `validateForApproval`: nuevos motivos y prioridad de un solo problema por pieza.

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
