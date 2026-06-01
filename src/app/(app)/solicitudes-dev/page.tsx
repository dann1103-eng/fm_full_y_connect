import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { DevRequestForm } from '@/components/dev-requests/DevRequestForm'
import { DevRequestAdminPanel } from '@/components/dev-requests/DevRequestAdminPanel'
import { listDevRequests } from '@/app/actions/devRequests'
import { DEV_REQUEST_STATUS_LABELS } from '@/types/db'
import type { DevRequestStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<DevRequestStatus, string> = {
  pending:     'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20',
  done:        'bg-fm-primary/10 text-fm-primary border border-fm-primary/20',
  rejected:    'bg-fm-error/10 text-fm-error border border-fm-error/20',
}

export default async function SolicitudesDevPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('role, can_request_dev')
    .eq('id', user.id)
    .single()

  const isAdmin     = appUser?.role === 'admin'
  const canRequest  = appUser?.can_request_dev === true

  if (!isAdmin && !canRequest) redirect('/')

  const requests = await listDevRequests()

  // ── Vista del ADMIN (el developer) ─────────────────────────────────────────
  if (isAdmin) {
    return (
      <div className="flex flex-col min-h-full">
        <TopNav title="Solicitudes al dev" />
        <div className="flex-1 p-4 sm:p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-fm-on-surface">Bandeja de entrada 🛠️</h2>
            <p className="text-sm text-fm-on-surface-variant mt-0.5">
              Solicitudes de cambio que te han hecho. Solo tú las ves.
            </p>
          </div>
          <DevRequestAdminPanel requests={requests} />
        </div>
      </div>
    )
  }

  // ── Vista del REQUESTER (el usuario específico) ─────────────────────────────
  const date = (s: string) =>
    new Date(s).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Solicitudes al desarrollador" />
      <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-2xl">

        {/* Formulario */}
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-bold text-fm-on-surface">¿Qué quieres que cambie? 🤔</h2>
            <p className="text-sm text-fm-on-surface-variant mt-0.5">
              Describe tu idea y no olvides la retribución, es importante 👀
            </p>
          </div>
          <DevRequestForm />
        </div>

        {/* Historial de solicitudes del requester */}
        {requests.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-fm-on-surface-variant mb-3">
              Tus solicitudes ({requests.length})
            </p>
            <div className="space-y-3">
              {requests.map(r => (
                <div
                  key={r.id}
                  className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-fm-on-surface leading-snug flex-1 min-w-0">
                      {r.title}
                    </p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[r.status as DevRequestStatus]}`}>
                      {DEV_REQUEST_STATUS_LABELS[r.status as DevRequestStatus]}
                    </span>
                  </div>
                  <p className="text-xs text-fm-on-surface-variant leading-relaxed">{r.description}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-fm-on-surface-variant">{date(r.created_at)}</span>
                    <span className="text-[11px] text-fm-on-surface-variant">
                      💰 {r.compensation_method}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
