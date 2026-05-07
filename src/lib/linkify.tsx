import React from 'react'

const URL_RE = /(https?:\/\/[^\s<>()]+)/g

/**
 * Convierte URLs `http(s)://...` en texto a hipervínculos clickeables.
 * Preserva los saltos de línea (depende de `whitespace-pre-wrap` en el contenedor).
 *
 * - Abre en nueva pestaña con `rel="noopener noreferrer"` por seguridad.
 * - No parsea markdown ni emails — sólo URLs explícitas.
 */
export function linkify(text: string): React.ReactNode {
  if (!text) return text
  const parts = text.split(URL_RE)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const trimmed = part.replace(/[.,;:!?)]+$/, '')
      const trailing = part.slice(trimmed.length)
      return (
        <React.Fragment key={i}>
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 break-all"
          >
            {trimmed}
          </a>
          {trailing}
        </React.Fragment>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}
