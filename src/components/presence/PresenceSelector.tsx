'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'
import { setPresenceStatus, setStatusMessage, touchPresence, leaveStuckCall } from '@/app/actions/presence'
import { useUserOrNull } from '@/contexts/UserContext'
import { useUsersPresence } from '@/hooks/useUsersPresence'
import { PresenceIndicator } from './PresenceIndicator'
import { EmojiPicker } from '@/components/ui/EmojiPicker'
import { cn } from '@/lib/utils'
import type { PresenceStatus, EffectivePresenceStatus } from '@/types/db'

const OPTIONS: Array<{ value: PresenceStatus; label: string; description: string }> = [
  { value: 'online', label: 'En línea', description: 'Disponible para mensajes y llamadas' },
  { value: 'away', label: 'Ausente', description: 'Aviso a tus compañeros que no estás' },
  { value: 'almuerzo', label: 'En almuerzo', description: 'Volveré en un rato' },
]

/**
 * Dropdown que el usuario usa para setear su propio estado.
 * Si el usuario está en una llamada, muestra "En llamada" como override
 * pero deshabilitado — para cambiarlo tiene que terminar la llamada primero.
 */
export function PresenceSelector() {
  const user = useUserOrNull()
  const { getEffective, getStatusMessage, presence } = useUsersPresence()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [emojiDraft, setEmojiDraft] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const [savingMsg, setSavingMsg] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const effective: EffectivePresenceStatus = user ? getEffective(user.id) : 'online'
  const manualCurrent: PresenceStatus = user
    ? presence.get(user.id) ?? 'online'
    : 'online'
  const inCallOverride = effective === 'en_llamada'
  const myStatusMessage = user ? getStatusMessage(user.id) : null

  // Sincronizar drafts cuando cambia el status del propio usuario o se abre el dropdown
  useEffect(() => {
    if (open) {
      setEmojiDraft(myStatusMessage?.emoji ?? '')
      setMessageDraft(myStatusMessage?.message ?? '')
    }
  }, [open, myStatusMessage?.emoji, myStatusMessage?.message])

  // Mantiene updated_at fresco para que otros usuarios no vean este usuario como offline.
  // También crea la fila de presencia la primera vez que el usuario abre la app.
  useEffect(() => {
    if (!user) return
    touchPresence()
    const PING_MS = 20 * 60 * 1000
    const timer = window.setInterval(touchPresence, PING_MS)
    return () => window.clearInterval(timer)
  }, [user])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  if (!user) return null

  function handleSelect(s: PresenceStatus) {
    if (pending) return
    startTransition(async () => {
      await setPresenceStatus(s)
      setOpen(false)
    })
  }

  async function handleSaveMessage() {
    if (savingMsg) return
    setSavingMsg(true)
    try {
      await setStatusMessage({ emoji: emojiDraft, message: messageDraft })
    } finally {
      setSavingMsg(false)
    }
  }

  async function handleClearMessage() {
    if (savingMsg) return
    setSavingMsg(true)
    try {
      setEmojiDraft('')
      setMessageDraft('')
      await setStatusMessage({ emoji: '', message: '' })
    } finally {
      setSavingMsg(false)
    }
  }

  function handleForceLeaveCall() {
    if (pending) return
    startTransition(async () => {
      await leaveStuckCall()
      setOpen(false)
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={inCallOverride ? 'En llamada — cambia tu estado al terminar' : 'Cambiar estado'}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-fm-on-surface-variant hover:bg-fm-surface-container-low transition-colors"
      >
        <PresenceIndicator status={inCallOverride ? 'en_llamada' : manualCurrent} size="sm" />
        <span>
          {inCallOverride
            ? 'En llamada'
            : manualCurrent === 'almuerzo'
              ? 'En almuerzo'
              : manualCurrent === 'away'
                ? 'Ausente'
                : 'En línea'}
        </span>
        <ChevronDownIcon size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-lg shadow-xl overflow-hidden z-[100]">
          {inCallOverride && (
            <div className="px-3 py-2 bg-red-500/10 border-b border-fm-surface-container-high space-y-2">
              <p className="text-[11px] text-fm-on-surface-variant">
                Estás en llamada. El estado se ajusta automáticamente al terminar.
              </p>
              <button
                type="button"
                onClick={handleForceLeaveCall}
                disabled={pending}
                className="w-full px-2 py-1.5 text-[11px] font-bold text-fm-error border border-fm-error/30 hover:bg-fm-error/10 rounded-md transition-colors disabled:opacity-50"
                title="Si no estás en llamada pero el sistema te muestra como tal, fuerza el cierre de la sesión fantasma"
              >
                {pending ? 'Cerrando…' : 'No estoy en llamada — forzar cierre'}
              </button>
            </div>
          )}
          {OPTIONS.map((opt) => {
            const selected = manualCurrent === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                disabled={pending}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-fm-background transition-colors disabled:opacity-50',
                  selected && 'bg-fm-primary/5'
                )}
              >
                <PresenceIndicator status={opt.value} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fm-on-surface">{opt.label}</div>
                  <div className="text-[11px] text-fm-on-surface-variant truncate">
                    {opt.description}
                  </div>
                </div>
                {selected && <CheckIcon size={14} className="text-fm-primary" />}
              </button>
            )
          })}

          {/* Status descriptivo libre — independiente del status formal */}
          <div className="border-t border-fm-surface-container-high px-3 py-3 space-y-2 bg-fm-background/40">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-fm-outline-variant">
              ¿Cómo te sentís hoy?
            </p>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-1 w-14 h-9 bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-lg overflow-hidden">
                <span className="flex-1 text-center text-lg leading-none" aria-label="Emoji actual">
                  {emojiDraft || <span className="text-fm-outline-variant text-xs">···</span>}
                </span>
                <EmojiPicker
                  onSelect={(e) => setEmojiDraft(e)}
                  align="top-left"
                  triggerClassName="px-1.5 h-full hover:bg-fm-background text-fm-on-surface-variant"
                />
              </div>
              <input
                type="text"
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="ej. ocupado, en café, feliz…"
                maxLength={60}
                className="flex-1 text-sm bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-lg px-3 py-1.5 text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveMessage}
                disabled={savingMsg}
                className="flex-1 px-3 py-1.5 bg-fm-primary text-white text-xs font-bold rounded-lg hover:bg-fm-primary-dim disabled:opacity-60 transition-colors"
              >
                {savingMsg ? 'Guardando…' : 'Guardar'}
              </button>
              {(myStatusMessage?.emoji || myStatusMessage?.message) && (
                <button
                  type="button"
                  onClick={handleClearMessage}
                  disabled={savingMsg}
                  className="px-3 py-1.5 text-xs font-bold text-fm-on-surface-variant border border-fm-surface-container-high rounded-lg hover:bg-fm-background disabled:opacity-60 transition-colors"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
