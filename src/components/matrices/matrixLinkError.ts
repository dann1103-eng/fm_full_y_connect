/**
 * Motivo real de un vínculo de requerimiento fallido al crear o duplicar una matriz. La acción lo devuelve
 * antes de navegar al editor; se pasa por sessionStorage (nunca por la URL) y el editor lo consume al montar.
 * Todas las funciones toleran un storage no disponible: en ese caso el editor muestra el aviso genérico.
 */

function key(matrixId: string) {
  return `matrix-link-error:${matrixId}`
}

export function rememberLinkError(matrixId: string, error: string): void {
  try {
    sessionStorage.setItem(key(matrixId), error)
  } catch {
    // storage bloqueado o lleno: se pierde solo el detalle del motivo
  }
}

export function readLinkError(matrixId: string): string | null {
  try {
    return sessionStorage.getItem(key(matrixId))
  } catch {
    return null
  }
}

export function forgetLinkError(matrixId: string): void {
  try {
    sessionStorage.removeItem(key(matrixId))
  } catch {
    // nada que limpiar si el storage no está disponible
  }
}
