'use client'

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

interface FormFieldProps {
  label: ReactNode
  /** Cuando hay un único hijo de form (input/select/textarea), se le inyecta `id` para asociar con el `<label htmlFor>`. */
  children: ReactNode
  /** Texto descriptivo bajo el control. */
  hint?: ReactNode
  /** Mensaje de error bajo el control. Si está set, anula `hint`. */
  error?: ReactNode
  /** Marca el label como obligatorio (asterisco rojo). */
  required?: boolean
  className?: string
  labelClassName?: string
}

/**
 * Asocia un label visible con su control vía `htmlFor`/`id` generados con
 * useId. Usar en lugar del patrón manual `<div><label/><input/></div>`.
 *
 * Si el hijo único es un input/select/textarea, recibe el id automáticamente.
 * Para casos complejos (grupos, addons), el caller puede pasar el id como
 * prop al hijo manualmente.
 */
export function FormField({
  label,
  children,
  hint,
  error,
  required,
  className,
  labelClassName,
}: FormFieldProps) {
  const id = useId()

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={labelClassName ?? 'text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide'}
      >
        {label}
        {required && <span className="ml-0.5 text-fm-error" aria-hidden="true">*</span>}
      </label>
      {child}
      {error ? (
        <p className="mt-1 text-xs text-fm-error">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-fm-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  )
}
