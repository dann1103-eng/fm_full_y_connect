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
  contentType: ContentType
  title: string
  notes: string
  clientRequestedDeadline: string | null
  includesStory: boolean
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
    existingRequest?.contentType ?? 'reunion'
  )
  const [title, setTitle] = useState(existingRequest?.title ?? '')
  const [description, setDescription] = useState(existingRequest?.notes ?? '')
  const [desiredAt, setDesiredAt] = useState(() => {
    if (!existingRequest?.clientRequestedDeadline) return ''
    const raw = existingRequest.clientRequestedDeadline
    if (SCHEDULED_TYPES.includes(existingRequest.contentType)) {
      return raw.slice(0, 16)
    }
    return raw.slice(0, 10)
  })
  const [includesStory, setIncludesStory] = useState(existingRequest?.includesStory ?? false)

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
          let newlyUploaded: ClientRequestAttachment[] = []
          if (stagedFiles.length > 0) {
            try {
              newlyUploaded = await uploadStagedFiles(existingRequest.id)
            } catch (uploadErr) {
              console.warn('Upload parcial en edición — se guardan solo archivos existentes', uploadErr)
            }
          }
          const finalAttachments = [...existingAttachments, ...newlyUploaded]
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
