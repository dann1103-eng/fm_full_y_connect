'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PlanLimits, WeeklyDistribution } from '@/types/db'

export interface PlanInput {
  name: string
  price_usd: number
  cambios_included: number
  active: boolean
  limits_json: PlanLimits
  default_weekly_distribution_json: WeeklyDistribution | null
  unified_content_limit: number | null
}

async function assertAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const, supabase: null }
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden gestionar planes' as const, supabase: null }
  return { error: null, supabase }
}

function validateInput(data: PlanInput): string | null {
  if (!data.name.trim()) return 'El nombre es requerido'
  if (!Number.isFinite(data.price_usd) || data.price_usd < 0) return 'El precio debe ser ≥ 0'
  if (!Number.isInteger(data.cambios_included) || data.cambios_included < 0)
    return 'Cambios incluidos debe ser entero ≥ 0'
  const limits = data.limits_json
  for (const [key, val] of Object.entries(limits)) {
    if (typeof val === 'number' && val < 0) return `El límite de ${key} no puede ser negativo`
  }
  return null
}

export async function createPlan(data: PlanInput): Promise<{ error?: string; id?: string }> {
  const auth = await assertAdmin()
  if (auth.error) return { error: auth.error }
  const validationError = validateInput(data)
  if (validationError) return { error: validationError }

  // Si es plan unificado, también replicamos el valor dentro de limits_json para
  // que cualquier snapshot futuro lo arrastre sin leer la columna top-level.
  const limitsJsonToSave = data.unified_content_limit != null
    ? { ...data.limits_json, unified_content_limit: data.unified_content_limit }
    : data.limits_json

  const { data: inserted, error } = await auth.supabase
    .from('plans')
    .insert({
      name: data.name.trim(),
      price_usd: data.price_usd,
      cambios_included: data.cambios_included,
      active: data.active,
      limits_json: limitsJsonToSave,
      default_weekly_distribution_json: data.default_weekly_distribution_json,
      unified_content_limit: data.unified_content_limit,
    })
    .select('id')
    .single()

  if (error) return { error: `Error al crear el plan: ${error.message}` }
  revalidatePath('/plans')
  revalidatePath('/clients')
  return { id: inserted.id }
}

export async function updatePlan(
  id: string,
  data: PlanInput
): Promise<{ error?: string }> {
  const auth = await assertAdmin()
  if (auth.error) return { error: auth.error }
  const validationError = validateInput(data)
  if (validationError) return { error: validationError }

  const limitsJsonToSave = data.unified_content_limit != null
    ? { ...data.limits_json, unified_content_limit: data.unified_content_limit }
    : data.limits_json

  const { error } = await auth.supabase
    .from('plans')
    .update({
      name: data.name.trim(),
      price_usd: data.price_usd,
      cambios_included: data.cambios_included,
      active: data.active,
      limits_json: limitsJsonToSave,
      default_weekly_distribution_json: data.default_weekly_distribution_json,
      unified_content_limit: data.unified_content_limit,
    })
    .eq('id', id)

  if (error) return { error: `Error al actualizar el plan: ${error.message}` }
  revalidatePath('/plans')
  revalidatePath('/clients')
  return {}
}
