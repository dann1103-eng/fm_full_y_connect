# Portal Client Request Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al cliente adjuntar archivos (máx. 3) y links (máx. 5) al solicitar un requerimiento, y ver/editar/cancelar sus solicitudes pending desde el dashboard del portal.

**Architecture:** 8 tareas independientes en cascada: primero el schema de DB y los tipos TS, luego el helper de storage, luego las server actions, luego los componentes del portal (modal + sección), luego el dashboard, y finalmente la vista del staff. Cada tarea termina con `npm run lint && npm run build` para garantizar cero errores TS/ESLint antes de continuar.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Supabase (Postgres + Storage), `createAdminClient()` para writes en server actions.

**Spec:** `docs/superpowers/specs/2026-05-12-portal-client-request-attachments-design.md`

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `supabase/migrations/0090_client_request_attachments.sql` | CREAR | Columnas + RLS UPDATE policy |
| `src/types/db.ts` | MODIFICAR | Añadir columnas a requirements + interfaces `ClientRequestAttachment`, `ClientRequestLink` |
| `src/lib/supabase/upload-req-attachment.ts` | MODIFICAR | Añadir `uploadRequirementAttachmentRaw` para tipos no-imagen |
| `src/app/actions/requirementRequests.ts` | MODIFICAR | Añadir `updateRequirementRequest` y `cancelRequirementRequest` |
| `src/components/portal/ClientRequestRequirementModal.tsx` | MODIFICAR | Scroll, archivos, links, modo edición |
| `src/components/portal/PendingRequestsSection.tsx` | CREAR | Tarjetas de solicitudes pending/rejected + editar/retirar |
| `src/app/(portal)/portal/dashboard/page.tsx` | MODIFICAR | Query pending/rejected + renderizar `<PendingRequestsSection>` |
| `src/app/(app)/solicitudes/page.tsx` | MODIFICAR | Añadir `client_request_attachments_json` y `client_request_links_json` al SELECT |
| `src/app/(app)/solicitudes/SolicitudesList.tsx` | SIN CAMBIOS | Los nuevos campos fluyen automáticamente via `extends PendingRequest` |
| `src/components/requirements/ApproveRequestModal.tsx` | MODIFICAR | Sección "Referencias del cliente" |

---

## Task 1: Migración 0090 — Schema + RLS

**Files:**
- Create: `supabase/migrations/0090_client_request_attachments.sql`

- [ ] **Paso 1: Crear el archivo de migración**

```sql
-- supabase/migrations/0090_client_request_attachments.sql
-- Agrega columnas de adjuntos y links a solicitudes del cliente,
-- y policy RLS UPDATE para que el cliente pueda editar sus propias solicitudes pending.

begin;

alter table public.requirements
  add column if not exists client_request_attachments_json jsonb null,
  add column if not exists client_request_links_json jsonb null;

-- RLS: work user puede actualizar sus propias solicitudes mientras estén pending.
-- La server action usa adminClient (bypass RLS), así que esta policy es defensa adicional.
drop policy if exists "Work users can update own pending requests" on public.requirements;
create policy "Work users can update own pending requests" on public.requirements
  for update
  using (
    approval_status = 'pending'
    and requested_by_user_id = auth.uid()
    and exists (
      select 1 from public.billing_cycles bc
      where bc.id = requirements.billing_cycle_id
        and public.is_work_user_of(bc.client_id)
    )
  )
  with check (
    approval_status = 'pending'
    and requested_by_user_id = auth.uid()
  );

commit;
```

- [ ] **Paso 2: Aplicar la migración en Supabase SQL Editor**

Abrir Supabase Dashboard → SQL Editor → pegar el contenido del archivo → ejecutar.
Verificar que devuelva `ALTER TABLE` y `CREATE POLICY` sin errores.

- [ ] **Paso 3: Commit**

```bash
git add supabase/migrations/0090_client_request_attachments.sql
git commit -m "feat: migración 0090 — columnas adjuntos/links en requirements + RLS UPDATE"
```

---

## Task 2: Tipos TypeScript

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Paso 1: Agregar interfaces de dominio al final del archivo**

Localizar el bloque de exports al final de `src/types/db.ts` (cerca de `export type MessageAttachment`). Agregar:

```ts
export interface ClientRequestAttachment {
  path: string       // path en bucket: {requirementId}/{uuid}.{ext}
  publicUrl: string  // URL pública del bucket requirement-attachments
  name: string       // nombre original del archivo
  mime: string       // mime type, ej: 'image/jpeg', 'application/pdf'
  sizeBytes: number
}

export interface ClientRequestLink {
  url: string
}
```

- [ ] **Paso 2: Agregar columnas al Row de requirements**

Buscar en `src/types/db.ts` la sección `Row:` de la tabla `requirements` (tiene campos como `approval_status`, `client_requested_notes`, etc.). Agregar después de `rejected_by_user_id`:

```ts
client_request_attachments_json: ClientRequestAttachment[] | null
client_request_links_json: ClientRequestLink[] | null
```

- [ ] **Paso 3: Agregar columnas al Insert de requirements**

En la sección `Insert:` de requirements, agregar:

```ts
client_request_attachments_json?: ClientRequestAttachment[] | null
client_request_links_json?: ClientRequestLink[] | null
```

- [ ] **Paso 4: Agregar columnas al Update de requirements**

En la sección `Update:` de requirements, agregar:

```ts
client_request_attachments_json?: ClientRequestAttachment[] | null
client_request_links_json?: ClientRequestLink[] | null
```

- [ ] **Paso 5: Verificar tipos**

```bash
npm run build 2>&1 | head -30
```

Esperado: sin errores de tipo nuevos.

- [ ] **Paso 6: Commit**

```bash
git add src/types/db.ts
git commit -m "feat: tipos TS para adjuntos y links de solicitudes del cliente"
```

---

## Task 3: Upload Helper — soporte tipos no-imagen

**Files:**
- Modify: `src/lib/supabase/upload-req-attachment.ts`

> ⚠️ **Importante:** `uploadRequirementAttachmentRaw` es un helper **cliente** (usa `createClient` de `./client`). Solo llamarla desde componentes React client-side. **Nunca importarla desde una server action.** La server action `cancelRequirementRequest` borra archivos directamente con `adminClient.storage.remove()` — no usa este helper.

- [ ] **Paso 1: Agregar función `uploadRequirementAttachmentRaw`**

Al final de `src/lib/supabase/upload-req-attachment.ts`, después de `deleteRequirementAttachments`, agregar:

```ts
const MAX_RAW_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Sube un archivo de cualquier tipo (no-imagen) al bucket `requirement-attachments`
 * sin compresión. Límite: 10 MB.
 * Usar para PDF, video, archivos de diseño, etc.
 * Para PNG/JPG/WebP usar `uploadRequirementAttachment` (con compresión).
 */
export async function uploadRequirementAttachmentRaw(
  file: File,
  requirementId: string
): Promise<UploadedAttachment> {
  if (file.size > MAX_RAW_BYTES) {
    throw new Error(`El archivo supera el límite de 10 MB.`)
  }

  const supabase = createClient()
  const ext = file.name.split('.').pop() ?? 'bin'
  const filename = `${crypto.randomUUID()}.${ext}`
  const path = `${requirementId}/${filename}`

  const { error } = await supabase.storage
    .from('requirement-attachments')
    .upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (error) throw new Error(`Error al subir el archivo: ${error.message}`)

  const { data } = supabase.storage.from('requirement-attachments').getPublicUrl(path)

  return {
    path,
    publicUrl: data.publicUrl,
    mime: file.type || 'application/octet-stream',
    name: file.name,
    sizeBytes: file.size,
  }
}
```

- [ ] **Paso 2: Verificar lint y build**

```bash
npm run lint 2>&1 | grep -E "error|warning" | head -20
npm run build 2>&1 | tail -10
```

Esperado: sin errores nuevos.

- [ ] **Paso 3: Commit**

```bash
git add src/lib/supabase/upload-req-attachment.ts
git commit -m "feat: helper uploadRequirementAttachmentRaw para tipos no-imagen (hasta 10 MB)"
```

---

## Task 4: Server Actions — updateRequirementRequest y cancelRequirementRequest

**Files:**
- Modify: `src/app/actions/requirementRequests.ts`

- [ ] **Paso 1: Agregar imports necesarios al inicio del archivo**

Al principio de `src/app/actions/requirementRequests.ts`, verificar que los imports incluyan:

```ts
import type { ContentType, Priority, ClientRequestAttachment, ClientRequestLink } from '@/types/db'
```

Si `ClientRequestAttachment` y `ClientRequestLink` no están importados, agregarlos.

- [ ] **Paso 2: Agregar `updateRequirementRequest`**

Después de la función `requestRequirement`, agregar:

```ts
export interface UpdateRequirementRequestInput {
  requirementId: string
  title: string
  /** Se guarda en requirements.notes y client_requested_notes */
  description: string
  desiredAt: string
  includesStory?: boolean
  /** Array final: existentes (no removidos) + nuevos ya subidos al bucket */
  attachments: ClientRequestAttachment[]
  links: ClientRequestLink[]
}

export async function updateRequirementRequest(
  input: UpdateRequirementRequestInput,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const admin = createAdminClient()

  // Verificar que la solicitud exista, sea pending y pertenezca a este usuario
  const { data: existing } = await admin
    .from('requirements')
    .select('id, approval_status, requested_by_user_id, content_type')
    .eq('id', input.requirementId)
    .maybeSingle()

  if (!existing) return { error: 'Solicitud no encontrada' }
  if (existing.approval_status !== 'pending') return { error: 'Esta solicitud ya fue procesada y no puede editarse' }
  if (existing.requested_by_user_id !== user.id) return { error: 'Sin permiso para editar esta solicitud' }

  const ct = existing.content_type as ContentType
  const isScheduled = SCHEDULED_TYPES.includes(ct)
  const startsAt = isScheduled ? input.desiredAt : null
  const deadline = isScheduled ? null : input.desiredAt
  const clientRequestedDeadline = isScheduled
    ? input.desiredAt
    : `${input.desiredAt}T00:00:00`

  if (!input.title.trim()) return { error: 'El título no puede estar vacío' }
  if (!input.desiredAt) return { error: 'Selecciona la fecha deseada' }

  const { error } = await admin
    .from('requirements')
    .update({
      title: input.title.trim(),
      notes: input.description.trim() || null,
      client_requested_notes: input.description.trim() || null,
      client_requested_deadline: clientRequestedDeadline,
      starts_at: startsAt,
      deadline,
      includes_story: STORY_ELIGIBLE.includes(ct) ? !!input.includesStory : false,
      client_request_attachments_json: input.attachments.length > 0 ? input.attachments : null,
      client_request_links_json: input.links.length > 0 ? input.links : null,
    })
    .eq('id', input.requirementId)

  if (error) {
    console.error('[updateRequirementRequest]', error)
    return { error: 'No se pudo actualizar la solicitud' }
  }

  revalidatePath('/portal/dashboard')
  return { ok: true }
}
```

- [ ] **Paso 3: Agregar `cancelRequirementRequest`**

Después de `updateRequirementRequest`, agregar:

```ts
export async function cancelRequirementRequest(
  requirementId: string,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('requirements')
    .select('id, approval_status, requested_by_user_id, client_request_attachments_json')
    .eq('id', requirementId)
    .maybeSingle()

  if (!existing) return { error: 'Solicitud no encontrada' }
  if (existing.approval_status !== 'pending') return { error: 'Esta solicitud ya fue procesada' }
  if (existing.requested_by_user_id !== user.id) return { error: 'Sin permiso para cancelar esta solicitud' }

  // Borrar archivos del bucket (usar admin client — no el browser client)
  const attachments = (existing.client_request_attachments_json ?? []) as ClientRequestAttachment[]
  if (attachments.length > 0) {
    const paths = attachments.map((a) => a.path)
    await admin.storage.from('requirement-attachments').remove(paths)
  }

  const { error } = await admin
    .from('requirements')
    .update({ voided: true })
    .eq('id', requirementId)

  if (error) {
    console.error('[cancelRequirementRequest]', error)
    return { error: 'No se pudo cancelar la solicitud' }
  }

  revalidatePath('/portal/dashboard')
  return { ok: true }
}
```

- [ ] **Paso 4: Mover `STORY_ELIGIBLE` al scope del módulo**

Abrir `src/app/actions/requirementRequests.ts` y buscar la constante `STORY_ELIGIBLE`. Si está definida dentro de alguna función (ej. dentro de `approveRequirementRequest`), moverla al nivel superior del módulo, junto a `SCHEDULED_TYPES` y `ALLOWED_REQUEST_TYPES`. Si ya está al nivel del módulo, no hacer nada.

El bloque de constantes de módulo debe quedar así:

```ts
const ALLOWED_REQUEST_TYPES: ContentType[] = [ ... ]
const SCHEDULED_TYPES: ContentType[] = ['reunion', 'produccion']
const STORY_ELIGIBLE: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']
```

- [ ] **Paso 5: Lint y build**

```bash
npm run lint 2>&1 | grep -E "error" | head -20
npm run build 2>&1 | tail -15
```

Esperado: sin errores.

- [ ] **Paso 6: Commit**

```bash
git add src/app/actions/requirementRequests.ts
git commit -m "feat: server actions updateRequirementRequest y cancelRequirementRequest"
```

---

## Task 5: Modal de solicitud — scroll, archivos, links y modo edición

**Files:**
- Modify: `src/components/portal/ClientRequestRequirementModal.tsx`

Este es el cambio más extenso. El modal se reescribe para soportar modo creación y modo edición, con campos de archivos y links.

- [ ] **Paso 1: Reemplazar el contenido completo del modal**

Reemplazar `src/components/portal/ClientRequestRequirementModal.tsx` con:

```tsx
'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { requestRequirement, updateRequirementRequest } from '@/app/actions/requirementRequests'
import {
  uploadRequirementAttachment,
  uploadRequirementAttachmentRaw,
} from '@/lib/supabase/upload-req-attachment'
import type { ContentType, ClientRequestAttachment, ClientRequestLink } from '@/types/db'

const REQUESTABLE_TYPES: { value: ContentType; label: string }[] = [
  { value: 'reunion', label: 'Reunión' },
  { value: 'produccion', label: 'Producción' },
  { value: 'estatico', label: 'Estático' },
  { value: 'video_corto', label: 'Video corto (30 seg)' },
  { value: 'reel', label: 'Video largo (90 seg)' },
  { value: 'short', label: 'Short (10 seg)' },
  { value: 'historia', label: 'Historia' },
]

const SCHEDULED_TYPES: ContentType[] = ['reunion', 'produccion']
const STORY_ELIGIBLE: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_FILES = 3
const MAX_LINKS = 5

export interface ExistingRequest {
  id: string
  content_type: ContentType
  title: string
  notes: string | null
  desiredAt: string   // client_requested_deadline ISO string
  includes_story: boolean
  attachments: ClientRequestAttachment[]
  links: ClientRequestLink[]
}

interface Props {
  open: boolean
  onClose: () => void
  /** Si se pasa, el modal opera en modo edición */
  existingRequest?: ExistingRequest
}

export function ClientRequestRequirementModal({ open, onClose, existingRequest }: Props) {
  const router = useRouter()
  const isEditing = !!existingRequest

  const [contentType, setContentType] = useState<ContentType>(
    existingRequest?.content_type ?? 'reunion'
  )
  const [title, setTitle] = useState(existingRequest?.title ?? '')
  const [description, setDescription] = useState(existingRequest?.notes ?? '')
  const [desiredAt, setDesiredAt] = useState(() => {
    if (!existingRequest?.desiredAt) return ''
    // Para scheduled (datetime) ya viene como ISO; para fecha simple, tomar solo la parte date
    const raw = existingRequest.desiredAt
    if (SCHEDULED_TYPES.includes(existingRequest.content_type)) {
      // Convertir a formato datetime-local: yyyy-MM-ddTHH:mm
      return raw.slice(0, 16)
    }
    return raw.slice(0, 10)
  })
  const [includesStory, setIncludesStory] = useState(existingRequest?.includes_story ?? false)

  // Archivos: existentes (ya subidos) + nuevos staged
  const [existingAttachments, setExistingAttachments] = useState<ClientRequestAttachment[]>(
    existingRequest?.attachments ?? []
  )
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Links
  const [links, setLinks] = useState<string[]>(existingRequest?.links.map((l) => l.url) ?? [])
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isScheduled = SCHEDULED_TYPES.includes(contentType)
  const isStoryEligible = STORY_ELIGIBLE.includes(contentType)
  const totalFiles = existingAttachments.length + stagedFiles.length

  if (!open) return null

  function reset() {
    setContentType('reunion')
    setTitle('')
    setDescription('')
    setDesiredAt('')
    setIncludesStory(false)
    setExistingAttachments([])
    setStagedFiles([])
    setFileError(null)
    setLinks([])
    setLinkInput('')
    setLinkError(null)
    setError(null)
    setSuccess(false)
  }

  function handleClose() {
    if (isPending) return
    if (!isEditing) reset()
    onClose()
  }

  // ── Archivos ──────────────────────────────────────────────────────────────

  function handleFileSelect(files: FileList | null) {
    if (!files) return
    setFileError(null)
    const newFiles = Array.from(files)
    if (totalFiles + newFiles.length > MAX_FILES) {
      setFileError(`Máximo ${MAX_FILES} archivos por solicitud`)
      return
    }
    setStagedFiles((prev) => [...prev, ...newFiles].slice(0, MAX_FILES - existingAttachments.length))
  }

  function removeStagedFile(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeExistingAttachment(idx: number) {
    setExistingAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function uploadStagedFiles(requirementId: string): Promise<ClientRequestAttachment[]> {
    const uploaded: ClientRequestAttachment[] = []
    for (const file of stagedFiles) {
      if (IMAGE_TYPES.includes(file.type)) {
        uploaded.push(await uploadRequirementAttachment(file, requirementId))
      } else {
        uploaded.push(await uploadRequirementAttachmentRaw(file, requirementId))
      }
    }
    return uploaded
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  function handleAddLink() {
    setLinkError(null)
    const raw = linkInput.trim()
    if (!raw) return
    try {
      new URL(raw)
    } catch {
      setLinkError('URL inválida. Ejemplo: https://drive.google.com/...')
      return
    }
    if (links.length >= MAX_LINKS) {
      setLinkError(`Máximo ${MAX_LINKS} links`)
      return
    }
    setLinks((prev) => [...prev, raw])
    setLinkInput('')
  }

  function removeLink(idx: number) {
    setLinks((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { setError('Ingresa un título'); return }
    if (!desiredAt) {
      setError(isScheduled ? 'Selecciona la fecha y hora deseada' : 'Selecciona la fecha de entrega deseada')
      return
    }

    startTransition(async () => {
      try {
        if (isEditing && existingRequest) {
          // Modo edición: subir archivos nuevos, luego actualizar
          let newUploaded: ClientRequestAttachment[] = []
          if (stagedFiles.length > 0) {
            newUploaded = await uploadStagedFiles(existingRequest.id)
          }
          const finalAttachments = [...existingAttachments, ...newUploaded]
          const finalLinks: ClientRequestLink[] = links.map((url) => ({ url }))

          const r = await updateRequirementRequest({
            requirementId: existingRequest.id,
            title: title.trim(),
            description: description.trim(),
            desiredAt,
            includesStory: isStoryEligible ? includesStory : false,
            attachments: finalAttachments,
            links: finalLinks,
          })
          if ('error' in r) { setError(r.error); return }
          router.refresh()
          onClose()
        } else {
          // Modo creación
          const r = await requestRequirement({
            contentType,
            title: title.trim(),
            description: description.trim(),
            desiredAt,
            includesStory: isStoryEligible ? includesStory : false,
          })
          if ('error' in r) { setError(r.error); return }

          // Subir archivos si los hay, luego patchear.
          // NOTA: si el upload falla aquí, el requirement ya fue creado (sin adjuntos).
          // No mostramos error catastrófico — el cliente puede editar después.
          if (stagedFiles.length > 0 || links.length > 0) {
            let uploaded: ClientRequestAttachment[] = []
            if (stagedFiles.length > 0) {
              try {
                uploaded = await uploadStagedFiles(r.id)
              } catch (uploadErr) {
                // Seguimos — el requirement ya existe, los adjuntos se pueden agregar editando
                console.warn('[ClientRequestModal] upload parcial:', uploadErr)
              }
            }
            // Solo patchear si hay algo que guardar
            if (uploaded.length > 0 || links.length > 0) {
              await updateRequirementRequest({
                requirementId: r.id,
                title: title.trim(),
                description: description.trim(),
                desiredAt,
                includesStory: isStoryEligible ? includesStory : false,
                attachments: uploaded,
                links: links.map((url) => ({ url })),
              })
            }
          }

          setSuccess(true)
          router.refresh()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al procesar la solicitud')
      }
    })
  }

  const submitLabel = isPending
    ? (isEditing ? 'Guardando…' : 'Enviando…')
    : (isEditing ? 'Guardar cambios' : 'Enviar solicitud')

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
    >
      {/* max-h-[90dvh] + flex-col para que header y footer queden fijos */}
      <div
        className="bg-fm-surface-container-lowest rounded-t-2xl sm:rounded-2xl border border-fm-outline-variant/20 w-full sm:max-w-md flex flex-col max-h-[90dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header fijo */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-fm-surface-container-low flex-shrink-0">
          <h2 className="text-lg font-semibold text-fm-on-surface">
            {isEditing ? 'Editar solicitud' : 'Solicitar requerimiento'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            aria-label="Cerrar"
            className="p-1 rounded-lg text-fm-outline hover:text-fm-on-surface hover:bg-fm-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </div>

        {/* Body con scroll */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {success ? (
            <div className="py-4 space-y-4">
              <div className="bg-fm-primary/10 border border-fm-primary/20 rounded-xl p-4 text-sm text-fm-primary">
                Tu solicitud fue enviada al equipo. Te avisaremos cuando sea aprobada con los detalles
                definitivos (horario final, duración y responsables).
              </div>
            </div>
          ) : (
            <form id="request-form" onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-fm-on-surface-variant">
                Completa estos campos básicos. El equipo de FM revisará la solicitud y confirmará
                los tiempos, recursos y horario definitivo.
              </p>

              {/* Tipo (solo en creación) */}
              {!isEditing && (
                <div className="space-y-1.5">
                  <Label>Tipo *</Label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as ContentType)}
                    disabled={isPending}
                    className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
                  >
                    {REQUESTABLE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Título *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isPending}
                  required
                  placeholder="Ej: Reunión de planeación trimestral"
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Descripción</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isPending}
                  rows={3}
                  placeholder="Cuéntanos el contexto, lo que esperas que hagamos por ti…"
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
              </div>

              <div className="space-y-1.5">
                <Label>{isScheduled ? 'Fecha y hora deseada *' : 'Fecha de entrega deseada *'}</Label>
                <Input
                  type={isScheduled ? 'datetime-local' : 'date'}
                  value={desiredAt}
                  onChange={(e) => setDesiredAt(e.target.value)}
                  disabled={isPending}
                  required
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
                <p className="text-xs text-fm-outline">
                  {isScheduled
                    ? 'El equipo confirmará si esta fecha es posible y te avisará el horario definitivo.'
                    : 'El equipo confirmará la fecha al aprobar la solicitud.'}
                </p>
              </div>

              {isStoryEligible && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includesStory}
                    onChange={(e) => setIncludesStory(e.target.checked)}
                    disabled={isPending}
                    className="h-4 w-4 accent-fm-primary"
                  />
                  <span className="text-sm text-fm-on-surface">Incluir historia</span>
                </label>
              )}

              {/* ── Referencias (opcional) ─────────────────────────────── */}
              <div className="border-t border-fm-surface-container-low pt-4 space-y-4">
                <p className="text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wider">
                  Referencias (opcional)
                </p>

                {/* Links */}
                <div className="space-y-2">
                  <Label className="text-xs">Links de referencia (máx. {MAX_LINKS})</Label>
                  {links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {links.map((url, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1 text-xs bg-fm-surface-container-low border border-fm-surface-container-high rounded-lg px-2 py-1 max-w-full"
                        >
                          <span className="material-symbols-outlined text-[14px] text-fm-outline flex-shrink-0">link</span>
                          <span className="truncate max-w-[200px] text-fm-on-surface-variant">{url}</span>
                          <button
                            type="button"
                            onClick={() => removeLink(idx)}
                            disabled={isPending}
                            className="ml-0.5 text-fm-outline hover:text-fm-error flex-shrink-0"
                            aria-label="Quitar link"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {links.length < MAX_LINKS && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLink() } }}
                        placeholder="https://drive.google.com/..."
                        disabled={isPending}
                        className="flex-1 text-xs bg-fm-background border border-fm-surface-container-high rounded-lg px-2.5 py-1.5 text-fm-on-surface focus:outline-none focus:border-fm-primary"
                      />
                      <button
                        type="button"
                        onClick={handleAddLink}
                        disabled={isPending || !linkInput.trim()}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-fm-surface-container-low hover:bg-fm-surface-container border border-fm-surface-container-high text-fm-on-surface-variant hover:text-fm-primary transition-colors disabled:opacity-50"
                      >
                        + Agregar
                      </button>
                    </div>
                  )}
                  {linkError && (
                    <p className="text-xs text-fm-error">{linkError}</p>
                  )}
                </div>

                {/* Archivos */}
                <div className="space-y-2">
                  <Label className="text-xs">Archivos de referencia (máx. {MAX_FILES})</Label>

                  {/* Existentes */}
                  {existingAttachments.map((att, idx) => (
                    <div
                      key={att.path}
                      className="flex items-center gap-2 text-xs bg-fm-surface-container-low border border-fm-surface-container-high rounded-lg px-3 py-2"
                    >
                      <span className="material-symbols-outlined text-[14px] text-fm-outline">
                        {att.mime.startsWith('image/') ? 'image' : 'attach_file'}
                      </span>
                      <span className="flex-1 truncate text-fm-on-surface-variant">{att.name}</span>
                      <span className="text-fm-outline flex-shrink-0">
                        {(att.sizeBytes / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeExistingAttachment(idx)}
                        disabled={isPending}
                        className="text-fm-outline hover:text-fm-error"
                        aria-label="Quitar archivo"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  ))}

                  {/* Staged */}
                  {stagedFiles.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-xs bg-fm-primary/5 border border-fm-primary/20 rounded-lg px-3 py-2"
                    >
                      <span className="material-symbols-outlined text-[14px] text-fm-primary">
                        {f.type.startsWith('image/') ? 'image' : 'attach_file'}
                      </span>
                      <span className="flex-1 truncate text-fm-on-surface">{f.name}</span>
                      <span className="text-fm-outline flex-shrink-0">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStagedFile(idx)}
                        disabled={isPending}
                        className="text-fm-outline hover:text-fm-error"
                        aria-label="Quitar archivo"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  ))}

                  {totalFiles < MAX_FILES && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFileSelect(e.target.files)}
                        accept="*/*"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isPending}
                        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-fm-surface-container-high rounded-xl py-3 text-xs text-fm-on-surface-variant hover:border-fm-primary/40 hover:text-fm-primary hover:bg-fm-primary/5 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-base">upload_file</span>
                        Seleccionar archivo · PNG, PDF, MP4, etc. · máx. 10 MB
                      </button>
                    </>
                  )}
                  {fileError && (
                    <p className="text-xs text-fm-error">{fileError}</p>
                  )}
                </div>
              </div>

              {error && (
                <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>

        {/* Footer fijo */}
        <div className="px-6 py-4 border-t border-fm-surface-container-low flex-shrink-0">
          {success ? (
            <Button onClick={handleClose} className="rounded-xl w-full">Cerrar</Button>
          ) : (
            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={handleClose} disabled={isPending} variant="outline" className="rounded-xl">
                Cancelar
              </Button>
              <Button
                type="submit"
                form="request-form"
                disabled={isPending}
                className="rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {submitLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Paso 2: Lint y build**

```bash
npm run lint 2>&1 | grep "error" | head -20
npm run build 2>&1 | tail -15
```

Esperado: sin errores. Si hay error de tipo sobre `updateRequirementRequest` no exportado, verificar que la función esté correctamente exportada en `requirementRequests.ts`.

- [ ] **Paso 3: Commit**

```bash
git add src/components/portal/ClientRequestRequirementModal.tsx
git commit -m "feat: modal solicitud con scroll, archivos, links y modo edición"
```

---

## Task 6: PendingRequestsSection — nueva sección del portal

**Files:**
- Create: `src/components/portal/PendingRequestsSection.tsx`

- [ ] **Paso 1: Crear el componente**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelRequirementRequest } from '@/app/actions/requirementRequests'
import { ClientRequestRequirementModal } from './ClientRequestRequirementModal'
import type { ContentType, ClientRequestAttachment, ClientRequestLink } from '@/types/db'

export interface PendingRequestItem {
  id: string
  title: string
  content_type: string
  notes: string | null
  client_requested_deadline: string | null
  includes_story: boolean
  approval_status: 'pending' | 'rejected'
  rejected_reason: string | null
  client_request_attachments_json: ClientRequestAttachment[] | null
  client_request_links_json: ClientRequestLink[] | null
}

interface Props {
  requests: PendingRequestItem[]
}

export function PendingRequestsSection({ requests }: Props) {
  const router = useRouter()
  const [editingItem, setEditingItem] = useState<PendingRequestItem | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (requests.length === 0) return null

  function handleCancelConfirm(id: string) {
    setCancelingId(id)
    startTransition(async () => {
      await cancelRequirementRequest(id)
      setCancelingId(null)
      setConfirmingId(null)
      router.refresh()
    })
  }

  const pending = requests.filter((r) => r.approval_status === 'pending')
  const rejected = requests.filter((r) => r.approval_status === 'rejected')

  return (
    <>
      <div className="space-y-3">
        <p className="text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wider">
          Mis solicitudes enviadas
        </p>

        {pending.map((req) => (
          <div
            key={req.id}
            className="bg-fm-surface-container-lowest border border-amber-500/20 rounded-2xl p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  Pendiente de revisión
                </span>
                <span className="text-sm font-medium text-fm-on-surface truncate">{req.title}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingItem(req)}
                  disabled={isPending}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-fm-surface-container-low hover:bg-fm-background border border-fm-surface-container-high text-fm-on-surface-variant hover:text-fm-primary transition-colors disabled:opacity-50"
                >
                  Editar
                </button>
                {confirmingId === req.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-fm-on-surface-variant">¿Retirar?</span>
                    <button
                      type="button"
                      onClick={() => handleCancelConfirm(req.id)}
                      disabled={cancelingId === req.id}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg bg-fm-error text-white hover:bg-fm-error/80 disabled:opacity-50 transition-colors"
                    >
                      {cancelingId === req.id ? '…' : 'Sí'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={cancelingId === req.id}
                      className="text-xs px-2.5 py-1 rounded-lg border border-fm-surface-container-high text-fm-on-surface-variant hover:bg-fm-background transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(req.id)}
                    disabled={isPending}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-fm-error/30 text-fm-error hover:bg-fm-error/10 transition-colors disabled:opacity-50"
                  >
                    Retirar
                  </button>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-3 text-xs text-fm-on-surface-variant flex-wrap">
              {req.client_requested_deadline && (
                <span>
                  Fecha deseada:{' '}
                  {new Date(req.client_requested_deadline).toLocaleDateString('es-SV', {
                    dateStyle: 'medium',
                  })}
                </span>
              )}
              {(req.client_request_attachments_json?.length ?? 0) > 0 && (
                <span className="flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[13px]">attach_file</span>
                  {req.client_request_attachments_json!.length}{' '}
                  {req.client_request_attachments_json!.length === 1 ? 'archivo' : 'archivos'}
                </span>
              )}
              {(req.client_request_links_json?.length ?? 0) > 0 && (
                <span className="flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[13px]">link</span>
                  {req.client_request_links_json!.length}{' '}
                  {req.client_request_links_json!.length === 1 ? 'link' : 'links'}
                </span>
              )}
            </div>
          </div>
        ))}

        {rejected.map((req) => (
          <div
            key={req.id}
            className="bg-fm-surface-container-lowest border border-fm-error/20 rounded-2xl p-4 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-fm-error/10 text-fm-error border border-fm-error/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                No aprobada
              </span>
              <span className="text-sm font-medium text-fm-on-surface truncate">{req.title}</span>
            </div>
            {req.rejected_reason && (
              <p className="text-xs text-fm-on-surface-variant">
                <span className="font-semibold">Motivo:</span> {req.rejected_reason}
              </p>
            )}
          </div>
        ))}
      </div>

      {editingItem && (
        <ClientRequestRequirementModal
          open
          onClose={() => { setEditingItem(null); router.refresh() }}
          existingRequest={{
            id: editingItem.id,
            content_type: editingItem.content_type as ContentType,
            title: editingItem.title,
            notes: editingItem.notes,
            desiredAt: editingItem.client_requested_deadline ?? '',
            includes_story: editingItem.includes_story,
            attachments: editingItem.client_request_attachments_json ?? [],
            links: editingItem.client_request_links_json ?? [],
          }}
        />
      )}
    </>
  )
}
```

- [ ] **Paso 2: Lint y build**

```bash
npm run lint 2>&1 | grep "error" | head -20
npm run build 2>&1 | tail -15
```

- [ ] **Paso 3: Commit**

```bash
git add src/components/portal/PendingRequestsSection.tsx
git commit -m "feat: PendingRequestsSection — tarjetas de solicitudes pending/rejected en portal"
```

---

## Task 7: Dashboard del portal — query + sección

**Files:**
- Modify: `src/app/(portal)/portal/dashboard/page.tsx`

- [ ] **Paso 1: Agregar import de PendingRequestsSection**

Al inicio de `src/app/(portal)/portal/dashboard/page.tsx`, agregar:

```ts
import { PendingRequestsSection, type PendingRequestItem } from '@/components/portal/PendingRequestsSection'
```

- [ ] **Paso 2: Agregar query de solicitudes pending/rejected**

Después de la query `currentCycle` (que ya existe), agregar:

```ts
// Solicitudes pending y rejected del ciclo actual (visibles al cliente)
const pendingAndRejectedRequests: PendingRequestItem[] = []
if (cycle) {
  const { data: pendingRows } = await supabase
    .from('requirements')
    .select('id, title, content_type, notes, client_requested_deadline, includes_story, approval_status, rejected_reason, client_request_attachments_json, client_request_links_json')
    .eq('billing_cycle_id', cycle.id)
    .in('approval_status', ['pending', 'rejected'])
    .eq('voided', false)
    .order('registered_at', { ascending: false })
  for (const r of pendingRows ?? []) {
    pendingAndRejectedRequests.push(r as unknown as PendingRequestItem)
  }
}
```

- [ ] **Paso 3: Renderizar PendingRequestsSection en el JSX**

En el return del componente, agregar `<PendingRequestsSection>` **después** del div con `<SolicitarRequerimientoButton>` y **antes** de `<RenewalBanner>`:

```tsx
{/* Mis solicitudes enviadas (pending + rejected) */}
{pendingAndRejectedRequests.length > 0 && (
  <PendingRequestsSection requests={pendingAndRejectedRequests} />
)}
```

- [ ] **Paso 4: Lint y build**

```bash
npm run lint 2>&1 | grep "error" | head -20
npm run build 2>&1 | tail -15
```

Esperado: sin errores. Si hay error de tipo por `as unknown as PendingRequestItem`, verificar que los campos del SELECT coincidan exactamente con la interfaz `PendingRequestItem`.

- [ ] **Paso 5: Commit**

```bash
git add src/app/\(portal\)/portal/dashboard/page.tsx
git commit -m "feat: dashboard portal muestra solicitudes pending/rejected del cliente"
```

---

## Task 8: Vista del staff — referencias del cliente

**Files:**
- Modify: `src/app/(app)/solicitudes/page.tsx`
- Modify: `src/app/(app)/solicitudes/SolicitudesList.tsx`
- Modify: `src/components/requirements/ApproveRequestModal.tsx`

- [ ] **Paso 1: Extender SELECT en solicitudes/page.tsx**

En `src/app/(app)/solicitudes/page.tsx`, extender la query que selecciona los pending requirements para incluir las nuevas columnas. Buscar la línea:

```ts
.select('id, title, notes, content_type, client_requested_deadline, starts_at, deadline, requested_by_user_id, billing_cycle_id, registered_at')
```

Reemplazarla con:

```ts
.select('id, title, notes, content_type, client_requested_deadline, starts_at, deadline, requested_by_user_id, billing_cycle_id, registered_at, client_request_attachments_json, client_request_links_json')
```

También extender el tipo `PendingRow` en ese archivo:

```ts
interface PendingRow {
  id: string
  title: string
  notes: string | null
  content_type: string
  client_requested_deadline: string | null
  starts_at: string | null
  deadline: string | null
  registered_at: string
  requested_by_user_id: string | null
  billing_cycle_id: string
  client_request_attachments_json: ClientRequestAttachment[] | null
  client_request_links_json: ClientRequestLink[] | null
}
```

Agregar el import al inicio del archivo:

```ts
import type { ClientRequestAttachment, ClientRequestLink } from '@/types/db'
```

Y pasar los nuevos campos en el mapeo `items`:

```ts
const items = pending.map((p) => {
  const client = clientByCycle.get(p.billing_cycle_id)
  return {
    id: p.id,
    title: p.title,
    notes: p.notes,
    content_type: p.content_type,
    client_requested_deadline: p.client_requested_deadline,
    starts_at: p.starts_at,
    deadline: p.deadline,
    created_at: p.registered_at,
    client_name: client?.name ?? 'Cliente desconocido',
    requested_by_name: p.requested_by_user_id
      ? requesterById.get(p.requested_by_user_id) ?? 'Usuario'
      : 'Usuario',
    client_request_attachments_json: p.client_request_attachments_json,
    client_request_links_json: p.client_request_links_json,
  }
})
```

- [ ] **Paso 2: Extender PendingRequest interface en ApproveRequestModal.tsx**

En `src/components/requirements/ApproveRequestModal.tsx`, agregar los campos al `PendingRequest` interface:

```ts
import type { ClientRequestAttachment, ClientRequestLink } from '@/types/db'

export interface PendingRequest {
  id: string
  title: string
  notes: string | null
  content_type: string
  client_requested_deadline: string | null
  starts_at: string | null
  deadline: string | null
  client_name: string
  requested_by_name: string
  client_request_attachments_json: ClientRequestAttachment[] | null
  client_request_links_json: ClientRequestLink[] | null
}
```

- [ ] **Paso 3: Agregar sección "Referencias del cliente" en ApproveRequestModal.tsx**

Dentro del JSX del modal, localizar donde se muestra `request.notes` (la descripción del cliente). Después de ese bloque, agregar la sección de referencias:

```tsx
{/* Referencias del cliente */}
{((request.client_request_links_json?.length ?? 0) > 0 ||
  (request.client_request_attachments_json?.length ?? 0) > 0) && (
  <div className="space-y-2 p-3 bg-fm-surface-container-low rounded-xl border border-fm-surface-container-high">
    <p className="text-[10px] font-bold uppercase tracking-wider text-fm-outline-variant">
      Referencias del cliente
    </p>

    {/* Links */}
    {(request.client_request_links_json ?? []).map((link, i) => (
      <a
        key={i}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-fm-primary hover:underline truncate"
      >
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">link</span>
        <span className="truncate">{link.url}</span>
      </a>
    ))}

    {/* Archivos */}
    {(request.client_request_attachments_json ?? []).map((att, i) => {
      const isImage = att.mime.startsWith('image/')
      return (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="material-symbols-outlined text-[14px] text-fm-outline flex-shrink-0">
            {isImage ? 'image' : 'attach_file'}
          </span>
          <span className="flex-1 truncate text-fm-on-surface-variant">{att.name}</span>
          <a
            href={att.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={!isImage}
            className="font-semibold text-fm-primary hover:underline flex-shrink-0"
          >
            {isImage ? 'Ver' : 'Descargar'}
          </a>
        </div>
      )
    })}
  </div>
)}
```

- [ ] **Paso 4: Lint y build**

```bash
npm run lint 2>&1 | grep "error" | head -20
npm run build 2>&1 | tail -15
```

Esperado: build limpio sin errores TS.

- [ ] **Paso 5: Commit**

> `SolicitudesList.tsx` no necesita cambios en su código: el tipo `Item extends PendingRequest` hereda los dos nuevos campos automáticamente. Solo se modifica `page.tsx` (SELECT + mapeo) y `ApproveRequestModal.tsx` (UI de referencias).

```bash
git add src/app/\(app\)/solicitudes/page.tsx src/components/requirements/ApproveRequestModal.tsx
git commit -m "feat: vista staff muestra referencias del cliente en solicitudes"
```

---

## Verificación manual final

Una vez implementadas todas las tareas:

1. **Crear solicitud con archivos y links:**
   - Entrar al portal como cliente → Dashboard → "Solicitar requerimiento"
   - Agregar un link (ej: `https://google.com`) → debe aparecer como chip
   - Intentar link inválido (ej: `google`) → debe mostrar error "URL inválida"
   - Subir un archivo imagen → debe comprimirse y aparecer como chip
   - Subir un PDF → debe subir directo y aparecer como chip
   - Intentar 4 archivos → debe mostrar error "Máximo 3 archivos"
   - Enviar → la pantalla no debe cortarse en ningún tamaño de pantalla; en móvil debe hacer scroll

2. **Ver solicitud pending en el dashboard:**
   - Al enviar, recargar el dashboard → debe aparecer la sección "Mis solicitudes enviadas" con badge amarillo
   - Verificar que muestra conteo de archivos y links

3. **Editar solicitud pending:**
   - Clic en "Editar" → modal se abre pre-llenado
   - Cambiar título → guardar → verificar que la tarjeta se actualiza
   - Agregar/quitar archivos → verificar que los cambios persisten

4. **Retirar solicitud:**
   - Clic en "Retirar" → aparece confirmación inline
   - Confirmar → la tarjeta desaparece del dashboard

5. **Vista del staff:**
   - Entrar como admin a `/solicitudes`
   - Abrir la solicitud del paso 1 → debe verse la sección "Referencias del cliente" con links e imágenes
   - Clic en "Ver" en imagen → abre en nueva pestaña
   - Clic en "Descargar" en PDF → descarga el archivo

6. **Solicitud rechazada:**
   - Rechazar la solicitud como admin con un motivo
   - Volver al portal como cliente → la tarjeta debe cambiar de amarillo a rojo con el motivo

---

## Commit final de push

```bash
git push origin master
```

> ⚠️ Solo hacer push cuando el usuario lo confirme explícitamente.
