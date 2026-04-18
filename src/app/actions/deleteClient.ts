'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function deleteClient(clientId: string): Promise<void> {
  const supabase = await createClient()

  // Auth + admin check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') throw new Error('Solo admins pueden eliminar clientes')

  // 1. Get cycle IDs
  const { data: cycles } = await supabase
    .from('billing_cycles').select('id').eq('client_id', clientId)
  const cycleIds = (cycles ?? []).map((c) => c.id)

  // 2. Get consumption IDs
  let consumptionIds: string[] = []
  if (cycleIds.length > 0) {
    const { data: consumptions } = await supabase
      .from('consumptions').select('id').in('billing_cycle_id', cycleIds)
    consumptionIds = (consumptions ?? []).map((c) => c.id)
  }

  // 3. Delete phase logs
  if (consumptionIds.length > 0) {
    await supabase.from('consumption_phase_logs')
      .delete().in('consumption_id', consumptionIds)
  }

  // 4. Delete consumptions
  if (cycleIds.length > 0) {
    await supabase.from('consumptions')
      .delete().in('billing_cycle_id', cycleIds)
  }

  // 5. Delete billing cycles
  if (cycleIds.length > 0) {
    await supabase.from('billing_cycles')
      .delete().eq('client_id', clientId)
  }

  // 6. Delete client
  await supabase.from('clients').delete().eq('id', clientId)

  redirect('/clients')
}
