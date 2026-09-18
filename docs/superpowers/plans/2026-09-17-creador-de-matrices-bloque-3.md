# Creador de matrices · Bloque 3 (IA) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Goal:** Que un botón "Generar con IA" arme la matriz del mes —temas y piezas con brief completo— dentro del cupo del plan, con progreso en vivo y regeneración por pieza.

**Architecture:** Dos handlers nuevos sobre la cola `ai_jobs` que ya existe: un padre (`matrix_generate`) que planifica y crea las filas de las piezas, y un hijo por pieza (`matrix_item_write`) que redacta el brief. Toda la lógica que se puede probar sin base ni API vive en dominio puro (`src/lib/domain/brand.ts`, `src/lib/domain/matrix-ai.ts`). El editor sondea un route handler para el progreso y fusiona las filas nuevas sin pisar lo que el usuario está escribiendo.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase (Postgres + RLS) · `@anthropic-ai/sdk` · vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md` (revisión 2). **Manda el spec**: si este plan y el spec discrepan, gana el spec y se anota la discrepancia.

**Estado:** Tasks 1–4 completadas (`e643388`, `03c1499`, `d7e2cda`, `6731786`). Desviaciones aceptadas: `person` admite `null` (el perfil se llena campo por campo y un check estricto bloquearía el primer guardado); el loader devuelve `{ profile } | null` para distinguir "sin fila" de "sin migración"; la tarjeta no revierte un guardado fallido, deja el texto y muestra el motivo. El worktree usa una **junction** a `node_modules` del repo padre: antes de borrar el worktree, quitarla con `cmd /c rmdir node_modules` (nunca `rm -rf`, que la recorrería).

**Antes de escribir código:** leer `AGENTS.md` (este no es el Next.js que conocés: leer `node_modules/next/dist/docs/` antes de tocar rutas o acciones) y las secciones de `CLAUDE.md` sobre matrices (bloques 1 y 2) y sobre el runner de IA.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0131_brand_profiles_and_matrix_ai.sql` | Tabla `client_brand_profiles`, columnas de enlace en `ai_jobs`, índices únicos parciales, `content_matrix_items.ai_written_at` |
| `src/types/db.ts` | `ClientBrandProfile`, `ai_jobs` al día (`wa_conversation_id`, `tokens_*`, las dos columnas nuevas), `ai_written_at` en la pieza |
| `src/lib/domain/brand.ts` | `BRAND_TEXT_LIMITS`, `BRAND_PERSONS`, `hasUsableBrandProfile`, `validateBrandPatch` — puro |
| `src/lib/domain/matrix-ai.ts` | `missingByType`, `sanitizeGeneratedPlan`, `sanitizeGeneratedBrief`, `assignDeadlines`, `pendingChildWork` — puro |
| `src/lib/data/brand.ts` | `loadBrandProfile` |
| `src/app/actions/brand.ts` | `updateBrandProfile` (cliente autenticado, `requireManager`) |
| `src/components/clients/ClientBrandProfileCard.tsx` | Formulario del perfil, guardado por campo |
| `src/lib/ai/trigger.ts` | `triggerJobRunner({ max, waitMs })` extraído de sus dos copias |
| `src/lib/ai/matrix/prompts.ts` | Bloque de sistema y esquemas de tool del padre y del hijo |
| `src/lib/ai/handlers/matrixGenerate.ts` | Handler padre |
| `src/lib/ai/handlers/matrixItemWrite.ts` | Handler hijo |
| `src/lib/ai/runner.ts` | Registro de los dos handlers + `RUNNER_BUDGET_MS` |
| `src/app/actions/matrixAi.ts` | `generateMatrix(matrixId)`, `regenerateItem(itemId, instructions)` |
| `src/app/api/matrices/[id]/generation/route.ts` | Progreso para el sondeo |
| `src/hooks/useMatrixGeneration.ts` | Sondeo con abort, pausa por visibilidad y limpieza |
| `src/components/matrices/*` | Botón "Generar con IA", franja de progreso, "Sin redactar", "Regenerar" |

---

## Task 1: Migración 0131 y tipos

**Files:** Create `supabase/migrations/0131_brand_profiles_and_matrix_ai.sql` · Modify `src/types/db.ts`

- [ ] **Paso 1: Escribir la migración**

Seguir al pie de la letra las convenciones de `0129`/`0130`: `begin; set local lock_timeout='5s'; … commit;`, `create table if not exists`, checks **con nombre** (`client_brand_profiles_tone_chk`, etc.), `add column if not exists`, `create index if not exists`. Contenido exacto en la Parte 1 y la Parte 3 del spec: tabla `client_brand_profiles` (con su trigger de `updated_at` como el resto del repo y una sola policy `for all` para `role in ('admin','supervisor')`), `ai_jobs.content_matrix_id` / `content_matrix_item_id` (`on delete cascade`), los dos índices únicos parciales, y `content_matrix_items.ai_written_at`.

Recordar: los largos por elemento de `base_hashtags` y `sample_copies` **no** van en la base (un check no recorre un array sin subconsulta); van en la app. Sí van el `jsonb_typeof = 'array'`, el tope de 5 elementos, el de 15 hashtags y el check de `person`.

- [ ] **Paso 2: Poner al día `src/types/db.ts`**

Agregar `ClientBrandProfile`, `ai_written_at` en el tipo de la pieza, y completar `ai_jobs`: le faltan `wa_conversation_id` y `tokens_input`/`tokens_output`/`tokens_cached` (`invoice_id` **ya está**), más `content_matrix_id` y `content_matrix_item_id`. Tocar Row, Insert y Update donde corresponda.

- [ ] **Paso 3: `npx tsc --noEmit`** — 0 errores.

- [ ] **Paso 4: Commit** — `feat(matrices): migracion 0131 — perfil de marca y enlaces de ai_jobs`

> La migración la aplica el usuario a mano en el Dashboard. **No intentar aplicarla.** Hasta que la aplique, la rama no se despliega.

---

## Task 2: Dominio del perfil de marca

**Files:** Create `src/lib/domain/brand.ts`, `src/lib/domain/brand.test.ts`

- [ ] **Paso 1: Tests primero** (`brand.test.ts`)

Casos: `hasUsableBrandProfile` es `true` solo con `tone`, `audience`, `value_proposition` y `offerings` no vacíos (ojo: espacios en blanco no cuentan); `null` → `false`. `validateBrandPatch` rechaza textos que pasan su tope, `person` fuera de `voseo|tuteo|usted`, más de 15 hashtags, un hashtag de más de 40, más de 5 `sample_copies`, un copy de más de 1000, y valores que no son strings dentro de los arrays (entrada no confiable). Mensajes de error en español.

- [ ] **Paso 2: Verificar que fallan** — `npx vitest run src/lib/domain/brand.test.ts`

- [ ] **Paso 3: Implementar** con la forma de `MATRIX_TEXT_LIMITS` / `validateItemPatch` de `matrix.ts` (mismo estilo de `ActionResult`/mensajes).

- [ ] **Paso 4: Tests en verde.**

- [ ] **Paso 5: Commit** — `feat(matrices): dominio del perfil de marca`

---

## Task 3: Loader y acción del perfil de marca

**Files:** Create `src/lib/data/brand.ts`, `src/app/actions/brand.ts`

- [ ] **Paso 1: `loadBrandProfile(db, clientId): Promise<ClientBrandProfile | null>`** — lanza ante error de consulta (como los loaders de `matrices.ts`), `null` si no hay fila.

- [ ] **Paso 2: `updateBrandProfile(clientId, patch)`** — `requireManager` (copiarlo de `src/app/actions/matrices.ts`), **cliente autenticado** (la tabla tiene policy para admin/supervisor), `validateBrandPatch` antes de escribir, `upsert` por `client_id`, `updated_by_user_id` del usuario autenticado. Devuelve `ActionResult<{ profile: ClientBrandProfile }>`. **Sin `revalidatePath`** (re-renderiza la página entera en este Next 16).

- [ ] **Paso 3: `npx tsc --noEmit` y `npx eslint` sobre los dos archivos.**

- [ ] **Paso 4: Commit** — `feat(matrices): loader y accion del perfil de marca`

---

## Task 4: Tarjeta del perfil de marca

**Files:** Create `src/components/clients/ClientBrandProfileCard.tsx` · Modify `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Paso 1: La tarjeta** — `'use client'`, props serializables, `<section className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">`. Campos con `maxLength` de `BRAND_TEXT_LIMITS`, guardado por campo en `onBlur` con estado local mientras el campo está enfocado (el patrón de `MatrixHeader`), `select` para `person`, y editores de lista simples para `base_hashtags` y `sample_copies`. Mostrar el estado "guardando/guardado/error" como en el editor de matrices. Todo el texto en español.

- [ ] **Paso 2: Montarla** en el perfil del cliente **exactamente** como `ClientMatricesCard` (`page.tsx:266-276`): promesa en paralelo, `.catch()` que loguea y devuelve `null`, gateo por rol al cargar (`canCreate ? … : null`), y en el JSX solo la comprobación de `null`. Colocarla junto a la tarjeta de matrices.

- [ ] **Paso 3: `npm run build`** — compila.

- [ ] **Paso 4: Commit** — `feat(matrices): tarjeta del perfil de marca en el cliente`

---

## Task 5: Dominio de la generación

**Files:** Create `src/lib/domain/matrix-ai.ts`, `src/lib/domain/matrix-ai.test.ts` · Modify `src/lib/domain/matrix.ts` (exportar `truncateCodePoints`)

Es el corazón probable del bloque: todo lo que decide qué se crea y qué se descarta. **Nada de lo que devuelve el modelo llega a la base sin pasar por aquí** — `validateItemPatch` no está en este camino porque los handlers escriben con el admin client.

- [ ] **Paso 0: Exportar `truncateCodePoints`** de `src/lib/domain/matrix.ts` (hoy es privada). Reimplementarla con `slice` sería justo el bug que el spec quiere evitar.

- [ ] **Paso 1: Tests primero.** Como mínimo:

`missingByType`: plan normal con piezas existentes → faltante por tipo; usa `credits` y **no** `availableCredits` (test explícito con créditos consumidos, calcado del que ya existe en `matrix.test.ts`); con pool unificado devuelve el total del pool y **cero historias** — ojo: `activeTypes` puede incluir `historia` si el cliente tiene créditos de historia (`u.credits > 0`), así que la regla es explícita ("bajo pool, historias = 0"), no basta con `limits.historia === 0`; nunca propone tipos fuera de `usage.activeTypes`; matriz llena → todo en cero.

`sanitizeGeneratedPlan`: descarta tipos que no son de matriz (`produccion`, `reunion`) y tipos inactivos; recorta por tipo al faltante; **bajo pool recorta también el TOTAL** (los topes por tipo valen todos `poolRemaining`, así que sin el corte del total 4 tipos × el pool = 4× fuera de plan); descarta objetivos inventados; descarta títulos vacíos o de solo espacios; índice de tema fuera de rango → pieza sin tema, no descartada; estimado `0`, `-5`, `999999` o no numérico → acotado a `1..10080`; entrada que no es array → lista vacía.

`sanitizeGeneratedBrief`: cada campo recortado a su tope de `MATRIX_TEXT_LIMITS` **cortando en el último espacio**, con `truncateCodePoints` (test con emojis, que no se deben partir); campos ausentes o no-string → se omiten, no se escriben como `"undefined"`; hashtags y CTA vacíos son válidos; **y descarta toda clave que no sea del brief** (`title`, `deadline`, `content_type`, `status`, `assigned_to`, `estimated_time_minutes`, `id`, …). Ese último test es el que hace real la regla de los campos congelados: sin él, un `{ ...raw }` con recorte por campo pasa todos los demás tests y deja al modelo reescribir el título de una pieza ya convertida.

`assignDeadlines`: **con la matriz ya poblada y bajo pool unificado** (el test más valioso: fija los dos defectos de un tirón) — las piezas nuevas ven las que ya existían, no solo las de esta corrida, y bajo pool los tipos comparten presupuesto semanal; sin eso los 12 tippables caen todos en la semana 1. Respeta `periodStart`/`periodEnd` y nunca propone una fecha anterior a `today`.

`pendingChildWork(items, jobs)`: pieza sin `ai_written_at` ni copy y sin job vivo → necesita hijo; con job `pending` o `processing` → no; con job `failed` → no (no se reintenta solo); pieza ya redactada → no.

- [ ] **Paso 2: Verificar que fallan.**

- [ ] **Paso 3: Implementar.** Tipos sugeridos:

```ts
export interface GeneratedPiece {
  content_type: ContentType
  title: string
  topicIndex: number | null
  objective: MatrixObjective | null
  needs_production: boolean
  estimated_time_minutes: number
}
export interface PlanContext {
  activeTypes: ContentType[]
  missing: Partial<Record<ContentType, number>>
  poolRemaining: number | null
  topics: MatrixTopic[]
}
export function sanitizeGeneratedPlan(raw: unknown, ctx: PlanContext): GeneratedPiece[]
export function sanitizeGeneratedBrief(raw: unknown): Partial<ItemPatch>
```

`assignDeadlines` envuelve a `proposeDeadline` y **necesita tres cosas que es fácil olvidar**: `sharedTypes` (de `sharedTypesFor(limits)` en `src/lib/data/matrices.ts`) para que bajo pool los tippables compartan presupuesto semanal, la lista de piezas **ya existentes** en la matriz como semilla (`addItem` le pasa `data.items`), y `today` (`data.today`) para no proponer fechas pasadas que el barrido del bloque 2 convertiría a la mañana siguiente.

- [ ] **Paso 4: Tests en verde + `npx tsc --noEmit`.**

- [ ] **Paso 5: Commit** — `feat(matrices): dominio de la generacion con IA`

---

## Task 6: Disparador compartido y presupuesto de tiempo del runner

**Files:** Create `src/lib/ai/trigger.ts` · Modify `src/app/api/whatsapp/webhook/route.ts`, `src/app/actions/whatsappNotify.ts`, `src/lib/ai/runner.ts`

Tarea de infraestructura compartida: **toca el camino del bot de WhatsApp, que está en producción.** Cambio mínimo y sin cambiar comportamiento salvo lo que dice el spec.

- [ ] **Paso 1: `triggerJobRunner({ max, waitMs })`** en `src/lib/ai/trigger.ts` — copia fiel de la versión del webhook: misma resolución de URL base (`NEXT_PUBLIC_SITE_URL ?? NEXT_PUBLIC_APP_URL ?? 'https://www.fullefm.site'`), mismo header `x-trigger-secret`, `keepalive: true`, errores tragados y logueados. **Debe seguir siendo `async` y devolver una promesa**: el webhook la llama con `.catch(...)` y un `void` rompería la compilación en ese punto.

- [ ] **Paso 2: Reemplazar las dos copias** conservando sus parámetros: el webhook usa `max: 3` y `waitMs = debounce*1000 + 2000`; `whatsappNotify` usa `max: 2`, `waitMs: 0`. Borrar las funciones locales y comprobar con `grep -rn "triggerJobRunner" src/` que no queda ninguna otra referencia.

- [ ] **Paso 3: `RUNNER_BUDGET_MS = 45_000` en `runJobs`** — antes de reclamar el siguiente job, si se pasó el presupuesto, cortar el bucle y devolver `stoppedEarly: true` junto a `processed`/`details`. Tres detalles que hay que acertar:
  - **El reloj arranca al entrar en la función**, antes del `waitForUpcomingMs` (el cron llama con `wait=15000` y `maxDuration` cubre también esa espera).
  - `src/app/api/ai-jobs/process/route.ts` hace *spread* del resultado de `runJobs`, así que `stoppedEarly` aparece solo en la respuesta: **no hay que "arreglar" la ruta**.
  - `Date.now()` está bien aquí: `runner.ts` es solo-servidor y ya lo usa. La regla `react-hooks/purity` es de render de React, no de este archivo.

- [ ] **Paso 4: Anotar el efecto secundario que nadie va a ver venir.** Registrar los dos handlers nuevos cambia `KNOWN_JOB_TYPES`, que viaja como `p_job_types` a `claim_ai_job`; el watchdog de 0124 ordena `(status='processing') desc` **antes** que `priority`, así que un `matrix_generate` colgado se rescata **antes** que un `whatsapp_reply` recién encolado, incluso en el disparo de baja latencia del webhook. La prioridad 8 no protege de eso. Dejarlo documentado en un comentario en `runner.ts` (el arreglo —no rescatar cuando `waitForUpcomingMs > 0`— queda fuera de alcance salvo que sea trivial).

- [ ] **Paso 5: `npx vitest run` + `npm run build`.**

- [ ] **Paso 6: Commit** — `refactor(ia): disparador compartido del runner y presupuesto de tiempo`

---

## Task 7: Prompts, esquemas de salida y configuración del modelo

**Files:** Create `src/lib/ai/matrix/prompts.ts`, `src/lib/ai/matrix/model.ts`

- [ ] **Paso 1: Bloque de sistema compartido** `buildBrandSystemBlock({ client, profile, matrix, period })` — texto en español con: marca y giro, tono, persona gramatical (voseo/tuteo/usted, con la instrucción explícita de usarla en **todo** el texto), público, propuesta de valor, oferta, qué evitar, hashtags base y los copys de ejemplo. Es el bloque que va con `cache_control: { type: 'ephemeral' }`.

- [ ] **Paso 2: Configuración del modelo** en `model.ts`, en un solo lugar: `ANTHROPIC_MATRIX_MODEL || 'claude-sonnet-4-6'` (**variable propia**: `ANTHROPIC_MODEL` es la del bot de WhatsApp y cambiarla no debe alterar en silencio la generación de matrices), padre `max_tokens: 4000` / `temperature: 0.7`, hijo `max_tokens: 1500` / `temperature: 0.8`, y lectura de `ANTHROPIC_API_KEY` que **lanza** si falta.

- [ ] **Paso 3: Esquema del padre** — una tool con `input_schema` que pide `{ topics?: {name, note?}[], pieces: { content_type, title, topic_index, objective, needs_production, estimated_time_minutes }[] }`, con `topic_index` como **índice** a la lista final de temas (nunca texto libre) y `objective` restringido a `MATRIX_OBJECTIVES`. El prompt dice cuántas piezas de cada tipo caben (o, con pool, cuántas en total y entre qué tipos repartir).

- [ ] **Paso 4: Esquema del hijo** — `{ copy, script, visual_style, hashtags, cta, objective, needs_production }`, con los topes de caracteres **dichos en el prompt** (recortar es la red, no la primera línea de defensa) y un hueco para las `instructions` del usuario, que van por encima del resto.

- [ ] **Paso 5: La forma de la llamada.** El único precedente del repo es `src/lib/ai/handlers/whatsappReply.ts:141-200`: `new Anthropic({ apiKey })`, `system: [{ type:'text', text, cache_control:{ type:'ephemeral' } }]`, `tools`/`messages` con `as never` por la versión del SDK, y la salida leída del bloque `tool_use` dentro de `response.content` (**no** de `content[0]`). **No hay ningún precedente de `tool_choice` en el repo**: verificar la forma contra el SDK instalado (`node_modules/@anthropic-ai/sdk`) antes de escribirla, y dejarla en `prompts.ts` para que los dos handlers la compartan.

- [ ] **Paso 6: `npx tsc --noEmit`.**

- [ ] **Paso 7: Commit** — `feat(matrices): prompts y esquemas de la generacion`

---

## Task 8: Handler padre `matrix_generate`

**Files:** Create `src/lib/ai/handlers/matrixGenerate.ts` · Modify `src/lib/ai/runner.ts`

- [ ] **Paso 1: Implementar los 8 pasos de la Parte 3 del spec**, en orden. Puntos que no se pueden torcer:
  - Se crea su **propio** `createAdminClient()` tipado; `ctx.supabase` no está tipado y no se usa para escribir. **Los ids se leen de `input_json`** (`{ matrixId }`), no de `ctx.job.content_matrix_id`: `AiJobRow` de `src/lib/ai/types.ts` es una interfaz escrita a mano que no tiene las columnas nuevas, y es lo que hace `invoiceDueReminder` con `invoiceId`.
  - `loadMatrixEditorData(admin, matrixId)` es la única fuente de cupo, distribución, período, `today` y `assignableUsers` (ya llama a `computeMatrixUsage` con `convertedInCycleIds`).
  - Paso 2: las **dos invariantes**. Si las piezas ya están pero faltan hijos, encolar los que falten (`pendingChildWork`) y terminar **sin llamar al modelo**.
  - Paso 5, temas: **releer `topics_json` justo antes del update y no escribir si ya no está vacío** (no hay idiom de PostgREST para "solo si sigue siendo `[]`" que el repo use; el índice de un único padre activo hace la ventana pequeña).
  - Paso 6: **recalcular el faltante** después de la llamada al modelo y recortar antes de insertar.
  - **`assigned_to` se prerrellena con los `default_assignee`** de `data.assignableUsers`, igual que `addItem`. Sin esto toda pieza generada falla `validateForApproval` con `sin_responsable` y la matriz no se puede aprobar — justo lo que el spec quiere evitar al hacer que la IA proponga el estimado.
  - Encolar hijos ordenados por `deadline`, fila por fila, tragando `23505` **por código**, y **cada hijo lleva `priority: 8`, `content_matrix_id`, `content_matrix_item_id`, `parent_job_id` y `client_id`**. Sin `content_matrix_item_id` el índice único del hijo no aplica (en btree los nulos no colisionan) y se pierden a la vez el candado del doble clic y la idempotencia del re-encolado.
  - Disparar `min(5, ceil(hijos/3))` runners con `?max=3&wait=0`.
  - Costo y tokens **acumulados** (`coalesce(actual,0) + nuevo`).
  - Si `sanitizeGeneratedPlan` deja la lista vacía: terminar `completed` con `{ itemsCreated: 0, reason: 'sin_plan_valido' }` en `result_json` — la ruta de progreso lo lee para que la franja no muestre un éxito mudo.

- [ ] **Paso 2: Registrarlo** en `HANDLERS` de `runner.ts` (una línea, sin prefijo `whatsapp_`).

- [ ] **Paso 3: `npx tsc --noEmit` + `npx eslint`.**

- [ ] **Paso 4: Commit** — `feat(matrices): handler que planifica la matriz con IA`

---

## Task 9: Handler hijo `matrix_item_write`

**Files:** Create `src/lib/ai/handlers/matrixItemWrite.ts` · Modify `src/lib/ai/runner.ts`

- [ ] **Paso 1: Implementar** los 5 pasos de la Parte 3. Puntos que no se pueden torcer:
  - Entrada por `input_json`: `{ itemId, instructions? }`. Las instrucciones viajan ahí a propósito: sobreviven a un re-arranque del watchdog.
  - Pieza inexistente → `skipped` (nunca un throw: quemaría los tres intentos y ensuciaría la lista de fallidos). Matriz `closed` → `skipped`. Pieza `blocked` → **sí se redacta**.
  - Escribe **solo** lo que devuelve `sanitizeGeneratedBrief` (que ya descarta cualquier clave ajena al brief): así una pieza `converted` no puede perder ninguno de sus cinco campos congelados aunque el modelo los invente.
  - `ai_written_at` al terminar.
  - Costo y tokens acumulados, con la fórmula exacta de `whatsappReply.ts` (sin `*100` de más).

- [ ] **Paso 2: Registrarlo** en `HANDLERS`.

- [ ] **Paso 3: `npx tsc --noEmit` + `npx eslint`.**

- [ ] **Paso 4: Commit** — `feat(matrices): handler que redacta una pieza con IA`

---

## Task 10: Acciones y ruta de progreso

**Files:** Create `src/app/actions/matrixAi.ts`, `src/app/api/matrices/[id]/generation/route.ts`

- [ ] **Paso 1: `generateMatrix(matrixId)`** — `requireManager`; re-valida que la matriz esté en `draft`, que el cliente tenga perfil usable (`hasUsableBrandProfile`) y que falte cupo; encola el padre con el **admin client** (`ai_jobs` no tiene policy de insert) con `priority: 8`, `content_matrix_id`, `client_id`, `triggered_by` e `input_json: { matrixId }`; traga `23505` y lo traduce a "Ya hay una generación en curso para esta matriz."; dispara el runner.

- [ ] **Paso 2: `regenerateItem(itemId, instructions?)`** — `requireManager`; recorta e impone el tope de 300 caracteres **en el servidor**; rechaza matriz `closed`; encola el hijo con `priority: 8`, `content_matrix_id`, `content_matrix_item_id` e `input_json: { itemId, instructions }`; `23505` no es error (la pieza ya está en cola); dispara el runner.

- [ ] **Paso 3: La ruta de progreso** — `GET /api/matrices/[id]/generation?since=<ISO>`. Next 16: los params de ruta son asincrónicos; leer `node_modules/next/dist/docs/` antes de escribirla. Sesión normal (**no** agregarla a `SECRET_AUTH_API_PREFIXES`: `startsWithAny` solo casa `/api/matrices/convert` exacto o con `/`), re-valida rol admin/supervisor con el precedente de `getEffectiveUser()` de `src/app/api/notifications/route.ts`. Lee `ai_jobs` con el **admin client** (su única policy de select es `is_admin()` y un supervisor no pasa) y `content_matrix_items`/`content_matrices` con el **cliente de sesión** (su RLS ya es admin/supervisor).

  **Acotar al job padre más reciente**: `matrix_generate` de esa matriz, `order created_at desc limit 1`, y derivar `phase`/`error` **solo** de esa fila. Si no, una generación que falló en septiembre deja la franja roja para siempre y sus hijos fallidos inflan los contadores de la corrida siguiente. Los hijos se cuentan por `parent_job_id` de ese padre; los `matrix_item_write` sueltos (los de "Regenerar", sin padre) **solo** alimentan `writingItemIds`, no los contadores.

  Respuesta:

```ts
{ phase: 'planning' | 'writing' | 'idle' | 'failed',
  total: number, done: number, failed: number,
  writingItemIds: string[],          // de ai_jobs.content_matrix_item_id
  error: string | null,
  reason: string | null,             // 'sin_plan_valido' del result_json del padre
  topics: MatrixTopic[] | null,      // topics_json actual de la matriz
  items: ContentMatrixItem[] }       // solo filas con updated_at > since
```

- [ ] **Paso 4: `npx tsc --noEmit` + `npx eslint` sobre los archivos tocados** (el build completo queda para la Task 12).

- [ ] **Paso 5: Commit** — `feat(matrices): acciones de generacion y ruta de progreso`

---

## Task 11: El editor fusiona sin pisar lo escrito

**Files:** Modify `src/components/matrices/MatrixEditor.tsx` · Create `src/hooks/useMatrixGeneration.ts`

Es el cambio más delicado del bloque: toca la máquina de estados del bloque 1, que ya está en producción. **Leer `MatrixEditor.tsx` entero antes de tocar nada.**

- [ ] **Paso 1: Contador por campo en vuelo.** En `beginFieldSave` —el único punto por el que pasan todos los guardados— llevar `inFlightByField: Map<string, number>`: +1 al empezar, -1 al resolver (en un `finally`, para que un throw no lo deje colgado). No tocar `latestSeqByField`: resuelve otro problema (que una respuesta vieja no pise a una nueva) y nunca se limpia, así que no sabe qué hay en vuelo.

- [ ] **Paso 2: Lápidas.** Conjunto `deletedItemIds` alimentado por `onDeleteItem`; **si el borrado falla y se revierte, hay que sacar el id del conjunto**, o la pieza restaurada volvería a desaparecer en el siguiente sondeo.

- [ ] **Paso 3: `useMatrixGeneration(matrixId, { enabled })`** — sondeo cada 3 s con la forma de `useNotifications`: `AbortController` que cancela la anterior, pausa con la pestaña oculta y refetch al volver, limpieza completa en el `return`. Mantiene la marca de agua `since` (el `updated_at` máximo visto).

  **Arranque:** una consulta al montar siempre que la matriz esté en `draft` —barata y auto-reparable— y sondeo continuo mientras `phase !== 'idle'`. Sin eso, el caso "cerré la pestaña a media generación y volví" (punto 3 del recorrido manual) muestra una matriz terminada con la mitad de los briefs vacíos. El botón "Generar" enciende el sondeo sin esperar al siguiente tick.

- [ ] **Paso 4: La fusión.** Por cada respuesta:
  - pieza desconocida → se agrega, **salvo** que esté en las lápidas;
  - pieza conocida → se actualizan solo los campos **sin guardado en vuelo y sin borrador fallido**. La ventana es real: `MatrixItemSheet.commitText` limpia el borrador local **antes** de que llegue la respuesta, así que sin la regla el sondeo revertiría visiblemente lo recién escrito;
  - **toda fila aceptada se escribe también en `confirmedItems.current`**. Es el origen del rollback de un guardado fallido: si una pieza nueva no está en el mapa, un fallo posterior no revierte nada y la pantalla queda por delante de la base; si una pieza conocida se queda con la fila vieja, el siguiente fallo revierte en pantalla el texto que escribió la IA;
  - **los temas** de la respuesta se fusionan en `matrix` y en `confirmedMatrix.current` cuando no hay un guardado en vuelo de `matrix:topics`. Sin esto la generación se pierde en silencio: el padre escribe `topics_json`, la barra de temas sigue mostrando la lista vieja, y en cuanto el usuario agregue un tema `updateMatrix` recibe la lista **sin** los temas de la IA y el servidor los borra, dejando además sin tema a las 15 piezas generadas.

- [ ] **Paso 5: `npx tsc --noEmit` + `npx eslint`**, y repasar a mano que con el sondeo apagado el editor se comporta **exactamente** como antes.

- [ ] **Paso 6: Commit** — `feat(matrices): el editor fusiona las piezas generadas sin pisar lo escrito`

---

## Task 12: La interfaz de la generación

**Files:** Modify `src/components/matrices/MatrixHeader.tsx`, `MatrixItemsTable.tsx`, `MatrixItemSheet.tsx`, `MatrixEditor.tsx`

- [ ] **Paso 1: Botón "Generar con IA"** en la cabecera, solo en matriz `draft`. Deshabilitado **con el motivo visible**: sin perfil de marca (con enlace al cliente), la matriz ya cubre el cupo, o hay una generación en curso.

- [ ] **Paso 2: Franja de progreso** — "Generando… 7 de 15"; el aviso de pool ("El plan usa pool unificado: no se generan historias.") cuando aplique; el error del job con `phase: 'failed'`; y el caso `reason: 'sin_plan_valido'` con su propio mensaje ("La IA no devolvió ninguna pieza válida. Probá de nuevo."), porque terminar en silencio parecería éxito.

- [ ] **Paso 3: Estado por pieza** — "Redactando…" mientras su id esté en `writingItemIds`; "Sin redactar" (definición del spec: sin `ai_written_at`, con el copy vacío y sin hijo vivo) con botón "Regenerar" al lado.

- [ ] **Paso 4: "Regenerar" en el panel lateral** con la caja de instrucciones (300, contador visible), deshabilitado mientras esa pieza se redacta y en matriz `closed`.

- [ ] **Paso 5: Accesibilidad** — botones reales, `disabled` en vez de ocultar cuando hay un motivo que explicar, y el motivo también para lectores de pantalla (patrón del bloque 2 con `sr-only`).

- [ ] **Paso 6: `npm run build`.**

- [ ] **Paso 7: Commit** — `feat(matrices): interfaz de generacion y regeneracion`

---

## Task 13: Documentación y verificación final

**Files:** Modify `CLAUDE.md`

- [ ] **Paso 1: Documentar** en `CLAUDE.md`: **crear** la sección "Pendiente de aplicar" antes de la tabla de migraciones (hoy no existe; la del bloque 2 se quitó al aplicarse la 0130) con la fila de la 0131 y la advertencia de no desplegar antes — **no** listarla como aplicada. Y una sección "Bloque 3 — asistencia con IA" con: los dos job types y su prioridad, la idempotencia por invariantes, el presupuesto de tiempo del runner y el efecto del watchdog sobre el orden, `ANTHROPIC_MATRIX_MODEL`, el costo acumulado, la ruta de progreso (con sesión normal: **no** entra en `SECRET_AUTH_API_PREFIXES`) y la regla de fusión del editor con el porqué de `confirmedItems` y de los temas.

- [ ] **Paso 2: Verificación completa**

```bash
npx vitest run      # solo debe fallar cycles.test.ts > isRenewalDue (previa y ajena)
npx tsc --noEmit    # 0 errores
npm run lint        # sin errores nuevos respecto a master
npm run build       # compila
```

- [ ] **Paso 3: Recorrido manual (requiere 0131 aplicada)** — los 8 puntos de la Parte 6 del spec. **Lo hace el usuario**, no un agente.

- [ ] **Paso 4: Commit** — `docs: documenta el bloque 3 del creador de matrices`
