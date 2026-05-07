'use client'

import { useCallback, useEffect, useRef } from 'react'
import { PhoneIcon, PhoneOffIcon } from 'lucide-react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useUserOrNull } from '@/contexts/UserContext'
import { useIncomingCall } from '@/hooks/useIncomingCall'
import { useActiveCallOrNull } from '@/contexts/ActiveCallContext'
import { endCall } from '@/app/actions/calls'

/** Tiempo máximo de timbrado antes de auto-rechazar. */
const MAX_RING_MS = 25_000

/**
 * Solicita permiso de notificaciones del navegador la primera vez. Necesario
 * para alertar al usuario cuando la pestaña del CRM está en background — los
 * browsers throttlean audio y JS en tabs inactivas, pero las Notifications
 * API se muestran a nivel de sistema operativo.
 */
function ensureNotificationPermission() {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

export function IncomingCallToast() {
  const user = useUserOrNull()
  const { incoming, dismiss } = useIncomingCall(user?.id ?? null)
  const callCtx = useActiveCallOrNull()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const notificationRef = useRef<Notification | null>(null)

  // Pedir permiso de notificaciones al iniciar sesión.
  useEffect(() => {
    if (user?.id) ensureNotificationPermission()
  }, [user?.id])

  const activeCall = callCtx?.activeCall ?? null
  const inAnotherCall = !!(activeCall && incoming && activeCall.sessionId !== incoming.sessionId)
  const isChannelCall = !!incoming?.channelName

  /** Detiene el ringtone, el timer y cierra la notificación OS si existe. */
  const stopRing = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (notificationRef.current) {
      notificationRef.current.close()
      notificationRef.current = null
    }
  }, [])

  /**
   * Auto-rechazo tras MAX_RING_MS.
   * - DM: termina la sesión (el caller queda sin contraparte).
   * - Canal: solo descarta el toast; la sesión sigue viva para otros miembros.
   */
  const autoReject = useCallback(async () => {
    stopRing()
    if (incoming && !isChannelCall) {
      await endCall(incoming.sessionId).catch(() => {})
    }
    dismiss()
  }, [incoming, isChannelCall, stopRing, dismiss])

  // Si ya estamos en otra llamada, descartar silenciosamente.
  useEffect(() => {
    if (incoming && inAnotherCall) {
      stopRing()
      if (!isChannelCall) {
        endCall(incoming.sessionId).catch(() => {})
      }
      dismiss()
    }
  }, [incoming, inAnotherCall, isChannelCall, stopRing, dismiss])

  useEffect(() => {
    if (!incoming || inAnotherCall) return
    const audio = new Audio('/ringtone.mp3')
    audio.loop = true
    audio.volume = 0.85
    audioRef.current = audio
    audio.play().catch((err) => {
      console.warn('[ringtone] autoplay bloqueado:', err)
    })
    timeoutRef.current = window.setTimeout(autoReject, MAX_RING_MS)

    // Si la pestaña está en background, los browsers pausan audio y throttlean
    // timers — el toast es invisible para el usuario. Disparamos una
    // notificación OS-level que sí se muestra fuera del browser.
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      try {
        const title = incoming.channelName
          ? `Llamada en #${incoming.channelName}`
          : `Llamada entrante de ${incoming.fromUser.full_name}`
        const body = incoming.channelName
          ? `${incoming.fromUser.full_name} inició una llamada`
          : incoming.modality === 'video'
            ? 'Videollamada'
            : incoming.modality === 'screen'
              ? 'Compartir pantalla'
              : 'Llamada de voz'
        const notif = new Notification(title, {
          body,
          icon: incoming.fromUser.avatar_url ?? '/icon-192.png',
          tag: `incoming-call-${incoming.sessionId}`,
          requireInteraction: true,
        })
        notif.onclick = () => {
          window.focus()
          notif.close()
        }
        notificationRef.current = notif
      } catch (err) {
        console.warn('[notification] no se pudo crear:', err)
      }
    }

    return () => {
      stopRing()
    }
  }, [incoming, inAnotherCall, autoReject, stopRing])

  if (!incoming || !callCtx || inAnotherCall) return null

  const { startActiveCall } = callCtx

  const modalityLabel =
    incoming.modality === 'video'
      ? 'Videollamada'
      : incoming.modality === 'screen'
        ? 'Compartir pantalla'
        : 'Llamada de voz'

  function handleAccept() {
    if (!incoming) return
    stopRing()
    startActiveCall({
      sessionId: incoming.sessionId,
      conversationId: incoming.conversationId,
      roomName: incoming.roomName,
      modality: incoming.modality,
      title: incoming.channelName ? `#${incoming.channelName}` : incoming.fromUser.full_name,
      counterpartAvatarUrl: incoming.channelName ? null : (incoming.fromUser.avatar_url ?? null),
      isChannelCall: !!incoming.channelName,
      isInitiator: false,
    })
    dismiss()
  }

  function handleReject() {
    stopRing()
    // En canales solo descartar el toast; la sesión sigue para otros miembros.
    if (incoming && !isChannelCall) {
      endCall(incoming.sessionId).catch(() => {})
    }
    dismiss()
  }

  return (
    <div className="fixed bottom-6 right-6 z-[300] w-[320px] bg-white border border-[#dfe3e6] rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4">
      <div className="px-4 py-3 bg-[#00675c]/5 border-b border-[#dfe3e6]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#00675c]">
          {modalityLabel} {isChannelCall ? 'en canal' : 'entrante'}
        </p>
      </div>
      <div className="px-4 py-4 flex items-center gap-3">
        {!isChannelCall && (
          <UserAvatar
            name={incoming.fromUser.full_name}
            avatarUrl={incoming.fromUser.avatar_url}
            size="md"
          />
        )}
        {isChannelCall && (
          <div className="w-10 h-10 rounded-full bg-fm-primary/10 flex items-center justify-center text-fm-primary font-bold text-lg flex-shrink-0">
            #
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#2a2a2a] truncate">
            {isChannelCall ? `#${incoming.channelName}` : incoming.fromUser.full_name}
          </p>
          <p className="text-xs text-[#595c5e]">
            {isChannelCall
              ? `${incoming.fromUser.full_name} inició una llamada`
              : 'te está llamando…'}
          </p>
        </div>
      </div>
      <div className="px-4 pb-4 flex gap-2">
        <button
          type="button"
          onClick={handleReject}
          className="flex-1 h-10 rounded-lg bg-[#b31b25]/10 text-[#b31b25] hover:bg-[#b31b25]/20 flex items-center justify-center gap-2 font-semibold text-sm transition-colors"
        >
          <PhoneOffIcon size={16} />
          {isChannelCall ? 'Ignorar' : 'Rechazar'}
        </button>
        <button
          type="button"
          onClick={handleAccept}
          className="flex-1 h-10 rounded-lg bg-[#00675c] text-white hover:bg-[#00675c]/90 flex items-center justify-center gap-2 font-semibold text-sm transition-colors"
        >
          <PhoneIcon size={16} />
          {isChannelCall ? 'Unirse' : 'Aceptar'}
        </button>
      </div>
    </div>
  )
}
