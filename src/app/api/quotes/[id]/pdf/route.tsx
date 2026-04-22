import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { QuotePDF } from '@/components/billing/QuotePDF'
import type { Quote, QuoteItem } from '@/types/db'

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

  const { data: quote } = await supabase.from('quotes').select('*').eq('id', id).maybeSingle()
  if (!quote) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })

  const { data: items } = await supabase
    .from('quote_items')
    .select('*')
    .eq('quote_id', id)
    .order('sort_order')

  const buffer = await renderToBuffer(
    <QuotePDF quote={quote as Quote} items={(items ?? []) as QuoteItem[]} />
  )

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${(quote as Quote).quote_number}.pdf"`,
    },
  })
}
