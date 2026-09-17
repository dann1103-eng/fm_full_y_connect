'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect'
import type { Client, MatrixTopic } from '@/types/db'
import { matrixTitleFor, MATRIX_TEXT_LIMITS } from '@/lib/domain/matrix'
import { createMatrix } from '@/app/actions/matrices'
import { TopicsInput } from './TopicsInput'
import { rememberLinkError } from './matrixLinkError'
import { useTargetPeriods } from './useTargetPeriods'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: Client[]
  /** Cliente fijo (tarjeta del perfil) o preseleccionado (panel de faltantes). */
  initialClientId?: string
  initialPeriodStart?: string
  lockClient?: boolean
}

const UNEXPECTED_ERROR = 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.'

/**
 * El contenido del diálogo solo está montado mientras está abierto (el portal de base-ui se desmonta al
 * cerrar), así que el formulario arranca limpio en cada apertura sin efectos de "reset". La `key` cubre
 * además un cambio de valores iniciales con el diálogo montado.
 */
export function NewMatrixDialog({ open, onOpenChange, clients, initialClientId, initialPeriodStart, lockClient = false }: Props) {
  // Vive fuera del formulario para poder bloquear el cierre (Escape, fondo, X) mientras se crea.
  const [creating, setCreating] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && creating) return; onOpenChange(v) }}>
      <DialogContent showCloseButton={!creating} className="sm:max-w-lg rounded-2xl p-0 gap-0 border border-fm-outline-variant/20 flex flex-col max-h-[90vh]">
        <NewMatrixForm
          key={`${initialClientId ?? ''}|${initialPeriodStart ?? ''}`}
          open={open}
          clients={clients}
          initialClientId={initialClientId}
          initialPeriodStart={initialPeriodStart}
          lockClient={lockClient}
          creating={creating}
          setCreating={setCreating}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

interface FormProps {
  open: boolean
  clients: Client[]
  initialClientId?: string
  initialPeriodStart?: string
  lockClient: boolean
  creating: boolean
  setCreating: (creating: boolean) => void
  onClose: () => void
}

function NewMatrixForm({ open, clients, initialClientId, initialPeriodStart, lockClient, creating, setCreating, onClose }: FormProps) {
  const router = useRouter()
  const [clientId, setClientId] = useState(initialClientId ?? '')
  const { loading: loadingPeriods, periods, existing, error: loadError, retry } = useTargetPeriods(clientId)
  const [pickedStart, setPickedStart] = useState(initialPeriodStart ?? '')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [topics, setTopics] = useState<MatrixTopic[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // ¿Sigue abierto el diálogo? Si se cerró (o se desmontó) mientras se creaba, no se navega al editor.
  const activeRef = useRef(open)
  useEffect(() => { activeRef.current = open }, [open])
  useEffect(() => () => { activeRef.current = false }, [])

  const period = periods.find((p) => p.periodStart === pickedStart) ?? periods[0] ?? null
  const suggestedTitle = period ? matrixTitleFor(period.periodStart, period.periodEnd) : ''
  const effectiveTitle = titleTouched ? title : suggestedTitle
  const existingId = period ? existing[period.periodStart] : undefined

  async function submit() {
    if (creating || !clientId || !period || existingId) return
    setError(null)
    setCreating(true)
    let r: Awaited<ReturnType<typeof createMatrix>>
    try {
      r = await createMatrix({
        clientId, periodStart: period.periodStart, periodEnd: period.periodEnd,
        title: effectiveTitle, topics, notes: notes.trim() || null,
      })
    } catch (e) {
      console.error('[NewMatrixDialog] createMatrix', e)
      setCreating(false)
      setError(UNEXPECTED_ERROR)
      return
    }
    setCreating(false)
    if (!r.ok) { setError(r.error); return }
    // La matriz existe aunque el vínculo haya fallado: el editor muestra este motivo en su franja.
    if (!r.link.ok) rememberLinkError(r.id, r.link.error)
    if (!activeRef.current) return
    onClose()
    router.push(`/matrices/${r.id}`)
  }

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10 flex-shrink-0">
        <DialogTitle className="text-lg font-semibold text-fm-on-surface">Nueva matriz de contenido</DialogTitle>
      </DialogHeader>

      <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label id="new-matrix-client-label">Cliente *</Label>
          <div role="group" aria-labelledby="new-matrix-client-label">
            <ClientSearchSelect clients={clients} value={clientId} onChange={setClientId} disabled={lockClient || creating} required />
          </div>
        </div>

        {clientId && (
          <div className="space-y-1.5">
            <Label id="new-matrix-period-label">Período objetivo *</Label>
            {loadingPeriods && <p className="text-xs text-fm-on-surface-variant">Cargando períodos…</p>}
            {loadError && (
              <div className="flex items-center gap-2 text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
                <span className="flex-1">{loadError}</span>
                <button type="button" onClick={retry} className="font-semibold underline">Reintentar</button>
              </div>
            )}
            {periods.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-labelledby="new-matrix-period-label">
                {periods.map((p) => {
                  const checked = period?.periodStart === p.periodStart
                  return (
                    <label key={p.periodStart}
                      className={`flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer text-sm ${checked ? 'border-fm-primary bg-fm-primary/5' : 'border-fm-surface-container-high'}`}>
                      <input type="radio" name="matrix-period" className="mt-1" checked={checked} disabled={creating}
                        onChange={() => setPickedStart(p.periodStart)} />
                      <span>
                        <span className="block font-medium text-fm-on-surface">{p.label}</span>
                        <span className="block text-[11px] text-fm-on-surface-variant">
                          {p.isCurrent ? 'Ciclo vigente' : 'Ciclo futuro'}{existing[p.periodStart] ? ' · ya tiene matriz' : ''}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {existingId ? (
          <p className="text-sm rounded-xl bg-fm-primary/5 border border-fm-primary/20 px-3 py-2 text-fm-on-surface">
            Ya existe una matriz para ese período.{' '}
            <Link href={`/matrices/${existingId}`} className="font-semibold text-fm-primary hover:underline" onClick={onClose}>Abrir</Link>
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="new-matrix-title">Título</Label>
              <Input id="new-matrix-title" value={effectiveTitle} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
                maxLength={MATRIX_TEXT_LIMITS.title} className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
            <div className="space-y-1.5">
              <Label id="new-matrix-topics-label">Temas del mes</Label>
              <div role="group" aria-labelledby="new-matrix-topics-label">
                <TopicsInput topics={topics} onChange={setTopics} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-matrix-notes">Enfoque del mes / notas de la reunión</Label>
              <Textarea id="new-matrix-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                maxLength={MATRIX_TEXT_LIMITS.notes} className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-fm-outline-variant/10 flex justify-end gap-2 flex-shrink-0">
        <button type="button" onClick={onClose} disabled={creating}
          className="px-4 py-2 rounded-xl text-sm text-fm-on-surface-variant hover:bg-fm-surface-container-low disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={() => void submit()} disabled={creating || !clientId || !period || !!existingId}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50">
          {creating ? 'Creando…' : 'Crear matriz'}
        </button>
      </div>
    </>
  )
}
