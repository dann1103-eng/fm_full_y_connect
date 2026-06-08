export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createWaAdminClient } from '@/lib/whatsapp/db'
import { createAdminClient } from '@/lib/supabase/admin'
import { TopNav } from '@/components/layout/TopNav'
import { LeadsBoard } from '@/components/whatsapp/LeadsBoard'
import { LeadsStats } from '@/components/whatsapp/LeadsStats'

export interface LeadRow {
  id: string
  conversation_id: string
  phone_e164: string
  company_name: string | null
  contact_name: string | null
  interest: string | null
  budget_range: string | null
  urgency: string | null
  notes: string | null
  status: 'active' | 'escalated' | 'converted' | 'rejected' | 'archived'
  assigned_to_user_id: string | null
  converted_to_client_id: string | null
  converted_at: string | null
  rejected_reason: string | null
  status_updated_at: string
  created_at: string
  updated_at: string
}

export interface PlanOption {
  id: string
  name: string
}

export interface UserOption {
  id: string
  full_name: string
}

export default async function WhatsappLeadsPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (ctx.appUser.role === 'client') redirect('/portal/dashboard')

  const wa = createWaAdminClient()
  const admin = createAdminClient()

  const [leadsRes, plansRes, usersRes] = await Promise.all([
    wa.from('wa_leads').select('*').order('created_at', { ascending: false }).limit(500),
    admin.from('plans').select('id, name').order('name'),
    admin.from('users').select('id, full_name').neq('role', 'client').order('full_name'),
  ])

  const leads = (leadsRes.data ?? []) as LeadRow[]
  const plans = (plansRes.data ?? []) as PlanOption[]
  const users = (usersRes.data ?? []) as UserOption[]

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Leads de WhatsApp" />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <LeadsStats leads={leads} />
        <LeadsBoard leads={leads} plans={plans} users={users} currentUserId={ctx.appUser.id} />
      </main>
    </div>
  )
}
