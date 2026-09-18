'use client'

import { useRef, useState } from 'react'
import type { BrandPerson, ClientBrandProfile } from '@/types/db'
import {
  BRAND_MAX_HASHTAGS, BRAND_MAX_SAMPLE_COPIES, BRAND_PERSON_LABELS, BRAND_PERSONS,
  BRAND_REQUIRED_FIELDS, BRAND_TEXT_LIMITS, hasUsableBrandProfile, type BrandPatch,
} from '@/lib/domain/brand'
import { updateBrandProfile } from '@/app/actions/brand'

interface Props {
  clientId: string
  /** Fila actual, o `null` si a este cliente nadie le llenó el perfil todavía. */
  profile: ClientBrandProfile | null
}

type TextKey = 'tone' | 'audience' | 'value_proposition' | 'offerings' | 'avoid'

const TEXT_FIELDS: ReadonlyArray<{ key: TextKey; label: string; hint: string; rows: number; required: boolean }> = [
  { key: 'tone', label: 'Tono de voz', hint: 'Cercano pero profesional, sin tecnicismos', rows: 2, required: true },
  { key: 'audience', label: 'Público objetivo', hint: 'A quién le habla la marca', rows: 2, required: true },
  { key: 'value_proposition', label: 'Propuesta de valor', hint: 'Qué vende y por qué le compran', rows: 2, required: true },
  { key: 'offerings', label: 'Productos o servicios', hint: 'Lo que la IA puede mencionar por nombre', rows: 3, required: true },
  { key: 'avoid', label: 'Qué evitar', hint: 'Temas, palabras o promesas prohibidas', rows: 2, required: false },
]

const labelCls = 'block text-[11px] uppercase tracking-wider text-fm-on-surface-variant mb-1'
const inputCls = 'w-full rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60'

function emptyProfile(clientId: string): ClientBrandProfile {
  return {
    client_id: clientId, tone: null, person: null, audience: null, value_proposition: null,
    offerings: null, avoid: null, base_hashtags: null, sample_copies: null,
    updated_by_user_id: null, created_at: '', updated_at: '',
  }
}

/**
 * Perfil de marca del cliente (bloque 3): el contexto con el que la IA escribe la matriz. Guardado
 * por campo al perder el foco, con el mismo patrón que `MatrixHeader`/`MatrixItemSheet` (borrador
 * local solo mientras el campo está enfocado) y sin `revalidatePath` del lado del servidor.
 */
export function ClientBrandProfileCard({ clientId, profile }: Props) {
  // Fila local: el cambio se aplica de inmediato (optimista) y el servidor solo confirma. Si el
  // guardado falla, lo escrito NO se revierte —se perdería el texto— y la franja muestra el motivo.
  const [row, setRow] = useState<ClientBrandProfile>(() => profile ?? emptyProfile(clientId))
  // Borrador del campo que se está editando (uno a la vez: el que tiene el foco). Al perder el foco se
  // guarda y se suelta.
  const [draft, setDraft] = useState<{ key: TextKey; value: string } | null>(null)
  // Borrador del copy de ejemplo enfocado, por posición en la lista.
  const [copyDraft, setCopyDraft] = useState<{ index: number; value: string } | null>(null)
  const [newHashtag, setNewHashtag] = useState('')
  const [hashtagNotice, setHashtagNotice] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState(0)
  // Campos cuyo último guardado falló y siguen pendientes, con su motivo. Es lo mismo que
  // `failedMatrixDrafts` + `unsavedCount` del editor de matrices: el éxito de un campo NO puede
  // apagar el aviso de otro, así que el error vive por campo y no en un solo `error` global.
  const [failedFields, setFailedFields] = useState<Map<string, string>>(() => new Map())
  const [savedOnce, setSavedOnce] = useState(false)
  // Una secuencia por campo: una respuesta vieja nunca pisa un guardado más nuevo del mismo campo.
  const seqRef = useRef<Map<string, number>>(new Map())

  const hashtags = row.base_hashtags ?? []
  const copies = row.sample_copies ?? []
  // Una fila vacía no existe para el servidor (`cleanList` la descarta), así que no se cuenta aquí:
  // el tope de filas sí se mide sobre `copies.length`, que es lo que limita agregar una más.
  const filledCopies = copies.filter((c) => c.trim().length > 0).length
  const unsavedCount = failedFields.size
  // Un campo obligatorio sin guardar significa que la base NO tiene ese contexto: el handler de IA
  // leería el perfil incompleto, así que la píldora no puede decir "Listo para generar con IA".
  const ready = hasUsableBrandProfile(row) && !BRAND_REQUIRED_FIELDS.some((k) => failedFields.has(k))
  // Motivo del fallo pendiente más reciente (un `Map` conserva el orden de inserción). Solo se pinta
  // mientras quede algún campo sin guardar, así que nunca sobrevive a su propio campo.
  const failedEntries = [...failedFields.entries()]
  const saveError = failedEntries.length > 0 ? failedEntries[failedEntries.length - 1][1] : null

  async function save(field: string, patch: BrandPatch) {
    const seq = (seqRef.current.get(field) ?? 0) + 1
    seqRef.current.set(field, seq)
    setRow((prev) => ({ ...prev, ...patch }))
    setInFlight((n) => n + 1)
    try {
      const r = await updateBrandProfile(clientId, patch)
      if (seqRef.current.get(field) !== seq) return
      if (!r.ok) {
        // Se anota SOLO este campo: los demás conservan su estado (fallido o guardado).
        setFailedFields((prev) => new Map(prev).set(field, r.error))
        return
      }
      // Y en el éxito se borra SOLO este campo: si otro sigue pendiente, la franja se queda.
      setFailedFields((prev) => {
        if (!prev.has(field)) return prev
        const next = new Map(prev)
        next.delete(field)
        return next
      })
      setSavedOnce(true)
      // Solo se confirma el campo de ESTE guardado: otro campo puede tener uno más nuevo en vuelo.
      // Las listas se dejan como están localmente: el servidor descarta los elementos vacíos y aquí
      // una fila recién agregada todavía se está escribiendo.
      if (field !== 'base_hashtags' && field !== 'sample_copies') {
        const fresh = r.profile as unknown as Record<string, unknown>
        setRow((prev) => ({ ...prev, [field]: fresh[field] }) as ClientBrandProfile)
      }
    } finally {
      setInFlight((n) => n - 1)
    }
  }

  function commitText(key: TextKey) {
    if (!draft || draft.key !== key) return
    const value = draft.value
    setDraft(null)
    // Con un fallo pendiente se reintenta aunque el texto coincida: `row[key]` ya se pisó de forma
    // optimista, así que sin esta salvedad reenfocar y salir no reintentaría nunca. Es el mismo
    // `|| p.failedTitle !== undefined` de `commitTitle` en `MatrixHeader`.
    if (value.trim() === (row[key] ?? '').trim() && !failedFields.has(key)) return
    void save(key, { [key]: value } as BrandPatch)
  }

  function addHashtag() {
    const tag = newHashtag.trim()
    if (!tag || hashtags.length >= BRAND_MAX_HASHTAGS) return
    // El dedupe va ANTES de limpiar el campo: al revés, el hashtag repetido desaparecía del input y
    // no pasaba nada más, sin un solo mensaje.
    if (hashtags.some((h) => h.toLowerCase() === tag.toLowerCase())) {
      setHashtagNotice('Ese hashtag ya está en la lista.')
      return
    }
    setHashtagNotice(null)
    setNewHashtag('')
    void save('base_hashtags', { base_hashtags: [...hashtags, tag] })
  }

  function removeHashtag(index: number) {
    void save('base_hashtags', { base_hashtags: hashtags.filter((_, i) => i !== index) })
  }

  function commitCopy(index: number) {
    if (!copyDraft || copyDraft.index !== index) return
    const value = copyDraft.value
    setCopyDraft(null)
    if (value.trim() === (copies[index] ?? '').trim() && !failedFields.has('sample_copies')) return
    void save('sample_copies', { sample_copies: copies.map((c, i) => (i === index ? value : c)) })
  }

  function addCopy() {
    // Todo dentro del updater funcional: mezclar `prev` con el `copies` del render hacía que dos
    // clics seguidos agregaran una sola fila (y el tope se medía sobre una lista ya vieja).
    setRow((prev) => {
      const list = prev.sample_copies ?? []
      if (list.length >= BRAND_MAX_SAMPLE_COPIES) return prev
      // Una fila vacía todavía no se guarda: el servidor la descartaría. Se guarda al salir del campo.
      return { ...prev, sample_copies: [...list, ''] }
    })
  }

  function removeCopy(index: number) {
    setCopyDraft(null)
    void save('sample_copies', { sample_copies: copies.filter((_, i) => i !== index) })
  }

  const statusLabel = inFlight > 0
    ? 'Guardando…'
    : unsavedCount > 0
      ? `${unsavedCount} cambio${unsavedCount !== 1 ? 's' : ''} sin guardar`
      : savedOnce ? 'Guardado' : ''

  return (
    <section className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="material-symbols-outlined text-fm-primary" aria-hidden="true">auto_awesome</span>
        <h3 className="text-base font-semibold text-fm-on-surface">Perfil de marca</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          ready ? 'bg-fm-primary/15 text-fm-primary' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        }`}>
          {ready ? 'Listo para generar con IA' : 'Incompleto'}
        </span>
        <span role="status" className={`ml-auto text-[11px] ${
          unsavedCount > 0 ? 'text-fm-error font-semibold' : 'text-fm-on-surface-variant'
        }`}>{statusLabel}</span>
      </div>

      <p className="text-xs text-fm-on-surface-variant">
        Con este contexto la IA arma la matriz del mes. Sin tono, público, propuesta de valor y oferta no se puede generar.
      </p>

      {/* `role="alert"`: la única región viva del encabezado es la píldora de estado, que en cuanto otro
          campo se guarda vuelve a decir "Guardado". Sin esto el fallo no se anuncia nunca. */}
      {saveError && (
        <p role="alert" className="rounded-xl border border-fm-error/40 bg-fm-error/5 px-3 py-2 text-xs text-fm-error">
          No se pudo guardar: {saveError} Vuelve a entrar al campo marcado y sal de él para reintentar.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className={f.key === 'offerings' || f.key === 'avoid' ? 'sm:col-span-2' : undefined}>
            <label htmlFor={`brand-${f.key}`} className={labelCls}>
              {f.label}{f.required && <span className="text-fm-error"> *</span>}
              {failedFields.has(f.key) && <span className="text-fm-error normal-case"> · sin guardar</span>}
            </label>
            <textarea
              id={`brand-${f.key}`}
              rows={f.rows}
              maxLength={BRAND_TEXT_LIMITS[f.key]}
              placeholder={f.hint}
              value={draft?.key === f.key ? draft.value : row[f.key] ?? ''}
              onChange={(e) => setDraft({ key: f.key, value: e.target.value })}
              // Con un guardado fallido pendiente, enfocar carga lo escrito como borrador: al salir del
              // campo se reintenta aunque no se toque nada (el `onFocus` de `MatrixHeader`).
              onFocus={() => { if (!draft && failedFields.has(f.key)) setDraft({ key: f.key, value: row[f.key] ?? '' }) }}
              onBlur={() => commitText(f.key)}
              aria-invalid={failedFields.has(f.key) || undefined}
              className={`${inputCls} resize-y ${failedFields.has(f.key) ? 'border-fm-error/60' : ''}`}
            />
          </div>
        ))}

        <div>
          <label htmlFor="brand-person" className={labelCls}>Persona gramatical</label>
          <select
            id="brand-person"
            value={row.person ?? ''}
            onChange={(e) => {
              const v = e.target.value
              void save('person', { person: v === '' ? null : (v as BrandPerson) })
            }}
            className={inputCls}
          >
            <option value="">Sin definir</option>
            {BRAND_PERSONS.map((p) => <option key={p} value={p}>{BRAND_PERSON_LABELS[p]}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-fm-on-surface-variant">La IA la usa en todo el texto que escribe.</p>
        </div>

        <div>
          <label htmlFor="brand-hashtag-new" className={labelCls}>
            Hashtags base ({hashtags.length}/{BRAND_MAX_HASHTAGS})
          </label>
          <div className="flex gap-2">
            <input
              id="brand-hashtag-new"
              value={newHashtag}
              maxLength={BRAND_TEXT_LIMITS.base_hashtag}
              placeholder="#fmcomsolutions"
              disabled={hashtags.length >= BRAND_MAX_HASHTAGS}
              onChange={(e) => { setNewHashtag(e.target.value); setHashtagNotice(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHashtag() } }}
              className={inputCls}
            />
            <button
              type="button"
              onClick={addHashtag}
              disabled={hashtags.length >= BRAND_MAX_HASHTAGS || !newHashtag.trim()}
              className="rounded-xl border border-fm-outline-variant px-3 py-2 text-xs font-semibold text-fm-on-surface hover:bg-fm-surface-container-low disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
          {hashtagNotice && <p role="alert" className="mt-1 text-[11px] text-fm-error">{hashtagNotice}</p>}
          {hashtags.length >= BRAND_MAX_HASHTAGS && (
            <p className="mt-1 text-[11px] text-fm-on-surface-variant">Ya están los {BRAND_MAX_HASHTAGS} hashtags que admite el perfil.</p>
          )}
          {hashtags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {hashtags.map((h, i) => (
                <li key={`${i}-${h}`} className="inline-flex items-center gap-1 rounded-full bg-fm-surface-container-low px-2 py-0.5 text-[11px] text-fm-on-surface">
                  <span className="max-w-[12rem] truncate">{h}</span>
                  <button type="button" onClick={() => removeHashtag(i)} aria-label={`Quitar el hashtag ${h}`}
                    className="text-fm-on-surface-variant hover:text-fm-error">
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sm:col-span-2">
          <p className={labelCls}>
            Copys de ejemplo ({filledCopies}/{BRAND_MAX_SAMPLE_COPIES})
            {failedFields.has('sample_copies') && <span className="text-fm-error normal-case"> · sin guardar</span>}
          </p>
          <p className="mb-2 text-[11px] text-fm-on-surface-variant">
            Copys reales que funcionaron. Mueven la calidad del texto más que cualquier adjetivo sobre el tono.
          </p>
          <div className="space-y-2">
            {copies.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <textarea
                  rows={2}
                  maxLength={BRAND_TEXT_LIMITS.sample_copy}
                  aria-label={`Copy de ejemplo ${i + 1}`}
                  value={copyDraft?.index === i ? copyDraft.value : c}
                  onChange={(e) => setCopyDraft({ index: i, value: e.target.value })}
                  onFocus={() => { if (!copyDraft && failedFields.has('sample_copies')) setCopyDraft({ index: i, value: c }) }}
                  onBlur={() => commitCopy(i)}
                  className={`${inputCls} resize-y ${failedFields.has('sample_copies') ? 'border-fm-error/60' : ''}`}
                />
                <button type="button" onClick={() => removeCopy(i)} aria-label={`Quitar el copy de ejemplo ${i + 1}`}
                  className="mt-1 rounded-xl border border-fm-error/40 px-2 py-1.5 text-xs font-semibold text-fm-error hover:bg-fm-error/5">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCopy}
            disabled={copies.length >= BRAND_MAX_SAMPLE_COPIES}
            className="mt-2 text-xs font-semibold text-fm-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            + Agregar copy de ejemplo
          </button>
        </div>
      </div>
    </section>
  )
}
