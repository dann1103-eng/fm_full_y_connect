# FM CRM — Contexto del proyecto

> Documento de arranque para continuar el trabajo en otra sesión.
> Última actualización: 2026-04-22 (commit `8e6c91d`).

---

## Stack

- Next.js 16.2.4 App Router con Turbopack (¡no es el Next.js clásico, leer AGENTS.md!)
- React 19.2.4 con lint estricto (`react-hooks/set-state-in-effect`, `react-hooks/purity`)
- TypeScript, Tailwind v4, shadcn/ui, @base-ui/react
- Supabase (Postgres + Auth + Storage + Realtime) — project `witcgfylutplgfxvzoab`
- @dnd-kit/core para pipeline DnD
- date-fns v4 — obligatorio para timezone-safety
- Vitest v2 — 42 tests unitarios
- Repo: github.com/dann1103-eng/fm_full_y_connect
- Rama: `master`

---

## Reglas ESLint que muerden

- **`react-hooks/purity`**: nunca `Date.now()` en render → usar `new Date().getTime()`
- **`react-hooks/set-state-in-effect`**: no setState sincrónico en body de useEffect → useMemo o setState en callback; si inevitable, `// eslint-disable-next-line react-hooks/set-state-in-effect`
- `redirect()` de `next/navigation` lanza internamente — siempre última línea en Server Actions

---

## Supabase — 2 clientes, nunca confundir

```ts
// Server components / Server Actions:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()   // async

// 'use client':
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()          // sync

// Admin (bypass RLS, solo server):
import { createAdminClient } from '@/lib/supabase/admin'
const admin = createAdminClient()
```

---

## Modelo de datos (tablas clave)

```
clients → billing_cycles → requirements → requirement_phase_logs
                         → requirement_cambio_logs

conversations → conversation_members → messages → message_attachments

review_assets → review_versions → review_version_files (nueva, 0049)
                               → review_pins → review_comments → review_comment_mentions
```

### billing_cycles — columnas relevantes

| Columna | Descripción |
|---|---|
| `limits_snapshot_json` | Snapshot de límites del plan al crear el ciclo |
| `rollover_from_previous_json` | Contenido traspasado del ciclo anterior |
| `content_limits_override_json` | Override admin de cantidades (ej. +2 estáticos) |
| `weekly_distribution_override_json` | Override semanal explícito |
| `cambios_packages_json` | Paquetes extra de cambios |
| `extra_content_json` | Contenido adicional vendido fuera del plan |

### review_version_files (migración 0049 — **aplicar si no está**)

```sql
create table review_version_files (
  id uuid primary key,
  version_id uuid references review_versions(id) on delete cascade,
  file_order int,           -- 0..N-1
  storage_path text,
  thumbnail_path text,
  mime_type text,
  byte_size bigint,
  duration_ms int,
  created_at timestamptz
);
-- review_pins.file_id uuid references review_version_files(id)
```

---

## Colores del sistema de diseño

```
teal:  #00675c    rojo:  #b31b25
gris:  #595c5e    borde: #dfe3e6    fondo: #f5f7f9

CSS tokens (dark-mode-safe, usar estos en componentes de review):
  fm-primary, fm-on-surface, fm-surface-container-lowest,
  fm-surface-container-high, fm-background, fm-error
```

---

## Archivos clave del dominio

| Archivo | Rol |
|---|---|
| `src/types/db.ts` | Tipos TS **manuales** (NO auto-generados) — editar al cambiar schema |
| `src/lib/domain/plans.ts` | `effectiveLimits`, `applyContentLimitsWithOverride`, `CONTENT_TYPE_LABELS` |
| `src/lib/domain/requirement.ts` | `computeTotals`, `computeWeeklyBreakdownWithCascade` |
| `src/lib/domain/dates.ts` | Utilidades timezone-safe |
| `src/app/actions/content-review.ts` | Server actions del módulo de revisión |
| `src/app/actions/inbox.ts` | Server actions del chat |
| `src/hooks/useInboxPolling.ts` | Realtime + safety poll para inbox |

---

## Módulo de revisión de contenido

### Arquitectura de componentes

```
ContentReviewDialog
  ├── ReviewLeftColumn      — lista assets/versiones; gating "Nueva versión"
  ├── ReviewCenterViewer    — viewer central
  │     ├── ImageViewer / VideoViewer
  │     │     ├── PinOverlay       — marcadores clickeables + hover
  │     │     ├── PinHoverBubble   — preview de comentario al hacer hover
  │     │     └── PinCommentBubble — formulario de creación (pending)
  │     └── FileThumbnailStrip     — tira de miniaturas (si N > 1 archivos)
  └── ReviewRightColumn     — lista de comentarios por pin
```

### Flujo de estado

- `selectedAssetId`, `selectedVersionId`, `selectedFileId`, `selectedPinId` viven en `ContentReviewDialog`.
- `useReviewData` expone: `assets`, `versionsByAsset`, `filesByVersion`, `pinsByVersion`, `commentsByPin`.
- `useReviewRealtime` suscribe a: `review_assets`, `review_versions`, `review_version_files`, `review_pins`, `review_comments`.
- `setSelectedPinId` es un useCallback que auto-cambia `selectedFileId` si el pin pertenece a otro archivo.

### Gating "Nueva versión"

Botón deshabilitado si `(pinsByVersion[latestVersionId] ?? []).some(p => p.status === 'active')`. Validación duplicada en server action `createReviewVersionWithFiles`.

### Upload multi-archivo

Ruta storage: `review-files/{requirement_id}/{asset_id}/v{n}/{index}.{ext}`
Action: `createReviewVersionWithFiles({ assetId, clientId, files[] })`.

### Hover en pines

`PinOverlay` expone `onHoverStart?` / `onHoverEnd?`. Los viewers manejan `hoveredPinId` y renderizan `PinHoverBubble` solo si `hoveredPinId !== selectedPinId && !pending`.

---

## Chat / Inbox

### Componentes

```
FloatingChatProvider       — lista de chats abiertos/minimizados
  └── FloatingChatBubble   — bubble individual (optimistic send)

/inbox/[conversationId]    — thread completo
src/hooks/useInboxPolling.ts — useInboxList + useConversationMessages
```

### Realtime (migración 0050 — **aplicar si no está**)

```sql
alter publication supabase_realtime add table messages, conversations, conversation_members;
alter table messages replica identity full;
alter table conversation_members replica identity full;
```

Sin esta migración, `postgres_changes` nunca dispara y el único canal es el safety poll (10s).

### Optimistic send

`FloatingChatBubble.handleSend` inserta temp-message via `addLocalMessage` antes del await. Si error → muestra "Reintentar". Si ok → `refresh()` reemplaza el array desde servidor.

### `useConversationMessages` — API

```ts
const { messages, loading, refresh, removeMessage, updateMessage, addLocalMessage } =
  useConversationMessages(conversationId)
```

---

## Override de plan en pipeline

`applyContentLimitsWithOverride(limits, cycle.content_limits_override_json)` en `src/lib/domain/plans.ts`. Usado en:
- `src/components/pipeline/NewRequirementFromPipeline.tsx` — antes de `applyUnifiedPool`
- `src/app/(app)/clients/[id]/page.tsx` — mismo patrón

---

## Migraciones — estado actual

| Migración | Estado | Descripción |
|---|---|---|
| 0040–0048 | ✅ Aplicadas | Chat, menciones, billing, review base |
| **0049_review_version_files** | ⚠️ Pendiente | Tabla archivos por versión + `review_pins.file_id` |
| **0050_inbox_realtime** | ⚠️ Pendiente | Realtime para mensajes/conversaciones |

---

## Lint — estado baseline

~9 errores `react-hooks/set-state-in-effect` pre-existentes (no bloqueantes).  
`npm run build` pasa OK. Antes de commit: `npm run lint && npm run build`.

---

## Comandos

```bash
npm run dev    # localhost:3000
npm run lint
npm run build
npm run test   # 42 tests unitarios
git add <archivos específicos>   # NO git add -A
git commit -m "feat|fix|refactor: mensaje en español"
git push origin master
```

---

## Próximas mejoras candidatas (no implementadas)

- Reordenar archivos dentro de una versión (drag-drop en AddFilesDialog)
- Agrupar pines por archivo en ReviewRightColumn con headers "Archivo 1 / 2 / …"
- Marcar automáticamente como leído al entrar al thread de un pin
- Typing indicators en el chat
- Mezclar imágenes + video en la misma versión (schema lo permite, UX pendiente)
- Comparar versión N vs N-1 lado a lado
