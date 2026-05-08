'use client'

import { useTransition } from 'react'
import { useUser, useImpersonation } from '@/contexts/UserContext'
import { stopImpersonation } from '@/app/actions/impersonation'
import type { UserRole } from '@/types/db'

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  operator: 'Operador',
  client: 'Cliente',
  agent: 'Bot',
}

/**
 * Banner sticky que aparece cuando un admin está suplantando a otro usuario.
 * Color ámbar para alertar. Click "Salir" → server action que limpia la
 * cookie y redirige a /users.
 */
export function SpectatorBanner() {
  const user = useUser()
  const { isImpersonating, realAdminName } = useImpersonation()
  const [isPending, startTransition] = useTransition()

  if (!isImpersonating) return null

  function handleExit() {
    startTransition(async () => {
      await stopImpersonation()
    })
  }

  return (
    <div className="sticky top-0 z-[55] w-full bg-amber-500/90 dark:bg-amber-600/90 backdrop-blur-sm border-b-2 border-amber-700 text-amber-950 dark:text-amber-50">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="material-symbols-outlined text-xl">visibility</span>
        <p className="text-sm font-bold flex-1 min-w-0">
          Modo espectador — viendo como{' '}
          <strong className="font-extrabold">{user.full_name}</strong>{' '}
          ({ROLE_LABEL[user.role]})
          {realAdminName && (
            <span className="ml-2 font-normal text-amber-900/80 dark:text-amber-100/80">
              · admin real: {realAdminName}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={handleExit}
          disabled={isPending}
          className="px-3 py-1.5 rounded-full bg-amber-950/15 hover:bg-amber-950/25 dark:bg-amber-50/15 dark:hover:bg-amber-50/25 text-xs font-bold transition-colors disabled:opacity-60 whitespace-nowrap"
        >
          {isPending ? 'Saliendo…' : 'Salir del modo espectador'}
        </button>
      </div>
    </div>
  )
}
