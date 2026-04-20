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

  // 2. Get requirement IDs
  let requirementIds: string[] = []
  if (cycleIds.length > 0) {
    const { data: requirements } = await supabase
      .from('requirements').select('id').in('billing_cycle_id', cycleIds)
    requirementIds = (requirements ?? []).map((r) => r.id)
  }

  // 3. Cleanup de adjuntos del chat (bucket requirement-attachments).
  // Se hace antes de borrar requirements para que los paths sigan resolviendo.
  if (requirementIds.length > 0) {
    for (const reqId of requirementIds) {
      try {
        const { data: files } = await supabase.storage
          .from('requirement-attachments')
          .list(reqId)
        if (files && files.length > 0) {
          const paths = files.map((f) => `${reqId}/${f.name}`)
          await supabase.storage.from('requirement-attachments').remove(paths)
        }
      } catch (err) {
        console.error(`Cleanup de adjuntos para req ${reqId} falló:`, err)
      }
    }
  }

  // 4. Delete phase logs
  if (requirementIds.length > 0) {
    await supabase.from('requirement_phase_logs')
      .delete().in('requirement_id', requirementIds)
  }

  // 4. Delete requirements
  if (cycleIds.length > 0) {
    await supabase.from('requirements')
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
