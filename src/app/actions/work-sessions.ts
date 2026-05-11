'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from './impersonation'
import { setPresenceStatus } from './presence'
import type { PresenceStatus, WorkSession, WorkSessionBreak, ShiftBreakType } from '@/types/db'

// Mantiene el indicador de presencia del topnav alineado con el estado de la
// jornada. Falla silenciosamente si la presencia no se puede actualizar.
async function syncPresenceFromShift(status: PresenceStatus) {
  try {
    await setPresenceStatus(status)
  } catch {
    /* no crítico */
  }
}

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return { supabase, user }
}

async function getMyActive(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<WorkSession | null> {
  const { data } = await supabase
    .from('work_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle()
  return (data as WorkSession | null) ?? null
}

export async function getMyActiveShift(): Promise<WorkSession | null> {
  const { supabase, user } = await getAuthUser()
  return getMyActive(supabase, user.id)
}

export async function startShift(notes?: string): Promise<{ ok: true; sessionId: string } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const existing = await getMyActive(supabase, user.id)
  if (existing) return { error: 'Ya tienes una jornada activa.' }

  const { data, error } = await supabase
    .from('work_sessions')
    .insert({ user_id: user.id, notes: notes ?? null })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'No se pudo iniciar la jornada.' }
  await syncPresenceFromShift('online')

  // Broadcast a todo el equipo interno: sonido + toast "X está online".
  // Tiene que ir después del insert para que el user esté efectivamente online.
  try {
    const { data: appUser } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .eq('id', user.id)
      .single()
    if (appUser && appUser.role !== 'client' && appUser.role !== 'agent') {
      const channel = supabase.channel('team-presence')
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), 3000)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(t)
            resolve()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(t)
            resolve()
          }
        })
      })
      await channel.send({
        type: 'broadcast',
        event: 'shift_started',
        payload: {
          userId: appUser.id,
          fullName: appUser.full_name,
          avatarUrl: appUser.avatar_url,
          role: appUser.role,
          at: new Date().toISOString(),
        },
      })
      await supabase.removeChannel(channel)
    }
  } catch (err) {
    // No bloquear la creación de la jornada si la notificación falla
    console.error('[startShift] broadcast falló:', err)
  }

  revalidatePath('/tiempo')
  return { ok: true, sessionId: data.id }
}

export async function endShift(): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const active = await getMyActive(supabase, user.id)
  if (!active) return { error: 'No hay jornada activa.' }

  // Cerrar cualquier pausa abierta antes de finalizar
  const breaks = (active.breaks_json ?? []) as WorkSessionBreak[]
  const lastBreak = breaks[breaks.length - 1]
  const now = new Date()
  let updatedBreaks = breaks
  if (lastBreak && !lastBreak.ended_at) {
    updatedBreaks = [...breaks.slice(0, -1), { ...lastBreak, ended_at: now.toISOString() }]
  }

  // Calcular totalSeconds (online = ended − started − Σ pausas cerradas)
  const startedAt = new Date(active.started_at).getTime()
  const endedAt = now.getTime()
  const elapsed = Math.round((endedAt - startedAt) / 1000)
  const breaksSeconds = updatedBreaks.reduce((sum, b) => {
    if (!b.ended_at) return sum
    return sum + Math.round((new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000)
  }, 0)
  const totalSeconds = Math.max(0, elapsed - breaksSeconds)

  // Sumar tiempo productivo (time_entries del usuario en la ventana de la jornada).
  // Cotamos `started_at <= now` para no arrastrar entradas futuras.
  const { data: prodRows } = await supabase
    .from('time_entries')
    .select('duration_seconds, started_at, ended_at')
    .eq('user_id', user.id)
    .gte('started_at', active.started_at)
    .lte('started_at', now.toISOString())
    .not('ended_at', 'is', null)
  const productiveSeconds = (prodRows ?? []).reduce(
    (sum, r) => sum + ((r.duration_seconds as number | null) ?? 0),
    0,
  )

  const { error } = await supabase
    .from('work_sessions')
    .update({
      ended_at: now.toISOString(),
      status: 'ended',
      breaks_json: updatedBreaks,
      total_seconds: totalSeconds,
      productive_seconds: productiveSeconds,
    })
    .eq('id', active.id)
  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  revalidatePath('/reports')
  return { ok: true }
}

export async function startBreak(type: ShiftBreakType): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const active = await getMyActive(supabase, user.id)
  if (!active) return { error: 'Inicia una jornada antes de marcar pausas.' }
  if (active.status !== 'active') return { error: 'Ya estás en una pausa. Reanuda primero la jornada.' }

  const breaks = [
    ...((active.breaks_json ?? []) as WorkSessionBreak[]),
    { type, started_at: new Date().toISOString() },
  ]
  const newStatus = type === 'lunch' ? 'on_lunch' : 'on_away'
  const { error } = await supabase
    .from('work_sessions')
    .update({ status: newStatus, breaks_json: breaks })
    .eq('id', active.id)
  if (error) return { error: error.message }
  await syncPresenceFromShift(type === 'lunch' ? 'almuerzo' : 'away')
  revalidatePath('/tiempo')
  return { ok: true }
}

/**
 * Convierte automáticamente una pausa de almuerzo en "away" cuando excede el límite.
 * Cierra el break de lunch con ended_at=now y abre uno nuevo de tipo away,
 * cambiando el status de la sesión a on_away. Operación atómica.
 */
export async function convertLunchToAway(): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const active = await getMyActive(supabase, user.id)
  if (!active) return { error: 'No hay jornada activa.' }
  if (active.status !== 'on_lunch') return { error: 'No estás en almuerzo.' }

  const breaks = [...((active.breaks_json ?? []) as WorkSessionBreak[])]
  const last = breaks[breaks.length - 1]
  if (!last || last.ended_at) return { error: 'No hay pausa de almuerzo abierta.' }

  const now = new Date().toISOString()
  breaks[breaks.length - 1] = { ...last, ended_at: now }
  breaks.push({ type: 'away', started_at: now })

  const { error } = await supabase
    .from('work_sessions')
    .update({ status: 'on_away', breaks_json: breaks })
    .eq('id', active.id)
  if (error) return { error: error.message }
  await syncPresenceFromShift('away')
  revalidatePath('/tiempo')
  return { ok: true }
}

export async function endBreak(): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const active = await getMyActive(supabase, user.id)
  if (!active) return { error: 'No hay jornada activa.' }
  if (active.status !== 'on_lunch' && active.status !== 'on_away') {
    return { error: 'No estás en pausa.' }
  }

  const breaks = [...((active.breaks_json ?? []) as WorkSessionBreak[])]
  const last = breaks[breaks.length - 1]
  if (!last || last.ended_at) {
    return { error: 'No hay pausa abierta que reanudar.' }
  }
  breaks[breaks.length - 1] = { ...last, ended_at: new Date().toISOString() }

  const { error } = await supabase
    .from('work_sessions')
    .update({ status: 'active', breaks_json: breaks })
    .eq('id', active.id)
  if (error) return { error: error.message }
  await syncPresenceFromShift('online')
  revalidatePath('/tiempo')
  return { ok: true }
}
