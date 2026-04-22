import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { InvoiceForm } from '@/components/billing/InvoiceForm'

export const dynamic = 'force-dynamic'

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; cycle_id?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') redirect('/billing')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Nueva factura" />
      <div className="flex-1 p-6">
        <InvoiceForm mode="invoice" initialClientId={params.client_id} initialCycleId={params.cycle_id} />
      </div>
    </div>
  )
}
