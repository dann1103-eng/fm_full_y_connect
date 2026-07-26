import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchInvoiceForPdf, renderInvoicePdf } from '@/lib/billing/invoice-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const data = await fetchInvoiceForPdf(supabase, id)
  if (!data) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  // Staff (admin/supervisor) siempre puede ver cualquier factura.
  // Clientes pueden ver solo facturas de los clients a los que están vinculados.
  // Se autoriza ANTES de renderizar para no gastar el render en un 403.
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  const isStaff = appUser?.role === 'admin' || appUser?.role === 'supervisor'

  if (!isStaff) {
    const { data: link } = await supabase
      .from('client_users')
      .select('client_id')
      .eq('user_id', user.id)
      .eq('client_id', data.invoice.client_id)
      .maybeSingle()
    if (!link) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const buffer = await renderInvoicePdf(data)

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.invoice.invoice_number}.pdf"`,
    },
  })
}
