import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { TopNav } from '@/components/layout/TopNav'
import { DevRequestForm } from '@/components/dev-requests/DevRequestForm'
import { DevRequestAdminPanel } from '@/components/dev-requests/DevRequestAdminPanel'
import { DEV_REQUEST_STATUS_LABELS } from '@/types/db'
import type { DevRequest, DevRequestStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<DevRequestStatus, string> = {
  pending:     'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20',
  done:        'bg-fm-primary/10 text-fm-primary border border-fm-primary/20',
  rejected:    'bg-fm-error/10 text-fm-error border border-fm-error/20',
}

export default async function SolicitudesDevPage() {
  // getEffectiveUser respeta la impersonación: si el admin está suplantando a
  // alguien, effectiveUser es ese alguien, no el admin.
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')

  const effectiveUser  = ctx.appUser
  const isImpersonating = ctx.isImpersonating

  // La vista se decide por el usuario efectivo (respeta impersonación)
  const isRealAdmin  = effectiveUser.role === 'admin' && !isImpersonating
  const canRequest   = effectiveUser.can_request_dev === true

  if (!canRequest) redirect('/')

  // Fetch de datos usando adminClient para bypassear RLS
  const admin = createAdminClient()
  let requests: DevRequest[]

  if (isRealAdmin) {
    // Admin real: ve todas las solicitudes
    const { data } = await admin
      .from('dev_requests')
      .select('*')
      .order('created_at', { ascending: false })
    requests = (data ?? []) as DevRequest[]
  } else {
    // Requester (o admin impersonando al requester): solo las suyas
    const { data } = await admin
      .from('dev_requests')
      .select('*')
      .eq('created_by', effectiveUser.id)
      .order('created_at', { ascending: false })
    requests = (data ?? []) as DevRequest[]
  }

  // ── Vista del ADMIN real (el developer) ─────────────────────────────────────
  if (isRealAdmin) {
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

  // ── Vista del REQUESTER (usuario con can_request_dev, o admin impersonándolo) ─
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
