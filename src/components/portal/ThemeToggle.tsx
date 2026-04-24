'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

/**
 * Toggle de tema claro/oscuro visible en el sidebar del portal.
 * Usa next-themes (`attribute="class"`) que ya está montado en ThemeProvider
 * del layout raíz. Persiste la preferencia en localStorage.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Evita hydration mismatch — el servidor no conoce el tema del usuario.
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-fm-on-surface-variant"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-base">dark_mode</span>
        <span>Tema</span>
      </div>
    )
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-fm-on-surface-variant hover:bg-fm-background hover:text-fm-on-surface transition-colors"
    >
      <span className="material-symbols-outlined text-base">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
      <span>{isDark ? 'Modo claro' : 'Modo oscuro'}</span>
    </button>
  )
}
