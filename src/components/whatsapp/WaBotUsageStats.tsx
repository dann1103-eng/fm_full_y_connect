import { createAdminClient } from '@/lib/supabase/admin'

interface AggRow {
  cost_cents: number
  tokens_input: number
  tokens_output: number
  tokens_cached: number
  jobs: number
}

interface MonthData {
  label: string
  startIso: string
  endIso: string
}

function getMonth(offset: number): MonthData {
  // Mes calculado en zona horaria America/El_Salvador (UTC-6, sin DST).
  const now = new Date()
  // Forzamos a UTC-6 sumando -6h al UTC actual y luego trabajamos en UTC para el cálculo.
  const svNow = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  const year = svNow.getUTCFullYear()
  const month = svNow.getUTCMonth() + offset
  // Primer día del mes y primer día del siguiente.
  const start = new Date(Date.UTC(year, month, 1, 6, 0, 0)) // 00:00 SV = 06:00 UTC
  const end = new Date(Date.UTC(year, month + 1, 1, 6, 0, 0))
  const label = start.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })
  return { label, startIso: start.toISOString(), endIso: end.toISOString() }
}

async function aggregate(startIso: string, endIso: string): Promise<AggRow> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ai_jobs')
    // tokens_* fueron añadidos en 0110 (no están en el tipo Database manual)
    .select('cost_usd_cents, tokens_input, tokens_output, tokens_cached' as never)
    .in('job_type', ['whatsapp_reply', 'whatsapp_template'])
    .eq('status', 'completed')
    .gte('finished_at', startIso)
    .lt('finished_at', endIso)
    .limit(10000)

  let cost = 0, tin = 0, tout = 0, tcache = 0
  let jobs = 0
  for (const row of (data ?? []) as unknown as Array<{
    cost_usd_cents: number | null
    tokens_input: number | null
    tokens_output: number | null
    tokens_cached: number | null
  }>) {
    cost += row.cost_usd_cents ?? 0
    tin += row.tokens_input ?? 0
    tout += row.tokens_output ?? 0
    tcache += row.tokens_cached ?? 0
    jobs++
  }
  return { cost_cents: cost, tokens_input: tin, tokens_output: tout, tokens_cached: tcache, jobs }
}

export async function WaBotUsageStats() {
  const current = getMonth(0)
  const previous = getMonth(-1)

  const [cur, prev] = await Promise.all([
    aggregate(current.startIso, current.endIso),
    aggregate(previous.startIso, previous.endIso),
  ])

  return (
    <section className="rounded-xl border border-fm-outline-variant/30 bg-fm-surface p-4 sm:p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-fm-on-surface">Consumo del bot</h2>
        <p className="text-xs text-fm-on-surface-variant mt-0.5">
          Calculado desde la tabla <code>ai_jobs</code>. Tarifas de Sonnet 4.6: $3/M input, $15/M output,
          $0.30/M cache hit. Si cambias de modelo, actualiza la fórmula en{' '}
          <code>whatsappReply.ts</code>.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MonthCard title={`Mes actual (${current.label})`} agg={cur} highlight />
        <MonthCard title={`Mes anterior (${previous.label})`} agg={prev} />
      </div>
    </section>
  )
}

function MonthCard({ title, agg, highlight }: { title: string; agg: AggRow; highlight?: boolean }) {
  const dollars = (agg.cost_cents / 100).toFixed(2)
  const inputK = (agg.tokens_input / 1000).toFixed(1)
  const outputK = (agg.tokens_output / 1000).toFixed(1)
  const cachedK = (agg.tokens_cached / 1000).toFixed(1)

  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-fm-primary/40 bg-fm-primary/5' : 'border-fm-outline-variant/30 bg-fm-surface-container-low'
      }`}
    >
      <div className="text-xs text-fm-on-surface-variant uppercase tracking-wide capitalize">{title}</div>
      <div className={`text-3xl font-semibold mt-1 ${highlight ? 'text-fm-primary' : 'text-fm-on-surface'}`}>
        ${dollars}
      </div>
      <div className="text-xs text-fm-on-surface-variant mt-1">
        {agg.jobs} respuestas del bot
      </div>
      <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div>
          <dt className="text-fm-on-surface-variant">Input</dt>
          <dd className="text-fm-on-surface font-medium">{inputK}k tok</dd>
        </div>
        <div>
          <dt className="text-fm-on-surface-variant">Output</dt>
          <dd className="text-fm-on-surface font-medium">{outputK}k tok</dd>
        </div>
        <div>
          <dt className="text-fm-on-surface-variant">Cache hit</dt>
          <dd className="text-fm-on-surface font-medium">{cachedK}k tok</dd>
        </div>
      </dl>
    </div>
  )
}
