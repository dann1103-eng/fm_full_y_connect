'use client'

import { useCallback, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { useIdleScheduler } from '@/hooks/useIdleScheduler'
import { needsPresenceCheck } from '@/lib/domain/permissions'
import { StillOnlineDialog } from './StillOnlineDialog'

/**
 * Monta el scheduler de "¿Sigues en línea?" para usuarios staff.
 * - Dispara a las 6pm exacto + cada 2 horas durante la noche (8pm, 10pm, 12am, 2am, 4am).
 * - Si no responde en 60s: cierra timers + jornada + sesión.
 */
export function IdleSchedulerWrapper() {
  const user = useUser()
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleCheckpoint = useCallback(() => {
    setDialogOpen(true)
  }, [])

  // Los agentes de IA (users.skip_idle_prompt) no ven el aviso: nadie lo contestaría y los sacaría.
  const enabled = needsPresenceCheck(user)
  const { reschedule } = useIdleScheduler({
    enabled,
    onCheckpoint: handleCheckpoint,
  })

  if (!enabled) return null

  return (
    <StillOnlineDialog
      open={dialogOpen}
      onAcknowledge={() => {
        setDialogOpen(false)
        reschedule()
      }}
      onForceLogout={() => {
        setDialogOpen(false)
        // El propio dialog redirige a /auth/signout — no hacemos más aquí.
      }}
    />
  )
}
