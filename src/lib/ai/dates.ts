/**
 * Valida que una fecha deseada tenga formato aceptable para el bot:
 *  - Fecha: "YYYY-MM-DD"
 *  - Datetime: "YYYY-MM-DDTHH:MM" (opcionalmente con segundos)
 * No valida rango (el staff confirma); solo descarta texto libre.
 */
export function isPlausibleDesiredDate(value: string): boolean {
  if (!value) return false
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
  if (!dateOnly.test(value) && !dateTime.test(value)) return false
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}
