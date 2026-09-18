# Creador de matrices · Bloque 3 (IA) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Goal:** Que un botón "Generar con IA" arme la matriz del mes —temas y piezas con brief completo— dentro del cupo del plan, con progreso en vivo y regeneración por pieza.

**Architecture:** Dos handlers nuevos sobre la cola `ai_jobs` que ya existe: un padre (`matrix_generate`) que planifica y crea las filas de las piezas, y un hijo por pieza (`matrix_item_write`) que redacta el brief. Toda la lógica que se puede probar sin base ni API vive en dominio puro (`src/lib/domain/brand.ts`, `src/lib/domain/matrix-ai.ts`). El editor sondea un route handler para el progreso y fusiona las filas nuevas sin pisar lo que el usuario está escribiendo.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase (Postgres + RLS) · `@anthropic-ai/sdk` · vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md` (revisión 2). **Manda el spec**: si este plan y el spec discrepan, gana el spec y se anota la discrepancia.

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

**Files:** Create `src/lib/domain/matrix-ai.ts`, `src/lib/domain/matrix-ai.test.ts`

Es el corazón probable del bloque: todo lo que decide qué se crea y qué se descarta. **Nada de lo que devuelve el modelo llega a la base sin pasar por aquí** — `validateItemPatch` no está en este camino porque los handlers escriben con el admin client.

- [ ] **Paso 1: Tests primero.** Como mínimo:

`missingByType`: plan normal con piezas existentes → faltante por tipo; usa `credits` y **no** `availableCredits` (test explícito con créditos consumidos, calcado del que ya existe en `matrix.test.ts`); con pool unificado devuelve el total del pool y **cero historias**; nunca propone tipos fuera de `usage.activeTypes`; matriz llena → todo en cero.

`sanitizeGeneratedPlan`: descarta tipos que no son de matriz (`produccion`, `reunion`) y tipos inactivos; recorta por tipo al faltante; descarta objetivos inventados; descarta títulos vacíos o de solo espacios; índice de tema fuera de rango → pieza sin tema, no descartada; estimado `0`, `-5`, `999999` o no numérico → acotado a `1..10080`; entrada que no es array → lista vacía; lista vacía → lista vacía (el handler decide qué hacer).

`sanitizeGeneratedBrief`: cada campo recortado a su tope de `MATRIX_TEXT_LIMITS` **cortando en el último espacio**; usa `truncateCodePoints` (ya en `matrix.ts`) y no parte pares sustitutos (test con emojis); campos ausentes o no-string → se omiten, no se escriben como `"undefined"`; hashtags y CTA vacíos son válidos.

`assignDeadlines`: con una distribución semanal dada, dos piezas del mismo tipo no caen el mismo día si hay presupuesto en otra semana; respeta `periodStart`/`periodEnd`; acumula (la pieza N ve las N-1 anteriores).

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

- [ ] **Paso 4: Tests en verde + `npx tsc --noEmit`.**

- [ ] **Paso 5: Commit** — `feat(matrices): dominio de la generacion con IA`

---

## Task 6: Disparador compartido y presupuesto de tiempo del runner

**Files:** Create `src/lib/ai/trigger.ts` · Modify `src/app/api/whatsapp/webhook/route.ts`, `src/app/actions/whatsappNotify.ts`, `src/lib/ai/runner.ts`

Tarea de infraestructura compartida: **toca el camino del bot de WhatsApp, que está en producción.** Cambio mínimo y sin cambiar comportamiento salvo lo que dice el spec.

- [ ] **Paso 1: `triggerJobRunner({ max, waitMs })`** en `src/lib/ai/trigger.ts` — copia fiel de la versión del webhook (`route.ts:307-322`): misma resolución de URL base (`NEXT_PUBLIC_SITE_URL ?? NEXT_PUBLIC_APP_URL ?? 'https://www.fullefm.site'`), mismo header `x-trigger-secret`, `keepalive: true`, errores tragados y logueados, **sin `await`** en el llamador.

- [ ] **Paso 2: Reemplazar las dos copias** conservando sus parámetros: el webhook usa `max: 3` y `waitMs = debounce*1000 + 2000`; `whatsappNotify` usa `max: 2`, `waitMs: 0`. Borrar las funciones locales.

- [ ] **Paso 3: `RUNNER_BUDGET_MS = 45_000` en `runJobs`** — antes de reclamar el siguiente job, si `new Date().getTime() > until`, cortar el bucle y devolver `stoppedEarly: true` en el resultado (junto a `processed`/`details`). Comentario explicando por qué: `maxDuration` es de la ruta y cubre el bucle entero; un job muerto a mitad queda `processing` con el intento ya consumido por `claim_ai_job` y solo lo rescata el watchdog cinco minutos después. Usar `new Date().getTime()`, **nunca `Date.now()`** (regla `react-hooks/purity` del repo).

- [ ] **Paso 4: `npx vitest run` + `npm run build`.** Verificar a mano que el webhook y `whatsappNotify` siguen compilando y que nadie más importaba las funciones borradas (`grep -rn "triggerJobRunner\|runJobs(" src/`).

- [ ] **Paso 5: Commit** — `refactor(ia): disparador compartido del runner y presupuesto de tiempo`

---

## Task 7: Prompts y esquemas de salida

**Files:** Create `src/lib/ai/matrix/prompts.ts`

- [ ] **Paso 1: Bloque de sistema compartido** `buildBrandSystemBlock({ client, profile, matrix, period })` — texto en español que incluye: marca y giro, tono, persona gramatical (voseo/tuteo/usted, con la instrucción explícita de usarla en **todo** el texto), público, propuesta de valor, oferta, qué evitar, hashtags base y los copys de ejemplo. Es el bloque que va marcado con `cache_control: { type: 'ephemeral' }`.

- [ ] **Paso 2: Esquema del padre** — una tool con `input_schema` que pide `{ topics?: {name, note?}[], pieces: { content_type, title, topic_index, objective, needs_production, estimated_time_minutes }[] }`, con `topic_index` como **índice** a la lista final de temas (nunca texto libre) y `objective` restringido a `MATRIX_OBJECTIVES`. El prompt le dice cuántas piezas de cada tipo caben (o, con pool, cuántas en total y entre qué tipos repartir).

- [ ] **Paso 3: Esquema del hijo** — una tool que pide `{ copy, script, visual_style, hashtags, cta, objective, needs_production }`, con los topes de caracteres **dichos en el prompt** (recortar es la red, no la primera línea de defensa). Acepta `instructions` opcionales del usuario y las pone por encima del resto.

- [ ] **Paso 4: `npx tsc --noEmit`.**

- [ ] **Paso 5: Commit** — `feat(matrices): prompts y esquemas de la generacion`

---

## Task 8: Handler padre `matrix_generate`

**Files:** Create `src/lib/ai/handlers/matrixGenerate.ts` · Modify `src/lib/ai/runner.ts`

- [ ] **Paso 1: Implementar los 8 pasos de la Parte 3 del spec**, en este orden y sin saltarse ninguno. Puntos que no se pueden torcer:
  - Se crea su **propio** `createAdminClient()` tipado; `ctx.supabase` no está tipado y no se usa para escribir.
  - `loadMatrixEditorData(admin, matrixId)` es la única fuente de cupo, distribución, período y `assignableUsers`.
  - Paso 2: las **dos invariantes**. Si las piezas ya están pero faltan hijos, encola los que falten (`pendingChildWork`) y termina **sin llamar al modelo**.
  - Paso 6: **recalcular el faltante** después de la llamada al modelo y recortar antes de insertar.
  - Encolar hijos ordenados por `deadline`, fila por fila, tragando `23505` **por código**.
  - Disparar `min(5, ceil(hijos/3))` runners con `?max=3&wait=0`.
  - Costo y tokens **acumulados** (`coalesce(actual,0) + nuevo`).

- [ ] **Paso 2: Registrarlo** en `HANDLERS` de `runner.ts` (una línea, sin prefijo `whatsapp_`).

- [ ] **Paso 3: `npx tsc --noEmit` + `npx eslint`.**

- [ ] **Paso 4: Commit** — `feat(matrices): handler que planifica la matriz con IA`

---

## Task 9: Handler hijo `matrix_item_write`

**Files:** Create `src/lib/ai/handlers/matrixItemWrite.ts` · Modify `src/lib/ai/runner.ts`

- [ ] **Paso 1: Implementar** los 5 pasos de la Parte 3. Puntos que no se pueden torcer:
  - Pieza inexistente → `skipped` (nunca un throw: quemaría los tres intentos y ensuciaría la lista de fallidos).
  - Matriz `closed` → `skipped`. Pieza `blocked` → **sí se redacta**.
  - Pieza `converted` → no tocar los cinco campos congelados.
  - `sanitizeGeneratedBrief` antes de escribir; `ai_written_at` al terminar.
  - Costo y tokens acumulados, con la fórmula exacta de `whatsappReply.ts` (sin `*100` de más).

- [ ] **Paso 2: Registrarlo** en `HANDLERS`.

- [ ] **Paso 3: `npx tsc --noEmit` + `npx eslint`.**

- [ ] **Paso 4: Commit** — `feat(matrices): handler que redacta una pieza con IA`

---

## Task 10: Acciones y route handler de progreso

**Files:** Create `src/app/actions/matrixAi.ts`, `src/app/api/matrices/[id]/generation/route.ts`

- [ ] **Paso 1: `generateMatrix(matrixId)`** — `requireManager`; re-valida que la matriz esté en `draft`, que el cliente tenga perfil usable (`hasUsableBrandProfile`) y que falte cupo; encola el padre con el **admin client** (`ai_jobs` no tiene policy de insert) con `priority: 8`, `content_matrix_id`, `client_id`, `triggered_by`; traga `23505` y lo traduce a "Ya hay una generación en curso para esta matriz."; dispara el runner.

- [ ] **Paso 2: `regenerateItem(itemId, instructions?)`** — `requireManager`; valida las instrucciones (≤300, se recortan espacios); rechaza matriz `closed`; encola el hijo igual que arriba (23505 → ignorar, la pieza ya está en cola); dispara el runner.

- [ ] **Paso 3: El route handler de progreso** — `GET /api/matrices/[id]/generation?since=<ISO>`. Next 16: los params de ruta son asincrónicos, leer `node_modules/next/dist/docs/` antes de escribirlo. Sesión normal (**no** agregarlo a `SECRET_AUTH_API_PREFIXES` de `src/proxy.ts`), re-valida rol admin/supervisor, lee `ai_jobs` con el **admin client** (su policy de select es `is_admin()` y un supervisor no pasa). Devuelve el objeto del spec, con `items` acotado por `since` y `phase: 'failed'` cuando el padre terminó en `failed`.

- [ ] **Paso 4: `npm run build`.**

- [ ] **Paso 5: Commit** — `feat(matrices): acciones de generacion y ruta de progreso`

---

## Task 11: El editor sabe qué se está guardando

**Files:** Modify `src/components/matrices/MatrixEditor.tsx` · Create `src/hooks/useMatrixGeneration.ts`

Es el cambio más delicado del bloque: toca la máquina de estados del bloque 1, que ya está en producción.

- [ ] **Paso 1: Contador por campo en vuelo.** En `beginFieldSave` —el único punto por el que pasan todos los guardados— llevar `inFlightByField: Map<string, number>`: +1 al empezar, -1 al resolver (en un `finally`, para que un throw no lo deje colgado). No cambiar `latestSeqByField`: sigue resolviendo "respuesta vieja pisa a nueva", que es otro problema.

- [ ] **Paso 2: Lápidas.** Conjunto de ids borrados localmente (`deletedItemIds`), alimentado por `onDeleteItem`. Sin esto, un sondeo emitido antes del borrado resucita la pieza.

- [ ] **Paso 3: `useMatrixGeneration(matrixId, { enabled })`** — sondeo cada 3 s con la forma de `useNotifications`: `AbortController` que cancela la anterior, pausa con la pestaña oculta y refetch al volver, limpieza completa en el `return`. Mantiene la marca de agua `since` (el `updated_at` máximo visto).

- [ ] **Paso 4: La fusión.** Pieza desconocida → se agrega salvo que esté en las lápidas. Pieza conocida → se actualizan solo los campos sin guardado en vuelo y sin borrador fallido. Ordenar con `compareMatrixItems` después de fusionar.

- [ ] **Paso 5: `npm run build`** y repasar a mano que el guardado por campo del bloque 1 sigue intacto (un sondeo apagado no debe cambiar **nada** del comportamiento actual).

- [ ] **Paso 6: Commit** — `feat(matrices): el editor fusiona las piezas generadas sin pisar lo escrito`

---

## Task 12: La interfaz de la generación

**Files:** Modify `src/components/matrices/MatrixHeader.tsx`, `MatrixItemsTable.tsx`, `MatrixItemSheet.tsx`, `MatrixEditor.tsx`

- [ ] **Paso 1: Botón "Generar con IA"** en la cabecera, solo en matriz `draft`. Deshabilitado con el motivo visible cuando: no hay perfil de marca (con enlace al cliente), la matriz ya cubre el cupo, o hay una generación en curso.

- [ ] **Paso 2: Franja de progreso** — "Generando… 7 de 15", el aviso de pool ("El plan usa pool unificado: no se generan historias.") cuando aplique, y el error del job con `phase: 'failed'`.

- [ ] **Paso 3: Estado por pieza** — "Redactando…" mientras su id esté en `writingItemIds`; "Sin redactar" (definición del spec) con botón "Regenerar" al lado.

- [ ] **Paso 4: "Regenerar" en el panel lateral** con la caja de instrucciones (300, contador visible), deshabilitado mientras esa pieza se redacta y en matriz `closed`.

- [ ] **Paso 5: Accesibilidad** — botones reales, `disabled` en vez de ocultar cuando hay un motivo que explicar, y el motivo también para lectores de pantalla (patrón del bloque 2 con `sr-only`).

- [ ] **Paso 6: `npm run build`.**

- [ ] **Paso 7: Commit** — `feat(matrices): interfaz de generacion y regeneracion`

---

## Task 13: Documentación y verificación final

**Files:** Modify `CLAUDE.md`

- [ ] **Paso 1: Documentar** en `CLAUDE.md`: fila de la 0131 en "Pendiente de aplicar" (con la advertencia de no desplegar antes), sección "Bloque 3 — asistencia con IA" con los dos job types, la idempotencia por invariantes, el presupuesto del runner, la variable `ANTHROPIC_MATRIX_MODEL`, el costo acumulado y la regla de fusión del editor. Añadir la nueva ruta a la lista de crons/rutas **solo si corresponde** (la de progreso va con sesión normal: **no** entra en `SECRET_AUTH_API_PREFIXES`).

- [ ] **Paso 2: Verificación completa**

```bash
npx vitest run      # solo debe fallar cycles.test.ts > isRenewalDue (previa y ajena)
npx tsc --noEmit    # 0 errores
npm run lint        # sin errores nuevos respecto a master
npm run build       # compila
```

- [ ] **Paso 3: Recorrido manual (requiere 0131 aplicada)** — los 8 puntos de la Parte 6 del spec. **Lo hace el usuario**, no un agente.

- [ ] **Paso 4: Commit** — `docs: documenta el bloque 3 del creador de matrices`
