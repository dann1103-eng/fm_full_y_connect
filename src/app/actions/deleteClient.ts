'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function deleteClient(
  clientId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  // Auth + admin check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }
  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') {
    return { error: 'Solo admins pueden eliminar clientes.' }
  }

  const admin = createAdminClient()

  // ── Pre-check: bloqueantes que requieren limpieza manual ─────────────────
  const { count: invoiceCount, error: invCountErr } = await admin
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (invCountErr) {
    return { error: `No se pudo verificar facturas: ${invCountErr.message}` }
  }
  if ((invoiceCount ?? 0) > 0) {
    return {
      error: `No se puede eliminar: el cliente tiene ${invoiceCount} factura(s). Elimínalas o anúlalas primero.`,
    }
  }

  const { count: quoteCount, error: qCountErr } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (qCountErr) {
    return { error: `No se pudo verificar cotizaciones: ${qCountErr.message}` }
  }
  if ((quoteCount ?? 0) > 0) {
    return {
      error: `No se puede eliminar: el cliente tiene ${quoteCount} cotización(es). Elimínalas primero.`,
    }
  }

  // ── 0. Limpiar usuarios de portal vinculados a este cliente ──────────────
  const { data: clientUserRows, error: cuFetchErr } = await admin
    .from('client_users')
    .select('user_id')
    .eq('client_id', clientId)
  if (cuFetchErr) {
    return { error: `Error al leer usuarios del portal: ${cuFetchErr.message}` }
  }

  for (const { user_id } of clientUserRows ?? []) {
    const { data: otherLinks } = await admin
      .from('client_users')
      .select('id')
      .eq('user_id', user_id)
      .neq('client_id', clientId)
      .limit(1)

    if (!otherLinks || otherLinks.length === 0) {
      const { error: usrErr } = await admin.from('users').delete().eq('id', user_id)
      if (usrErr) {
        return { error: `Error al eliminar usuario del portal: ${usrErr.message}` }
      }
      await admin.auth.admin.deleteUser(user_id).catch((err) =>
        console.error(`No se pudo eliminar auth user ${user_id}:`, err),
      )
    }
  }

  const { error: cuDelErr } = await admin
    .from('client_users')
    .delete()
    .eq('client_id', clientId)
  if (cuDelErr) {
    return { error: `Error al eliminar accesos del portal: ${cuDelErr.message}` }
  }

  // ── 1. Obtener IDs de ciclos ──────────────────────────────────────────────
  const { data: cycles, error: cyclesErr } = await admin
    .from('billing_cycles').select('id').eq('client_id', clientId)
  if (cyclesErr) {
    return { error: `Error al leer ciclos: ${cyclesErr.message}` }
  }
  const cycleIds = (cycles ?? []).map((c) => c.id)

  // ── 2. Obtener IDs de requerimientos ─────────────────────────────────────
  let requirementIds: string[] = []
  if (cycleIds.length > 0) {
    const { data: requirements, error: reqsErr } = await admin
      .from('requirements').select('id').in('billing_cycle_id', cycleIds)
    if (reqsErr) {
      return { error: `Error al leer requerimientos: ${reqsErr.message}` }
    }
    requirementIds = (requirements ?? []).map((r) => r.id)
  }

  // ── 3. Cleanup de adjuntos del chat ──────────────────────────────────────
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

  // ── 4. Borrar logs de fases ───────────────────────────────────────────────
  if (requirementIds.length > 0) {
    const { error: logsErr } = await admin
      .from('requirement_phase_logs')
      .delete()
      .in('requirement_id', requirementIds)
    if (logsErr) {
      return { error: `Error al eliminar logs: ${logsErr.message}` }
    }
  }

  // ── 5. Borrar requerimientos ──────────────────────────────────────────────
  if (cycleIds.length > 0) {
    const { error: reqDelErr } = await admin
      .from('requirements')
      .delete()
      .in('billing_cycle_id', cycleIds)
    if (reqDelErr) {
      return { error: `Error al eliminar requerimientos: ${reqDelErr.message}` }
    }
  }

  // ── 6. Borrar ciclos de facturación ──────────────────────────────────────
  if (cycleIds.length > 0) {
    const { error: bcDelErr } = await admin
      .from('billing_cycles')
      .delete()
      .eq('client_id', clientId)
    if (bcDelErr) {
      return { error: `Error al eliminar ciclos: ${bcDelErr.message}` }
    }
  }

  // ── 7. Borrar cliente ─────────────────────────────────────────────────────
  const { error: clientDelErr } = await admin
    .from('clients')
    .delete()
    .eq('id', clientId)
  if (clientDelErr) {
    return { error: `Error al eliminar cliente: ${clientDelErr.message}` }
  }

  redirect('/clients')
}
