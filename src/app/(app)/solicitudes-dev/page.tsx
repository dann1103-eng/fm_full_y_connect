import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { TopNav } from '@/components/layout/TopNav'
import { SolicitudesEspecialesPanel } from '@/components/dev-requests/SolicitudesEspecialesPanel'
import type { DevRequestNote, DevRequestWithNotes } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function SolicitudesDevPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')

  const effectiveUser = ctx.appUser
  const canRequest    = effectiveUser.can_request_dev === true
  if (!canRequest) redirect('/')

  const userId = effectiveUser.id
  const admin  = createAdminClient()

  // Traer todas las solicitudes en las que este usuario está involucrado
  const { data: requests } = await admin
    .from('dev_requests')
    .select('*')
    .or(`created_by.eq.${userId},target_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })

  let received: DevRequestWithNotes[] = []
  let sent: DevRequestWithNotes[] = []

  if (requests?.length) {
    const reqIds = requests.map(r => r.id)
    const { data: notes } = await admin
      .from('dev_request_notes')
      .select('*')
      .in('request_id', reqIds)
      .order('created_at', { ascending: true })

    const notesMap: Record<string, DevRequestNote[]> = {}
    for (const note of (notes ?? []) as DevRequestNote[]) {
      if (!notesMap[note.request_id]) notesMap[note.request_id] = []
      notesMap[note.request_id].push(note)
    }

    const enriched: DevRequestWithNotes[] = (requests as DevRequestWithNotes[]).map(r => ({
      ...r,
      notes: notesMap[r.id] ?? [],
      is_recipient: r.target_user_id === userId,
    }))

    received = enriched.filter(r => r.is_recipient)
    sent     = enriched.filter(r => !r.is_recipient)
  }

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Solicitudes Especiales" />
      <div className="flex-1 p-4 sm:p-6 max-w-2xl space-y-1">
        <p className="text-xs text-fm-on-surface-variant mb-4">
          Solo visible entre los dos. 🤫
        </p>
        <SolicitudesEspecialesPanel
          received={received}
          sent={sent}
          currentUserId={userId}
        />
      </div>
    </div>
  )
}
