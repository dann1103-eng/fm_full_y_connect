'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect'
import type { Client, MatrixTopic } from '@/types/db'
import { matrixTitleFor, type TargetPeriod } from '@/lib/domain/matrix'
import { createMatrix, listTargetPeriods } from '@/app/actions/matrices'
import { TopicsInput } from './MatrixTopicsBar'

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
  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg rounded-2xl p-0 gap-0 border border-fm-outline-variant/20 flex flex-col max-h-[90vh]">
        <NewMatrixForm
          key={`${initialClientId ?? ''}|${initialPeriodStart ?? ''}`}
          clients={clients}
          initialClientId={initialClientId}
          initialPeriodStart={initialPeriodStart}
          lockClient={lockClient}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

type PeriodsState =
  | { clientId: string; ok: true; periods: TargetPeriod[]; existing: Record<string, string> }
  | { clientId: string; ok: false; error: string }

interface FormProps {
  clients: Client[]
  initialClientId?: string
  initialPeriodStart?: string
  lockClient: boolean
  onClose: () => void
}

function NewMatrixForm({ clients, initialClientId, initialPeriodStart, lockClient, onClose }: FormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [loaded, setLoaded] = useState<PeriodsState | null>(null)
  const [pickedStart, setPickedStart] = useState(initialPeriodStart ?? '')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [topics, setTopics] = useState<MatrixTopic[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Cargar períodos al elegir cliente (setState dentro del callback async: permitido por la regla de hooks).
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    listTargetPeriods(clientId)
      .then((r) => {
        if (cancelled) return
        setLoaded(r.ok ? { clientId, ok: true, periods: r.periods, existing: r.existing } : { clientId, ok: false, error: r.error })
      })
      .catch((e: unknown) => {
        console.error('[NewMatrixDialog] listTargetPeriods', e)
        if (!cancelled) setLoaded({ clientId, ok: false, error: UNEXPECTED_ERROR })
      })
    return () => { cancelled = true }
  }, [clientId])

  // Todo lo demás se deriva: los datos cargados solo valen para el cliente actual.
  const current = loaded?.clientId === clientId ? loaded : null
  const loadingPeriods = !!clientId && !current
  const periods = current?.ok ? current.periods : []
  const existing = current?.ok ? current.existing : {}
  const loadError = current && !current.ok ? current.error : null
  const period = periods.find((p) => p.periodStart === pickedStart) ?? periods[0] ?? null
  const suggestedTitle = period ? matrixTitleFor(period.periodStart, period.periodEnd) : ''
  const effectiveTitle = titleTouched ? title : suggestedTitle
  const existingId = period ? existing[period.periodStart] : undefined

  function submit() {
    if (!clientId || !period || existingId) return
    setError(null)
    startTransition(async () => {
      try {
        const r = await createMatrix({
          clientId, periodStart: period.periodStart, periodEnd: period.periodEnd,
          title: effectiveTitle, topics, notes: notes.trim() || null,
        })
        if (!r.ok) { setError(r.error); return }
        onClose()
        router.push(`/matrices/${r.id}`)
      } catch (e) {
        console.error('[NewMatrixDialog] createMatrix', e)
        setError(UNEXPECTED_ERROR)
      }
    })
  }

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10 flex-shrink-0">
        <DialogTitle className="text-lg font-semibold text-fm-on-surface">Nueva matriz de contenido</DialogTitle>
      </DialogHeader>

      <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label>Cliente *</Label>
          <ClientSearchSelect clients={clients} value={clientId} onChange={setClientId} disabled={lockClient} required />
        </div>

        {clientId && (
          <div className="space-y-1.5">
            <Label>Período objetivo *</Label>
            {loadingPeriods && <p className="text-xs text-fm-on-surface-variant">Cargando períodos…</p>}
            {periods.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Período objetivo">
                {periods.map((p) => {
                  const checked = period?.periodStart === p.periodStart
                  return (
                    <label key={p.periodStart}
                      className={`flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer text-sm ${checked ? 'border-fm-primary bg-fm-primary/5' : 'border-fm-surface-container-high'}`}>
                      <input type="radio" name="matrix-period" className="mt-1" checked={checked} onChange={() => setPickedStart(p.periodStart)} />
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
                maxLength={200} className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
            <div className="space-y-1.5">
              <Label>Temas del mes</Label>
              <TopicsInput topics={topics} onChange={setTopics} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-matrix-notes">Enfoque del mes / notas de la reunión</Label>
              <Textarea id="new-matrix-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
          </>
        )}

        {(error ?? loadError) && (
          <p className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error ?? loadError}</p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-fm-outline-variant/10 flex justify-end gap-2 flex-shrink-0">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-fm-on-surface-variant hover:bg-fm-surface-container-low">Cancelar</button>
        <button type="button" onClick={submit} disabled={isPending || !clientId || !period || !!existingId}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50">
          {isPending ? 'Creando…' : 'Crear matriz'}
        </button>
      </div>
    </>
  )
}
