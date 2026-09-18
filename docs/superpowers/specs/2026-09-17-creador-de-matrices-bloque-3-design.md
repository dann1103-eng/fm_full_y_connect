# Creador de matrices · Bloque 3 — asistencia con IA

**Fecha:** 2026-09-17
**Bloques previos:** 1 (matrices manuales, `0129`) y 2 (conversión automática, `0130`), ambos en producción.
**Migración de este bloque:** `0131` (perfil de marca + columnas de enlace en `ai_jobs`).

## Objetivo

Que armar la matriz del mes deje de ser escribir 15 piezas en blanco. Un botón **"Generar con IA"** en una matriz en borrador propone los temas del mes y redacta todas las piezas —título, tema, objetivo, copy, guion, estilo visual, hashtags, CTA— dentro del cupo del plan del cliente. El equipo corrige lo que haga falta y aprueba. Nada llega al pipeline sin pasar por la aprobación que ya existe en el bloque 1.

Lo que **no** hace este bloque: generar imágenes, publicar, elegir fechas por su cuenta, tocar requerimientos ya creados, escribir en matrices aprobadas o cerradas, ni exponer nada de esto al portal del cliente.

---

## Parte 1 — El perfil de marca

Sin contexto de marca la IA escribe texto genérico, y texto genérico es lo que hace que nadie vuelva a apretar el botón. El perfil es la entrada obligatoria de todo el bloque.

### Tabla `client_brand_profiles`

Una fila por cliente (`client_id` PK y FK a `clients`), no columnas nuevas en `clients`: son muchos campos y solo los usa esta función.

| Columna | Tipo | Tope | Para qué |
|---|---|---|---|
| `client_id` | `uuid` PK FK `clients(id) on delete cascade` | — | Una fila por cliente |
| `tone` | `text` | 500 | Tono de voz: "cercano pero profesional, sin tecnicismos" |
| `person` | `text` | check | `voseo` \| `tuteo` \| `usted`. En El Salvador esto se equivoca solo y se nota en cada copy |
| `audience` | `text` | 800 | Público objetivo |
| `value_proposition` | `text` | 800 | Qué vende y por qué le compran |
| `offerings` | `text` | 1500 | Productos o servicios que puede mencionar por nombre |
| `avoid` | `text` | 1000 | Qué no decir: temas, palabras, promesas prohibidas |
| `base_hashtags` | `text[]` | 15 × 40 | Los que van siempre |
| `sample_copies` | `jsonb` array de strings | 5 × 1000 | Copys reales que funcionaron. Mueve la calidad más que cualquier adjetivo sobre el tono |
| `notes` | `text` | 2000 | El resto |
| `updated_by_user_id` | `uuid` FK `users` | — | Auditoría |
| `created_at` / `updated_at` | `timestamptz` | — | `updated_at` con el mismo trigger que el resto |

Convenciones idénticas a `0129`/`0130`: checks de longitud **con nombre** (`client_brand_profiles_*_chk`), `check (jsonb_typeof(sample_copies) = 'array')`, una sola policy `for all` de RLS para `role in ('admin','supervisor')`, todo dentro de `begin; set local lock_timeout='5s'; … commit;`.

Los topes viven en `BRAND_TEXT_LIMITS` (dominio) y se usan como `maxLength` en la UI, como validación en la acción y como check en la migración: los mismos tres lados que `MATRIX_TEXT_LIMITS`. `char_length` cuenta code points y `.length` en JS cuenta UTF-16, así que la base nunca es más estricta que la app.

### UI

Tarjeta **"Perfil de marca"** en el perfil del cliente, montada como `ClientMatricesCard`: el loader se dispara en paralelo, va envuelto en `.catch()` para que sin la migración la tarjeta simplemente no aparezca en vez de tumbar la página, y el gateo por rol se hace **al cargar** (`canCreate ? loader : null`), no en el JSX. Solo admin/supervisor. Nada se ve en el portal del cliente: el perfil es del staff. Si más adelante quieren que lo llene el cliente, se abre después; al revés no se puede.

Guardado por campo con server action, sin `revalidatePath` (en este Next 16 `revalidatePath` dentro de una server action re-renderiza la página entera, sea cual sea el path).

### La compuerta

**Sin perfil de marca no se genera.** El botón "Generar con IA" aparece deshabilitado con el aviso "Este cliente no tiene perfil de marca" y un enlace al perfil del cliente. Se considera que hay perfil cuando están llenos `tone`, `audience`, `value_proposition` y `offerings` — los cuatro que el prompt necesita para no inventar. La compuerta se evalúa en el dominio (`hasUsableBrandProfile`) y se re-valida en el servidor al encolar.

---

## Parte 2 — Qué genera y con qué reglas

### Cuántas piezas

Exactamente **el cupo del plan para el período de la matriz, menos lo que la matriz ya tenga**. El generador nunca crea piezas fuera de plan: convertirlas costaría cupo real del cliente y nadie apretó un botón pidiendo eso.

- Los cupos salen de `resolveMatrixLimits` y el faltante de `computeMatrixUsage`, la misma cadena que pintan los chips.
- **Con pool unificado** (`unifiedPool`), el reparto entre `estatico`, `video_corto`, `reel` y `short` **lo propone la IA** dentro del total: sabe de qué va la marca, y una heurística fija repartiría a ciegas. `historia` va aparte, con su propio límite.
- Si no falta nada, no se encola ningún job: la acción responde "La matriz ya cubre el cupo del plan."

### Qué campos escribe

| Lo escribe la IA | Lo pone el sistema |
|---|---|
| Temas del mes (si la matriz no los tiene) | `deadline` — `proposeDeadline`, igual que al agregar una pieza a mano: primera semana con presupuesto libre según la distribución semanal |
| `title`, `topic`, `objective`, `copy`, `script`, `visual_style`, `hashtags`, `cta` | `assigned_to` — prellenado con `default_assignee`, igual que `addItem` (sin `client`/`agent`, sin desactivados) |
| `needs_production` — marcado cuando la pieza exige rodaje o sesión de fotos, no solo diseño | `content_type` — sale del reparto de cupo, no de la libre elección del modelo |
| `estimated_time_minutes` — estimación de producción, editable | |

Las fechas no las elige el modelo a propósito: `proposeDeadline` ya respeta la distribución semanal y el presupuesto por semana, y un modelo eligiendo fechas obligaría a validar y recolocar todo lo que proponga. El equipo mueve lo que quiera después. Las fechas se calculan **una por una, acumulando** las piezas ya propuestas en la misma corrida, para que el presupuesto semanal se consuma de verdad y no salgan las 15 el mismo día.

El estimado sí lo propone la IA porque **aprobar una matriz exige responsable y estimado en cada pieza** (bloque 2): sin proponerlo, generar 15 piezas dejaría 15 campos obligatorios en blanco y la función no ahorraría el trabajo que promete.

### Los temas del mes

- Si la matriz **ya tiene** temas (`topics_json`), la IA los respeta y reparte las piezas entre ellos.
- Si **no tiene**, el job padre propone 3–5 y los guarda con `sanitizeTopics` (respeta `MAX_TOPICS`, el tope de 60 code points por nombre y 200 por nota).
- Toda pieza generada lleva un `topic` de la lista final. Un tema inventado por el modelo que no esté en la lista se descarta (la pieza queda sin tema, que es válido) — `validateItemPatch` rechaza temas fuera de la matriz.

### Dónde cae lo generado

**Directo a la matriz en borrador**, como piezas normales. Es aditivo: completa hasta el cupo y **no toca ninguna pieza existente**. El control de calidad ya existe y es la aprobación de la matriz.

### Longitudes

Cada campo se recorta a su tope de `MATRIX_TEXT_LIMITS` antes de guardar, cortando en el último espacio para no partir una palabra. Recortar es preferible a fallar: una pieza con el copy un poco corto se arregla en dos segundos; una generación que falla entera por 3 caracteres de más, no.

---

## Parte 3 — El motor de generación

### Dos tipos de job sobre la infraestructura que ya existe

`ai_jobs` + `claim_ai_job` + el runner de `src/lib/ai/runner.ts` ya resuelven cola, reintentos con backoff, watchdog de trabajos colgados (0124) y costo por job. Este bloque agrega **dos handlers** al registry —una línea cada uno— y **ningún runtime nuevo**.

| Job | Qué hace |
|---|---|
| `matrix_generate` (padre) | Planifica: decide temas y el reparto de piezas, **crea las filas** de `content_matrix_items` con título, tipo, tema, objetivo, fecha, responsable y estimado, y encola un hijo por pieza. |
| `matrix_item_write` (hijo) | Redacta **una** pieza: `copy`, `script`, `visual_style`, `hashtags`, `cta`, y ajusta `objective`/`needs_production`. También es el job de "Regenerar". |

El corte padre/hijo no es estético: son los 60 s de `maxDuration` de Vercel. Redactar 15 piezas en una sola llamada no cabe, y un fallo a la pieza 12 tiraría las 11 anteriores.

**Las piezas se crean todas en el paso del padre, vacías de texto.** Así el progreso es visible de inmediato (la tabla se puebla), un hijo que falle deja una pieza sin redactar —recuperable con "Regenerar"— en vez de un hueco, y el estado "cuántas faltan" se lee de la base sin inventar un campo de progreso.

- Prefijo: **no** puede empezar con `whatsapp_`. El runner elige el cliente Supabase por prefijo (`job_type.startsWith('whatsapp_')`), y estos handlers quieren el cliente **tipado**.
- Prioridad **6** en ambos: por debajo de `whatsapp_reply` (5) y `whatsapp_template` (4). Un cliente esperando respuesta del bot va antes que una matriz que nadie está mirando.
- `client_id` y `triggered_by` se llenan siempre; `content_matrix_id` en los dos y `content_matrix_item_id` en el hijo; `parent_job_id` en el hijo (la columna existe desde 0082 y hasta hoy nadie la escribía).

### Enlaces y candado de concurrencia (migración 0131)

```sql
alter table public.ai_jobs
  add column if not exists content_matrix_id uuid references public.content_matrices(id) on delete cascade,
  add column if not exists content_matrix_item_id uuid references public.content_matrix_items(id) on delete cascade;

create unique index if not exists ai_jobs_one_active_matrix_generate
  on public.ai_jobs(content_matrix_id)
  where status in ('pending','processing') and job_type = 'matrix_generate';
```

`on delete cascade` (no `set null`, a diferencia de `client_id`): un job de una matriz borrada no le sirve a nadie, y dejarlo con la columna en `null` haría que el índice único dejara de proteger a la matriz siguiente.

El índice cubre `processing` además de `pending` —la variante de 0126, no la de 0091— porque aquí el trabajo colgado sí debe bloquear: dos padres simultáneos crearían dos juegos de piezas. Se inserta y **se traga el 23505** (`if (error.code !== '23505')`), sin pre-chequeo: es el patrón del repo y la única forma libre de carreras. Un 23505 se traduce a "Ya hay una generación en curso para esta matriz."

Para el hijo no hay índice de dedupe: regenerar la misma pieza dos veces es idempotente (reescribe los mismos campos) y bloquearlo daría un error donde el usuario espera un resultado.

### El padre, paso a paso

1. Lee matriz, piezas, cliente con plan, ciclo del período y perfil de marca. Si la matriz no está en `draft`, sale con `skipped` (generar dentro de una matriz **aprobada** es peligroso: el barrido del bloque 2 convertiría las piezas nuevas a requerimientos reales sin que nadie las revisara).
2. Calcula el faltante por tipo (`resolveMatrixLimits` → `computeMatrixUsage`). **Si no falta nada, `skipped`.** Esto es lo que hace al handler idempotente frente al watchdog de 0124: un re-arranque a los 5 minutos vuelve a mirar la base, ve las piezas ya creadas y no duplica nada.
3. Una llamada a Anthropic con salida estructurada (una tool con `input_schema` y `tool_choice` forzado): devuelve temas (si faltan) y la lista de piezas con `content_type` dentro del cupo, `title`, `topic`, `objective`, `needs_production`, `estimated_time_minutes`.
4. **Sanea lo que devuelve el modelo** (`sanitizeGeneratedPlan`, dominio puro): descarta tipos fuera de `MATRIX_CONTENT_TYPES`, recorta por tipo al cupo faltante, descarta objetivos inválidos, títulos vacíos y temas fuera de la lista, acota el estimado a `1..MATRIX_ESTIMATE_MAX_MINUTES` y corta el total. Nada de lo que devuelve el modelo llega a la base sin pasar por aquí.
5. Guarda los temas (`sanitizeTopics`) si la matriz no los tenía.
6. Inserta las piezas, calculando `deadline` con `proposeDeadline` de forma acumulativa.
7. Encola un `matrix_item_write` por pieza (fila por fila, tragando 23505) y dispara el runner (fire-and-forget).
8. Escribe `cost_usd_cents` y `tokens_*` y devuelve `{ topics, itemsCreated, childJobs }`.

### El hijo, paso a paso

1. Lee la pieza, su matriz y el perfil de marca. Si la matriz está `closed`, `skipped`.
2. Llama a Anthropic con el mismo bloque de sistema que el padre —perfil de marca + contexto de la matriz— marcado con `cache_control: { type: 'ephemeral' }`. Los N hijos de una matriz comparten ese bloque: a partir del segundo, se paga como lectura de caché (10× más barato).
3. Sanea y recorta a `MATRIX_TEXT_LIMITS` (`sanitizeGeneratedBrief`, dominio puro).
4. Actualiza la pieza. **Si la pieza está `converted`, no toca `title`, `content_type`, `deadline`, `assigned_to` ni `estimated_time_minutes`**: son los cinco campos que el bloque 2 congela porque se copiaron al requerimiento.
5. Escribe costo y tokens.

### Disparo y drenado de la cola

El runner se dispara igual que hoy: un `fetch` sin `await` a `/api/ai-jobs/process`. Hoy ese código está **duplicado** en `src/app/api/whatsapp/webhook/route.ts` y en `src/app/actions/whatsappNotify.ts`; este bloque lo extrae a `src/lib/ai/trigger.ts` (`triggerJobRunner({ max, waitMs })`) y deja a los dos llamadores usándolo. Un tercer duplicado sería el que se desincroniza.

Con `?max=10` una corrida atiende 10 piezas; el cron de cada minuto drena el resto. Una matriz de 15 piezas queda lista en uno o dos minutos, con las piezas apareciendo conforme terminan.

### Progreso en vivo

Server action `getMatrixGenerationStatus(matrixId)` (admin client tras `requireManager`, porque `ai_jobs` solo tiene policy de `select` para admin) devuelve:

```ts
{ active: boolean, phase: 'planning' | 'writing' | 'idle',
  total: number, done: number, failed: number,
  writingItemIds: string[], error: string | null,
  items: ContentMatrixItem[] }
```

El editor la consulta cada 3 s mientras haya generación activa, con la forma de `useNotifications`: `AbortController` que cancela la petición anterior, pausa mientras la pestaña está oculta y refetch al volver si pasaron más de 3 s, y limpieza completa en el `return` del efecto. Al terminar, deja de consultar.

**La fusión de filas es el punto delicado.** El editor del bloque 1 mantiene su estado en cliente con refs de confirmación y una secuencia por campo. El sondeo aplica las filas del servidor así: las piezas desconocidas se agregan; en las conocidas se actualizan solo los campos **sin** guardado en vuelo ni borrador fallido. Sin esa regla, una respuesta del sondeo pisaría lo que el usuario está escribiendo mientras la IA redacta el resto.

Si el usuario cierra la pestaña, el trabajo sigue: son jobs en la base, no una petición HTTP abierta. Al volver a la matriz encuentra las piezas escritas.

---

## Parte 4 — Regenerar una pieza

En el panel lateral: botón **"Regenerar"** y una caja opcional de instrucciones (tope 300 caracteres) — "más corto", "tono más informal", "enfócalo en el precio". Encola un `matrix_item_write` con `{ itemId, instructions }` y muestra la pieza como "redactando…".

- El caso real es que de 15 piezas hay 2 que no convencen. Regenerar la matriz entera por eso tiraría el trabajo del resto, así que **no existe "regenerar todo"**.
- Reescribe `copy`, `script`, `visual_style`, `hashtags`, `cta`, `objective` y `needs_production`.
- Funciona en matriz `draft` y `approved` (los textos siguen siendo editables tras aprobar y el requerimiento los lee en vivo), **nunca en `closed`**.
- En una pieza `converted`, los cinco campos congelados quedan intactos.

---

## Parte 5 — Errores, costo y límites

- **Sin `ANTHROPIC_API_KEY`** el handler lanza y el job termina `failed` tras los reintentos del runner; la acción de encolar no falla (el job ya está en la cola). El editor muestra el error del job en la franja de estado.
- **Un hijo que falla** deja la pieza creada y sin texto. La tabla la muestra como "Sin redactar" con el botón "Regenerar". No hay reintento automático más allá de los `max_attempts = 3` del runner: insistir con un prompt que falló da el mismo resultado y quema tokens.
- **El padre que falla** no deja piezas a medias: crea todas las filas en una sola operación, después de sanear. Si falla antes, no hay piezas; si falla después, los hijos ya están encolados.
- **Costo**: los dos handlers escriben `cost_usd_cents`, `tokens_input`, `tokens_output` y `tokens_cached` con la fórmula exacta de `whatsappReply.ts` (`/1_000_000` y `Math.ceil(usd * 100)` — **sin** el `*100` de más que costó la migración 0123). Orden de magnitud por matriz de 15 piezas: un padre de ~3k tokens de entrada y ~2k de salida, más 15 hijos que comparten el bloque de sistema cacheado; unos pocos centavos de dólar.
- **Sin tope de gasto en este bloque.** Es una decisión consciente: el costo queda registrado por job, pero no hay límite de generaciones por matriz ni por mes, y la pantalla `/admin/whatsapp` solo muestra jobs de WhatsApp. Si el gasto se vuelve un tema, el siguiente paso es una pantalla de consumo de IA que lea `ai_jobs` por `job_type` — fuera del alcance de este bloque.
- **`src/types/db.ts` está desfasado** respecto a `ai_jobs`: le faltan `wa_conversation_id`, `invoice_id` y `tokens_*`. Como estos handlers reciben el cliente **tipado**, este bloque pone al día ese tipo (incluidas las dos columnas nuevas) en vez de esparcir `as never`.

---

## Parte 6 — Verificación

**Dominio puro con tests** (`src/lib/domain/matrix-ai.ts`), que es donde se puede probar de verdad sin base ni API:

- `missingByType(limits, usage)` — cuánto falta por tipo y cuánto queda del pool unificado.
- `sanitizeGeneratedPlan(raw, ctx)` — el modelo devuelve tipos inválidos, más piezas de las que caben, objetivos inventados, temas fuera de la lista, estimados absurdos, títulos vacíos: cada caso tiene su test.
- `sanitizeGeneratedBrief(raw)` — recorte por campo en el último espacio, sin partir palabras; hashtags y CTA vacíos permitidos.
- `hasUsableBrandProfile(profile)` — los cuatro campos obligatorios.
- `assignDeadlines(plan, ctx)` — las fechas se reparten por la distribución semanal y no se amontonan.

**Recorrido manual** (requiere 0131 aplicada y sesión real): llenar un perfil de marca; generar en una matriz vacía y ver aparecer las piezas; cerrar la pestaña a mitad y volver; regenerar una pieza con instrucciones; intentar generar dos veces a la vez; generar con el cupo lleno; aprobar la matriz generada y comprobar que el bloque 2 convierte con normalidad.
