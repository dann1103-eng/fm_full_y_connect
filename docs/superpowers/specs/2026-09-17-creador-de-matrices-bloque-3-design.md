# Creador de matrices · Bloque 3 — asistencia con IA

**Fecha:** 2026-09-17 · **Revisión 2** (tras revisión adversarial)
**Bloques previos:** 1 (matrices manuales, `0129`) y 2 (conversión automática, `0130`), ambos en producción.
**Migración de este bloque:** `0131`.

## Objetivo

Que armar la matriz del mes deje de ser escribir 15 piezas en blanco. Un botón **"Generar con IA"** en una matriz en borrador propone los temas del mes y redacta todas las piezas —título, tema, objetivo, copy, guion, estilo visual, hashtags, CTA— dentro del cupo del plan del cliente. El equipo corrige lo que haga falta y aprueba. Nada llega al pipeline sin pasar por la aprobación que ya existe en el bloque 1.

Lo que **no** hace este bloque: generar imágenes, publicar, elegir fechas por su cuenta, tocar requerimientos ya creados, escribir en matrices cerradas, ni exponer nada al portal del cliente.

---

## Parte 1 — El perfil de marca

Sin contexto de marca la IA escribe texto genérico, y texto genérico es lo que hace que nadie vuelva a apretar el botón. El perfil es la entrada obligatoria de todo el bloque.

### Tabla `client_brand_profiles`

Una fila por cliente (`client_id` PK y FK a `clients` con `on delete cascade`).

| Columna | Tipo | Tope | Para qué |
|---|---|---|---|
| `client_id` | `uuid` PK FK | — | Una fila por cliente |
| `tone` | `text` | 500 | Tono de voz: "cercano pero profesional, sin tecnicismos" |
| `person` | `text` | check | `voseo` \| `tuteo` \| `usted`. En El Salvador esto se equivoca solo y se nota en cada copy |
| `audience` | `text` | 800 | Público objetivo |
| `value_proposition` | `text` | 800 | Qué vende y por qué le compran |
| `offerings` | `text` | 1500 | Productos o servicios que puede mencionar por nombre |
| `avoid` | `text` | 1000 | Qué no decir: temas, palabras, promesas prohibidas |
| `base_hashtags` | `text[]` | 15 elementos | Los que van siempre. Largo por elemento (40) lo valida la app |
| `sample_copies` | `jsonb` array de strings | 5 elementos | Copys reales que funcionaron. Mueve la calidad más que cualquier adjetivo sobre el tono. Largo por elemento (1000) lo valida la app |
| `updated_by_user_id` | `uuid` FK `users` | — | Auditoría |
| `created_at` / `updated_at` | `timestamptz` | — | `updated_at` con el mismo trigger que el resto |

**No hay campo `notes`**: con `tone`, `avoid`, `value_proposition` y `offerings` ya hay dónde escribir cada cosa, y un cajón de sastre acabaría repitiendo el mismo texto dos veces e inflando cada prompt.

En SQL: checks de longitud **con nombre** (`client_brand_profiles_*_chk`), `check (sample_copies is null or (jsonb_typeof(sample_copies) = 'array' and jsonb_array_length(sample_copies) <= 5))`, `check (person is null or person in ('voseo','tuteo','usted'))` — **nulo permitido**: el perfil se llena campo por campo y un check estricto haría fallar el primer guardado de cualquier otro campo, `check (array_length(base_hashtags, 1) is null or array_length(base_hashtags, 1) <= 15)`, una sola policy `for all` de RLS para `role in ('admin','supervisor')`, todo dentro de `begin; set local lock_timeout='5s'; … commit;`. **El largo de cada elemento de los dos arrays lo valida la app, no la base** (un check no puede recorrer un array sin subconsulta); se dice aquí para que nadie lo dé por cubierto.

Los topes viven en `BRAND_TEXT_LIMITS` (dominio) y se usan como `maxLength` en la UI, como validación en la acción y como check en la migración: los mismos tres lados que `MATRIX_TEXT_LIMITS`.

### UI y acciones

Tarjeta **"Perfil de marca"** en el perfil del cliente, montada como `ClientMatricesCard`: loader en paralelo, envuelto en `.catch()` para que sin la migración la tarjeta no aparezca en vez de tumbar la página, y gateo por rol **al cargar** (`canCreate ? loader : null`), no en el JSX. Guardado por campo con server action y **cliente autenticado** (la tabla tiene policy `for all` para admin/supervisor), sin `revalidatePath`.

### La compuerta

**Sin perfil de marca no se genera.** Se considera que hay perfil cuando están llenos `tone`, `audience`, `value_proposition` y `offerings` — `hasUsableBrandProfile` en el dominio, usada por la UI para deshabilitar el botón con el aviso "Este cliente no tiene perfil de marca" (con enlace al perfil) y **re-evaluada en el servidor** al encolar.

---

## Parte 2 — Qué genera y con qué reglas

### Cuántas piezas

El cupo del plan para el período de la matriz, menos lo que la matriz ya tenga.

- **Una sola fuente de cupo: `loadMatrixEditorData`.** Ya devuelve `limits`, `usage`, `convertedInCycleIds`, `distribution`, `maxWeek`, `period`, `today` y `assignableUsers`, acepta cualquier `SupabaseClient<Database>` (el admin client incluido) y es exactamente lo que pintan los chips. Rederivar la cadena a mano es la forma segura de que el generador y los chips discrepen.
- **`computeMatrixUsage` se llama SIEMPRE con `convertedInCycleIds`.** Sin ese tercer argumento toda pieza `converted` se descuenta de lo planificado; una pieza convertida a **otro** ciclo —el caso que el bloque 2 contempla con `convertsBeforePeriodStart`— no estaría ni en `cycleTotals` ni en lo planificado, y el generador vería hueco donde los chips no lo ven.
- **El cupo se calcula con `credits` (efectivos), nunca con `availableCredits`.** `used` ya incluye `cycleTotals`, que incluye los requerimientos cuyos créditos se gastaron; usar los disponibles descontaría esos créditos dos veces.
- Solo se generan tipos que estén en `usage.activeTypes`: son los que el plan tiene vivos y los únicos con presupuesto en la distribución semanal.
- **Con pool unificado** el reparto entre `estatico`, `video_corto`, `reel` y `short` lo propone la IA dentro del total. **`historia` no se genera en planes con pool**: `PlanForm` pone a cero los cinco tippables al activar el pool, así que `limits.historia` es 0 y una historia nacería fuera de plan y sin semana asignada. La franja lo dice: "El plan usa pool unificado: no se generan historias."
- Si no falta nada, no se encola nada: "La matriz ya cubre el cupo del plan."

**"Nunca fuera de plan" es *mejor esfuerzo al planificar*, no una garantía.** Entre la foto del cupo y el insert hay una llamada al modelo, y en esa ventana el barrido del bloque 2, un registro manual o la aprobación de una solicitud del portal pueden consumir cupo. Por eso el padre **vuelve a calcular el faltante justo antes de insertar** y recorta el plan a lo que siga cabiendo. Los chips siguen siendo la verdad. Aparte: la matriz se ancla al ciclo de **su período** mientras el bloque 2 convierte al ciclo **vigente**, así que una matriz futura perfectamente dentro de cupo puede aun así convertir fuera de plan.

### Qué campos escribe

| Lo escribe la IA | Lo pone el sistema |
|---|---|
| Temas del mes (si la matriz no los tiene) | `deadline` — `proposeDeadline`, acumulando las piezas ya propuestas en la misma corrida para que el presupuesto semanal se consuma de verdad |
| El **reparto** de tipos dentro del cupo (el sistema fija el `content_type` de cada pieza a partir de ese reparto) | `assigned_to` — prellenado con `default_assignee`, igual que `addItem` |
| `title`, `topic`, `objective`, `copy`, `script`, `visual_style`, `hashtags`, `cta` | |
| `needs_production`, `estimated_time_minutes` | |

Las fechas no las elige el modelo a propósito: `proposeDeadline` ya respeta la distribución semanal y el presupuesto por semana. El estimado sí lo propone porque **aprobar exige responsable y estimado en cada pieza** (bloque 2): sin proponerlo, generar 15 piezas dejaría 15 campos obligatorios en blanco.

### Los temas del mes

Si la matriz ya tiene temas, la IA los respeta y reparte las piezas entre ellos. Si no, el padre propone 3–5 y los guarda con `sanitizeTopics`, con un **update condicional** que no escribe si el usuario agregó temas mientras el modelo pensaba. En el esquema de salida el tema de cada pieza es un **índice** a la lista final, no texto libre: así no hay temas inventados que descartar. Un índice fuera de rango deja la pieza sin tema (válido).

### Longitudes

Cada campo se recorta a su tope de `MATRIX_TEXT_LIMITS` cortando en el último espacio, con `truncateCodePoints` (ya existe en `matrix.ts`) y no con `slice`: los checks de la base cuentan **code points** y partir un par sustituto rompería el texto. Ojo: `MATRIX_TEXT_LIMITS` **no tiene `topic`** (lo acota `sanitizeTopics` a 60 code points) y su `notes` es de la matriz, no de la pieza.

---

## Parte 3 — El motor de generación

### Dos handlers sobre la infraestructura que ya existe

| Job | Qué hace |
|---|---|
| `matrix_generate` (padre) | Planifica temas y reparto, **crea las filas** de las piezas con título, tipo, tema, objetivo, fecha, responsable y estimado, y encola un hijo por pieza. |
| `matrix_item_write` (hijo) | Redacta **una** pieza (`copy`, `script`, `visual_style`, `hashtags`, `cta`, `objective`, `needs_production`) y marca `ai_written_at`. Es también el job de "Regenerar". |

El corte padre/hijo es por el tope de 60 s de Vercel: redactar 15 briefs en una llamada no cabe y un fallo en la pieza 12 tiraría las 11 anteriores. Las piezas se crean todas en el paso del padre, vacías de texto: el progreso es visible de inmediato, un hijo que falle deja una pieza recuperable con "Regenerar" en vez de un hueco, y "cuántas faltan" se lee de la base.

- El prefijo **no** puede ser `whatsapp_`: el runner elige el cliente Supabase por ese prefijo.
- **`ctx.supabase` no está tipado** (`AiHandlerCtx.supabase: SupabaseClient`, genérico `any`). Los dos handlers hacen lo que hace `invoiceDueReminder`: se crean su propio `createAdminClient()` tipado y usan `ctx` solo para `job` y `logEvent`.
- **Prioridad 8** en ambos: por debajo de `whatsapp_template` (4), `whatsapp_reply` (5) e `invoice_due_reminder` (7). Una matriz que nadie mira no puede adelantarse al recordatorio de factura, que se envía *at most once* y no tiene otra superficie si falla.
- Se llenan `client_id`, `triggered_by`, `content_matrix_id`, y en el hijo `content_matrix_item_id` y `parent_job_id`.

### Migración 0131 — enlaces y candados

```sql
alter table public.ai_jobs
  add column if not exists content_matrix_id uuid references public.content_matrices(id) on delete cascade,
  add column if not exists content_matrix_item_id uuid references public.content_matrix_items(id) on delete cascade;

create unique index if not exists ai_jobs_one_active_matrix_generate
  on public.ai_jobs(content_matrix_id)
  where status in ('pending','processing') and job_type = 'matrix_generate';

create unique index if not exists ai_jobs_one_active_matrix_item_write
  on public.ai_jobs(content_matrix_item_id)
  where status in ('pending','processing') and job_type = 'matrix_item_write';

alter table public.content_matrix_items
  add column if not exists ai_written_at timestamptz;
```

`on delete cascade` porque un job de una matriz borrada no le sirve a nadie (no porque los `null` rompan el índice: en btree los nulos no colisionan entre sí).

Los dos índices cubren `processing` además de `pending` —la variante de 0126, no la de 0091— porque aquí el trabajo en curso sí debe bloquear. Se inserta **fila por fila tragando el 23505 por código** (`error.code !== '23505'`), sin pre-chequeo: es el patrón del repo y la única forma libre de carreras. En el padre, 23505 se traduce a "Ya hay una generación en curso para esta matriz."; en el hijo significa "esa pieza ya está en cola" y **no es un error** (es justo lo que hace idempotente el re-encolado del padre y el doble clic en "Regenerar").

**El índice del padre no es la garantía contra dos juegos de piezas** —solo vale mientras el job está vivo—: la garantía real es el paso 2, abajo.

`ai_written_at` da dos cosas que no se pueden derivar: qué piezas escribió la IA (auditoría) y la diferencia entre "sin redactar" y "el usuario borró el copy a propósito".

### El padre, paso a paso

1. `loadMatrixEditorData(admin, matrixId)` + perfil de marca. Si la matriz no está en `draft`, `skipped`: generar dentro de una matriz **aprobada** es peligroso porque el barrido del bloque 2 convertiría las piezas nuevas en requerimientos reales sin que nadie las revisara.
2. **Idempotencia (el punto que hace inofensivo al watchdog de 0124).** El trabajo del padre se define como dos invariantes, no como "correr una vez":
   - (a) que existan piezas hasta cubrir el cupo faltante;
   - (b) que **toda pieza sin redactar tenga un hijo vivo**.
   Al arrancar comprueba las dos. Si (a) está cubierto pero (b) no —el caso de morir entre el insert y el encolado, justo después de la llamada al modelo, que es donde más probable es que lo maten— **encola los hijos que faltan y termina**, sin llamar al modelo. Solo si no falta nada por ninguna de las dos vías devuelve `skipped`.
3. Una llamada a Anthropic con salida estructurada (una tool con `input_schema` y `tool_choice` forzado a esa tool): temas (si faltan) y la lista de piezas con tipo dentro del reparto, `title`, índice de tema, `objective`, `needs_production`, `estimated_time_minutes`.
4. **`sanitizeGeneratedPlan`** (dominio puro) es el único filtro entre el modelo y la base — `validateItemPatch` **no** está en este camino, porque el handler escribe con el admin client y no pasa por `updateItem`. Descarta tipos fuera de `MATRIX_CONTENT_TYPES` y fuera de `activeTypes`, recorta por tipo al cupo faltante, descarta objetivos inválidos y títulos vacíos, acota el estimado a `1..MATRIX_ESTIMATE_MAX_MINUTES`, resuelve el índice de tema y corta el total. Si queda vacío, el job termina `completed` con `itemsCreated: 0` y `reason: 'sin_plan_valido'`, y la franja lo dice: terminar en silencio parecería éxito.
5. Guarda los temas con el update condicional.
6. **Recalcula el faltante** (I2) y recorta; inserta las piezas en una sola operación, con `deadline` acumulativo.
7. Encola un hijo por pieza —**ordenadas por `deadline`**, para que se vayan llenando primero las más urgentes— y dispara el runner.
8. Acumula `cost_usd_cents` y `tokens_*` y devuelve `{ topics, itemsCreated, childJobs }`.

### El hijo, paso a paso

1. Lee la pieza y su matriz. **Si la pieza ya no existe, `skipped`** (no un throw: quemaría los tres intentos y aparecería en la lista de jobs fallidos por nada). Si la matriz está `closed`, `skipped`. Una pieza `blocked` sí se redacta: el brief no es ninguno de los campos congelados.
2. Llama a Anthropic con el bloque de sistema (perfil de marca + contexto de la matriz) marcado con `cache_control: { type: 'ephemeral' }`. **Sin prometer ahorro**: la caché efímera vive unos 5 minutos y tiene un mínimo de bloque que un perfil corto puede no alcanzar; si pega, bien.
3. `sanitizeGeneratedBrief` (dominio puro) recorta cada campo.
4. Actualiza la pieza y pone `ai_written_at`. **Si está `converted`, no toca `title`, `content_type`, `deadline`, `assigned_to` ni `estimated_time_minutes`.**
5. Acumula costo y tokens.

### Costo acumulado, no sobrescrito

Los dos handlers **suman** sobre lo que ya haya en la fila (`cost_usd_cents = coalesce(actual,0) + nuevo`, igual con los tokens). Un job rescatado por el watchdog paga dos llamadas al modelo; sobrescribiendo, registraría una y la futura pantalla de consumo subestimaría justo los fallos que interesa ver. La fórmula es la de `whatsappReply.ts` (`/1_000_000`, `Math.ceil(usd*100)`, **sin** el `*100` de más que costó la 0123), con su limitación conocida: no lee `cache_creation_input_tokens`, así que la escritura de caché se cobra a precio de entrada normal y el total queda ~1.25× por debajo.

### Presupuesto de tiempo en el runner (corrección de fondo)

`maxDuration = 60` es de la **ruta**, no de cada job: `runJobs` encadena `maxJobs` trabajos sin mirar el reloj. Con jobs de WhatsApp de pocos segundos nunca dolió; con briefs completos, sí. Este bloque añade a `runJobs` la misma guarda que el barrido del bloque 2: **antes de reclamar el siguiente job**, si pasaron más de `RUNNER_BUDGET_MS = 45_000`, corta y devuelve `stoppedEarly`. Sin eso, la plataforma mata la función a mitad de una llamada al modelo, el job queda `processing` con el intento ya consumido (`claim_ai_job` incrementa al reclamar) y solo se recupera cinco minutos después; tres veces y queda `failed` sin que nada estuviera mal.

Con la guarda, el fan-out es honesto: el padre dispara **`min(5, ceil(hijos / 3))`** invocaciones del runner en paralelo con `?max=3&wait=0`. `for update skip locked` reparte los trabajos entre ellas sin solaparse. 15 piezas se redactan en una sola tanda de ~45 s; lo que quede lo drena el cron del minuto.

El disparo hoy está **duplicado** en `webhook/route.ts` y en `whatsappNotify.ts`, con parámetros distintos (`max=3`/debounce y `max=2`/0). Se extrae a `src/lib/ai/trigger.ts` — `triggerJobRunner({ max, waitMs })` — y los dos llamadores pasan a usarlo con sus valores. Un tercer duplicado sería el que se desincroniza.

### Modelo y prompts

Los prompts viven en `src/lib/ai/matrix/prompts.ts` (código, no base): no hay `wa_bot_configs` para matrices y no vale la pena inventar una tabla de configuración para dos prompts.

- Modelo: `process.env.ANTHROPIC_MATRIX_MODEL || 'claude-sonnet-4-6'`. **Variable propia a propósito**: `ANTHROPIC_MODEL` la usa el bot de WhatsApp y cambiarla para el bot no debe cambiar en silencio la generación de matrices.
- Padre: `max_tokens: 4000`, `temperature: 0.7`. Hijo: `max_tokens: 1500`, `temperature: 0.8`.
- Si falta `ANTHROPIC_API_KEY`, el handler lanza y el job termina `failed` tras los reintentos.

### Progreso en vivo

**Route handler** `GET /api/matrices/[id]/generation`, no server action: una server action no acepta `AbortSignal` y el sondeo necesita cancelar la petición anterior. Va autenticada por sesión (queda bajo el middleware normal; **no** se agrega a `SECRET_AUTH_API_PREFIXES`), re-valida rol admin/supervisor y lee `ai_jobs` con el admin client, porque su única policy de `select` es `is_admin()` y un supervisor no la pasa.

```ts
// GET /api/matrices/[id]/generation?since=<ISO updated_at>
{ phase: 'planning' | 'writing' | 'idle' | 'failed',
  total: number, done: number, failed: number,
  writingItemIds: string[],      // de ai_jobs.content_matrix_item_id
  error: string | null,
  items: ContentMatrixItem[] }   // solo las filas con updated_at > since
```

`phase: 'failed'` existe porque un padre `failed` no está ni `pending` ni `processing`: sin ese estado el editor mostraría "terminado" ante un fallo. `items` va acotado por `since` (marca de agua que manda el cliente): devolver la matriz entera cada 3 s serían ~150 kB por sondeo con `script` de hasta 10 000 caracteres.

El editor sondea cada 3 s mientras haya generación viva, con la forma de `useNotifications`: `AbortController` que cancela la petición anterior, pausa con la pestaña oculta y refetch al volver, limpieza completa en el `return` del efecto.

**La fusión de filas** es el punto delicado y **necesita algo que el editor todavía no tiene**: `latestSeqByField` guarda la última secuencia *iniciada* por campo y nunca se limpia al terminar, así que no sabe si hay un guardado **en vuelo**. Este bloque agrega un contador por campo en `beginFieldSave` —el único punto por el que pasan todos los guardados del editor— y la regla de fusión queda:

- pieza desconocida → se agrega, salvo que esté en el conjunto de **lápidas** (ids borrados localmente): sin eso, un sondeo emitido antes de un borrado resucitaría la pieza que el usuario acaba de eliminar;
- pieza conocida → se actualizan solo los campos **sin guardado en vuelo y sin borrador fallido**. La ventana es real: `MatrixItemSheet.commitText` limpia el borrador local **antes** de que la respuesta llegue, así que sin la regla el sondeo revertiría visiblemente lo recién escrito.

Si el usuario cierra la pestaña, el trabajo sigue: son jobs en la base, no una petición HTTP abierta.

---

## Parte 4 — Regenerar una pieza

Botón **"Regenerar"** en el panel lateral y caja opcional de instrucciones (300 caracteres, validados también en el servidor; viajan en `input_json`, así que sobreviven a un re-arranque del watchdog). Encola un `matrix_item_write` y la fila muestra "Redactando…".

- No existe "regenerar todo": de 15 piezas hay 2 que no convencen, y rehacerlo todo tiraría el trabajo del resto.
- Reescribe `copy`, `script`, `visual_style`, `hashtags`, `cta`, `objective` y `needs_production`.
- Funciona en matriz `draft` y `approved` (los textos siguen editables tras aprobar y el requerimiento los lee en vivo), **nunca en `closed`**.
- Doble clic: el segundo encolado choca con el índice único del hijo y se ignora, así que no hay dos escrituras compitiendo.
- "Sin redactar" = la pieza tiene `ai_written_at` nulo y un hijo fallido o ninguno, con el copy vacío. La fila lo muestra con el botón "Regenerar" al lado.

---

## Parte 5 — Errores y límites

- **Un hijo que falla** deja la pieza creada y sin texto, recuperable a mano. No hay reintento más allá de los `max_attempts = 3` del runner: insistir con un prompt que falló da el mismo resultado y quema tokens.
- **El padre que falla** antes del insert no deja piezas; si falla después, los hijos ya están encolados o los re-encola el paso 2 en el siguiente intento.
- **Sin tope de gasto en este bloque**, decisión consciente: el costo queda por job, pero no hay límite de generaciones ni pantalla de consumo de IA fuera de WhatsApp. Si el gasto se vuelve tema, el paso siguiente es una pantalla que lea `ai_jobs` por `job_type`.
- **`src/types/db.ts` va al día** con `ai_jobs`: le faltan `wa_conversation_id` y `tokens_input/output/cached` (`invoice_id` sí está), más las dos columnas nuevas y `content_matrix_items.ai_written_at`. Los handlers usan su propio cliente tipado, así que el tipo tiene que ser correcto en vez de esparcir `as never`.

---

## Parte 6 — Verificación

**Dominio puro con tests** (`src/lib/domain/matrix-ai.ts`):

- `missingByType(limits, usage)` — faltante por tipo y por pool; usa `credits`, no `availableCredits`; cero historias bajo pool; solo `activeTypes`.
- `sanitizeGeneratedPlan(raw, ctx)` — tipos inválidos o inactivos, más piezas de las que caben, objetivos inventados, títulos vacíos, índice de tema fuera de rango, estimados absurdos, lista vacía.
- `sanitizeGeneratedBrief(raw)` — recorte por campo en el último espacio, code-point-aware, con emojis; hashtags y CTA vacíos permitidos.
- `hasUsableBrandProfile(profile)` — los cuatro campos obligatorios.
- `assignDeadlines(plan, ctx)` — reparto por distribución semanal, sin amontonar.
- `pendingChildWork(items, jobs)` — la invariante (b) del paso 2: qué piezas necesitan hijo.

**Recorrido manual** (requiere 0131 aplicada y sesión real): llenar un perfil; generar en una matriz vacía y ver aparecer las piezas; cerrar la pestaña a mitad y volver; regenerar con instrucciones; doble clic en generar; generar con el cupo lleno; generar en un plan con pool; aprobar la matriz generada y comprobar que el bloque 2 convierte con normalidad.
