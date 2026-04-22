import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { InvoicePDF } from '@/components/billing/InvoicePDF'
import type { Invoice, InvoiceItem } from '@/types/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order')

  const buffer = await renderToBuffer(
    <InvoicePDF invoice={invoice as Invoice} items={(items ?? []) as InvoiceItem[]} />
  )

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${(invoice as Invoice).invoice_number}.pdf"`,
    },
  })
}
