'use server'

import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from './impersonation'
import { canManageMatrices } from '@/lib/domain/permissions'
import { validateBrandPatch, type BrandPatch } from '@/lib/domain/brand'
import type { ActionResult } from '@/lib/domain/matrix'
import type { ClientBrandProfile, Database } from '@/types/db'

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
type BrandInsert = Database['public']['Tables']['client_brand_profiles']['Insert']

const INVALID_DATA = 'Datos inválidos.'

/** Autenticación + rol admin/supervisor, igual que en `matrices.ts` (la tabla tiene esa misma policy). */
async function requireManager(): Promise<Ctx | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!canManageMatrices(data?.role)) return { error: 'Sin permisos' }
  return { supabase, userId: user.id }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function dbError(error: { code?: string; message: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.code === '23503') return 'Cliente no encontrado.'
  // Un check de longitud de 0131: la app ya validó, así que esto solo salta con datos raros.
  if (error.code === '23514') return 'Hay un campo que supera el límite permitido.'
  return error.message || fallback
}

/** Texto del formulario: recorta y deja `null` si queda vacío — una sola forma de "vacío" en la base. */
function cleanText(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  return v.trim() || null
}

/** Lista del formulario: recorta cada elemento, descarta los vacíos y deja `null` si no queda ninguno. */
function cleanList(v: string[] | null | undefined): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => s.length > 0)
  return out.length > 0 ? out : null
}

const TEXT_KEYS = ['tone', 'audience', 'value_proposition', 'offerings', 'avoid'] as const

/**
 * Guardado por campo del perfil de marca. Cliente **autenticado** (la tabla tiene policy `for all`
 * para admin/supervisor, no hace falta el admin client) y **sin `revalidatePath`**: en este Next 16
 * revalidar dentro de una server action re-renderiza la página entera del cliente, así que cada
 * campo que perdiera el foco refrescaría todo el perfil. La tarjeta aplica la fila devuelta.
 *
 * `upsert` por `client_id`: PostgREST solo escribe las columnas presentes en el payload, así que un
 * parche de un campo no borra el resto.
 */
export async function updateBrandProfile(clientId: string, patch: BrandPatch): Promise<ActionResult<{ profile: ClientBrandProfile }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  if (typeof clientId !== 'string' || !clientId.trim()) return { ok: false, error: INVALID_DATA }
  if (!isPlainObject(patch)) return { ok: false, error: INVALID_DATA }

  const v = validateBrandPatch(patch)
  if (!v.ok) return { ok: false, error: v.error }

  const row: BrandInsert = { client_id: clientId, updated_by_user_id: userId }
  for (const k of TEXT_KEYS) {
    if (patch[k] !== undefined) row[k] = cleanText(patch[k])
  }
  if (patch.person !== undefined) row.person = patch.person ?? null
  if (patch.base_hashtags !== undefined) row.base_hashtags = cleanList(patch.base_hashtags)
  if (patch.sample_copies !== undefined) row.sample_copies = cleanList(patch.sample_copies)

  const { data, error } = await supabase
    .from('client_brand_profiles')
    .upsert(row, { onConflict: 'client_id' })
    .select('*')
    .single()
  if (error || !data) return { ok: false, error: dbError(error, 'No se pudo guardar el perfil de marca.') }
  return { ok: true, profile: data as ClientBrandProfile }
}
