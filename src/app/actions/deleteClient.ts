'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export interface DeleteClientBillingSummary {
  invoices: number
  paidInvoices: number
  quotes: number
}

/**
 * Elimina al cliente y TODO lo suyo. Si tiene facturas o cotizaciones, también se borran
 * (permanentemente), pero solo cuando el llamador confirma con `confirmBilling: true`: sin
 * esa confirmación devuelve `{ billing }` con los conteos y no borra nada, para que la
 * interfaz pueda mostrar exactamente qué se perdería.
 */
export async function deleteClient(
  clientId: string,
  opts: { confirmBilling?: boolean } = {},
): Promise<{ error?: string; billing?: DeleteClientBillingSummary }> {
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

  // ── Pre-check: facturación del cliente ───────────────────────────────────
  // Antes bloqueaba la eliminación. Ahora se permite, pero con confirmación explícita: las
  // facturas son documentos fiscales y se pierden para siempre (la numeración queda con huecos).
  const [invCount, paidCount, quoteCount] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'paid'),
    admin.from('quotes').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
  ])
  if (invCount.error) return { error: `No se pudo verificar facturas: ${invCount.error.message}` }
  if (paidCount.error) return { error: `No se pudo verificar facturas: ${paidCount.error.message}` }
  if (quoteCount.error) return { error: `No se pudo verificar cotizaciones: ${quoteCount.error.message}` }

  const billing: DeleteClientBillingSummary = {
    invoices: invCount.count ?? 0,
    paidInvoices: paidCount.count ?? 0,
    quotes: quoteCount.count ?? 0,
  }
  if ((billing.invoices > 0 || billing.quotes > 0) && !opts.confirmBilling) {
    return { billing }
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

  // ── 6b. Créditos, cotizaciones y facturas ────────────────────────────────
  // Va al final, con todo lo demás ya borrado: si algo anterior falla, las facturas siguen intactas.
  // Orden obligatorio: client_credits.source_invoice_id apunta a la factura sin ON DELETE, así que
  // los créditos van primero (los requerimientos que los usaron ya se borraron en el paso 5).
  // invoices.client_id y quotes.client_id son ON DELETE RESTRICT: hay que vaciarlos antes del cliente.
  // invoice_items / quote_items caen en cascada; pagos n1co, jobs y conversiones quedan en null.
  const { error: credDelErr } = await admin
    .from('client_credits')
    .delete()
    .eq('client_id', clientId)
  if (credDelErr) {
    return { error: `Error al eliminar créditos: ${credDelErr.message}` }
  }

  const { error: quoteDelErr } = await admin
    .from('quotes')
    .delete()
    .eq('client_id', clientId)
  if (quoteDelErr) {
    return { error: `Error al eliminar cotizaciones: ${quoteDelErr.message}` }
  }

  const { error: invDelErr } = await admin
    .from('invoices')
    .delete()
    .eq('client_id', clientId)
  if (invDelErr) {
    return { error: `Error al eliminar facturas: ${invDelErr.message}` }
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
