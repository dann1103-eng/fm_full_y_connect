import { createWaAdminClient } from '@/lib/whatsapp/db'

/**
 * Jobs de IA que terminaron en error. Cubre las respuestas del bot
 * (whatsapp_reply), las plantillas salientes (whatsapp_template) y los
 * recordatorios de factura por vencer (invoice_due_reminder).
 *
 * Existe porque un job fallido era invisible: el recordatorio se envía
 * at-most-once, así que si falla el cliente simplemente NO recibe su aviso y
 * nadie se entera salvo consultando ai_jobs a mano.
 */

interface FailedJobRow {
  id: string
  job_type: string
  attempts: number
  max_attempts: number
  error_text: string | null
  created_at: string
  finished_at: string | null
  clients: { name: string } | null
  invoices: { invoice_number: string } | null
}

const JOB_TYPE_LABELS: Record<string, string> = {
  whatsapp_reply: 'Respuesta del bot',
  whatsapp_template: 'Plantilla saliente',
  invoice_due_reminder: 'Recordatorio de factura',
}

export async function WaBotFailedJobs() {
  const admin = createWaAdminClient()
  const { data, error } = await admin
    .from('ai_jobs')
    .select(
      'id, job_type, attempts, max_attempts, error_text, created_at, finished_at, clients:client_id ( name ), invoices:invoice_id ( invoice_number )',
    )
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(20)

  // invoice_id llega con la migración 0126; si aún no está aplicada, el select falla.
  if (error) {
    return (
      <section className="rounded-xl border border-fm-outline-variant/30 bg-fm-surface p-4 sm:p-5">
        <h2 className="text-sm font-medium text-fm-on-surface">Jobs con error</h2>
        <p className="text-xs text-fm-on-surface-variant mt-1">
          No se pudo leer <code>ai_jobs</code>. Si acabas de agregar recordatorios, verifica que la
          migración <code>0126_invoice_due_reminders.sql</code> esté aplicada.
        </p>
      </section>
    )
  }

  const rows = (data ?? []) as unknown as FailedJobRow[]

  return (
    <section className="rounded-xl border border-fm-outline-variant/30 bg-fm-surface p-4 sm:p-5 space-y-3">
      <header>
        <h2 className="text-sm font-medium text-fm-on-surface">Jobs con error</h2>
        <p className="text-xs text-fm-on-surface-variant mt-0.5">
          Últimos 20 jobs que agotaron sus reintentos. Un recordatorio de factura fallido significa que
          ese cliente <strong>no recibió su aviso</strong> de vencimiento.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-xs text-fm-on-surface-variant">
          Sin jobs fallidos. Todo el bot y los recordatorios están saliendo bien.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-fm-outline-variant/30">
          <table className="w-full text-sm">
            <thead className="bg-fm-surface-container-low text-xs uppercase tracking-wide text-fm-on-surface-variant">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cuándo</th>
                <th className="text-left px-3 py-2 font-medium">Tipo</th>
                <th className="text-left px-3 py-2 font-medium">Contexto</th>
                <th className="text-right px-3 py-2 font-medium">Intentos</th>
                <th className="text-left px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fm-outline-variant/30">
              {rows.map((j) => (
                <tr key={j.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-fm-on-surface-variant text-xs">
                    {new Date(j.finished_at ?? j.created_at).toLocaleString('es-SV', {
                      timeZone: 'America/El_Salvador',
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2 text-fm-on-surface whitespace-nowrap">
                    {JOB_TYPE_LABELS[j.job_type] ?? j.job_type}
                  </td>
                  <td className="px-3 py-2 text-fm-on-surface-variant text-xs">
                    {j.clients?.name ?? '—'}
                    {j.invoices?.invoice_number && (
                      <span className="block text-fm-on-surface">{j.invoices.invoice_number}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-fm-on-surface-variant whitespace-nowrap">
                    {j.attempts}/{j.max_attempts}
                  </td>
                  <td className="px-3 py-2 text-xs text-fm-error max-w-[320px] break-words">
                    {j.error_text ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
