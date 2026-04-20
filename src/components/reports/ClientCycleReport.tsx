import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'
import type { ContentType, Phase, CambiosPackage, ExtraContentItem, PlanLimits } from '@/types/db'
import { CONTENT_TYPE_LABELS, CONTENT_TYPES, limitsToRecord } from '@/lib/domain/plans'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReportClient {
  name: string
  contact_email: string | null
  contact_phone: string | null
  ig_handle: string | null
  plan: { name: string; price_usd: number; cambios_included: number }
}

export interface ReportCycle {
  period_start: string
  period_end: string
  payment_status: 'paid' | 'unpaid'
  limits_snapshot_json: PlanLimits
  rollover_from_previous_json: Partial<PlanLimits> | null
  extra_content_json: ExtraContentItem[]
  cambios_budget: number
  cambios_packages_json: CambiosPackage[]
  content_limits_override_json: Partial<Record<ContentType, number>> | null
}

export interface ReportRequirement {
  id: string
  content_type: ContentType
  title: string
  phase: Phase
  cambios_count: number
  voided: boolean
}

export interface ClientCycleReportProps {
  client: ReportClient
  cycle: ReportCycle
  requirements: ReportRequirement[]
  includeDetail: boolean
  generatedAt: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmtDate(d: string): string {
  const dt = new Date(d)
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`
}

function barColor(pct: number): string {
  if (pct >= 90) return '#b31b25'
  if (pct >= 70) return '#f59e0b'
  return '#00675c'
}

const PHASE_LABELS: Record<Phase, string> = {
  pendiente:           'Pendiente',
  proceso_edicion:     'Proceso de Edición',
  proceso_diseno:      'Proceso de Diseño',
  proceso_animacion:   'Proceso de Animación',
  cambios:             'Cambios',
  pausa:               'Pausa',
  revision_interna:    'Revisión Interna',
  revision_diseno:     'Revisión de Diseño',
  revision_cliente:    'Revisión Cliente',
  aprobado:            'Aprobado',
  pendiente_publicar:  'Pendiente de Publicar',
  publicado_entregado: 'Publicado / Entregado',
}

const PHASE_COLORS: Record<Phase, { bg: string; text: string }> = {
  pendiente:           { bg: '#f2f4f6', text: '#abadaf' },
  proceso_edicion:     { bg: '#e8f5f3', text: '#00675c' },
  proceso_diseno:      { bg: '#e0f5fb', text: '#0891b2' },
  proceso_animacion:   { bg: '#f3f0ff', text: '#7c3aed' },
  cambios:             { bg: '#fff4ed', text: '#ea580c' },
  pausa:               { bg: '#fffbeb', text: '#d97706' },
  revision_interna:    { bg: '#eef2ff', text: '#6366f1' },
  revision_diseno:     { bg: '#faf5ff', text: '#a855f7' },
  revision_cliente:    { bg: '#e8f0fb', text: '#3b6fd4' },
  aprobado:            { bg: '#f0f7e8', text: '#4a6319' },
  pendiente_publicar:  { bg: '#f7fee7', text: '#65a30d' },
  publicado_entregado: { bg: '#e8f5f3', text: '#00675c' },
}

const ROLLOVER_KEY: Record<ContentType, keyof PlanLimits> = {
  historia:    'historias',
  estatico:    'estaticos',
  video_corto: 'videos_cortos',
  reel:        'reels',
  short:       'shorts',
  produccion:  'producciones',
  reunion:     'reuniones',
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page:            { fontFamily: 'Helvetica', backgroundColor: '#ffffff', paddingHorizontal: 40, paddingVertical: 36, fontSize: 9, color: '#191c1e' },

  // Header
  headerRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e8ecef' },
  logoBox:         { backgroundColor: '#00675c', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4 },
  logoText:        { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 0.5 },
  clientName:      { fontFamily: 'Helvetica-Bold', fontSize: 18, color: '#191c1e', marginBottom: 4 },
  metaRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  metaText:        { fontSize: 8, color: '#5c5f61' },
  metaSep:         { fontSize: 8, color: '#bec9c5' },
  badgePaid:       { backgroundColor: '#a1f1e3', color: '#005047', fontSize: 7, fontFamily: 'Helvetica-Bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeUnpaid:     { backgroundColor: '#ffdad6', color: '#93000a', fontSize: 7, fontFamily: 'Helvetica-Bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  clientCircle:    { width: 44, height: 44, borderRadius: 22, backgroundColor: '#eceef0', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dfe3e6' },
  clientInitials:  { fontFamily: 'Helvetica-Bold', fontSize: 13, color: '#00675c' },

  // Section title
  sectionTitle:    { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#5c5f61', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10 },
  sectionLine:     { width: 16, height: 1, backgroundColor: '#00675c', marginRight: 6 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },

  // Cards
  cardsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  card:            { width: '48.5%', backgroundColor: '#f2f4f6', borderRadius: 8, padding: 12 },
  cardTopRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardLabel:       { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#191c1e' },
  cardBadges:      { flexDirection: 'row', gap: 3 },
  badgeRollover:   { backgroundColor: '#dcf0e6', color: '#2d6a4f', fontSize: 6, fontFamily: 'Helvetica-Bold', paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 3 },
  badgeExtra:      { backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: 6, fontFamily: 'Helvetica-Bold', paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 3 },
  cardCountRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginBottom: 6 },
  cardCount:       { fontFamily: 'Helvetica-Bold', fontSize: 20, color: '#191c1e' },
  cardLimit:       { fontSize: 10, color: '#747779' },
  barTrack:        { width: '100%', height: 4, backgroundColor: '#e1e3e5', borderRadius: 2, overflow: 'hidden', marginBottom: 5 },
  barFill:         { height: 4, borderRadius: 2 },
  cardAvailable:   { fontSize: 7.5, color: '#5c5f61' },

  // Cambios
  cambiosBox:      { backgroundColor: '#f2f4f6', borderRadius: 8, padding: 14, marginBottom: 20 },
  cambiosTopRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  cambiosTitle:    { fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#191c1e' },
  cambiosSubtitle: { fontSize: 7, color: '#5c5f61', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  cambiosUsed:     { fontFamily: 'Helvetica-Bold', fontSize: 14, color: '#00675c' },
  cambiosBarTrack: { width: '100%', height: 5, backgroundColor: '#e1e3e5', borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  cambiosDotRow:   { flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'center' },
  dotItem:         { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot:             { width: 5, height: 5, borderRadius: 2.5 },
  dotText:         { fontSize: 8, color: '#5c5f61' },
  cambiosAvail:    { marginLeft: 'auto', fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#5c5f61' },

  // Requirements detail
  groupHeader:     { backgroundColor: '#f2f4f6', paddingHorizontal: 10, paddingVertical: 5, marginBottom: 0, borderRadius: 0 },
  groupHeaderText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#5c5f61', letterSpacing: 1.2, textTransform: 'uppercase' },
  groupWrap:       { borderWidth: 1, borderColor: '#e8ecef', borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  reqRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f2f4f6', gap: 7 },
  reqBullet:       { width: 4, height: 4, borderRadius: 2, backgroundColor: '#00675c', flexShrink: 0 },
  reqTitle:        { flex: 1, fontSize: 8.5, color: '#191c1e' },
  phasePill:       { fontSize: 6.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8 },
  cambiosBadge:    { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#5c5f61', backgroundColor: '#eceef0', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },

  // Footer
  footer:          { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e8ecef' },
  footerText:      { fontSize: 7.5, color: '#5c5f61', letterSpacing: 0.5 },
  footerBrand:     { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#00675c', letterSpacing: 0.5 },
})

// ── Component ──────────────────────────────────────────────────────────────

export function ClientCycleReport({ client, cycle, requirements, includeDetail, generatedAt }: ClientCycleReportProps) {
  const snapshot = limitsToRecord(cycle.limits_snapshot_json)
  const overrides = cycle.content_limits_override_json as Partial<Record<ContentType, number>> | null

  const activeTypes = CONTENT_TYPES.filter((t) => {
    const base = overrides?.[t] ?? snapshot[t]
    return base > 0
  })

  const totals: Record<ContentType, number> = {
    historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0,
  }
  for (const r of requirements) {
    if (!r.voided) totals[r.content_type] = (totals[r.content_type] ?? 0) + 1
  }

  const packages = cycle.cambios_packages_json ?? []
  const pkgTotal = packages.reduce((s, p) => s + p.qty, 0)
  const planBase = client.plan.cambios_included
  const totalBudget = cycle.cambios_budget
  const cambiosUsed = requirements.filter(r => !r.voided).reduce((s, r) => s + r.cambios_count, 0)
  const cambiosAvail = Math.max(0, totalBudget - cambiosUsed)
  const cambiosPct = totalBudget > 0 ? Math.min(100, Math.round((cambiosUsed / totalBudget) * 100)) : 0

  // Initials for client circle
  const initials = client.name.split(' ').slice(0, 2).map(w => w[0]).join('')

  const reqsByType: Partial<Record<ContentType, ReportRequirement[]>> = {}
  for (const r of requirements) {
    if (r.voided) continue
    if (!reqsByType[r.content_type]) reqsByType[r.content_type] = []
    reqsByType[r.content_type]!.push(r)
  }

  const cycleStart = new Date(cycle.period_start)
  const cycleMonthFull = `${MONTHS_FULL[cycleStart.getMonth()]} ${cycleStart.getFullYear()}`

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View style={{ gap: 10 }}>
            <View style={s.logoBox}>
              <Text style={s.logoText}>FM</Text>
            </View>
            <View>
              <Text style={s.clientName}>{client.name}</Text>
              <View style={s.metaRow}>
                <Text style={s.metaText}>{fmtDate(cycle.period_start)} – {fmtDate(cycle.period_end)}</Text>
                <Text style={s.metaSep}>·</Text>
                <Text style={s.metaText}>Plan {client.plan.name} · ${client.plan.price_usd}/mes</Text>
                <Text style={s.metaSep}>·</Text>
                <Text style={cycle.payment_status === 'paid' ? s.badgePaid : s.badgeUnpaid}>
                  {cycle.payment_status === 'paid' ? '✓ Pagado' : 'Sin pago'}
                </Text>
              </View>
              {(client.contact_email || client.contact_phone || client.ig_handle) && (
                <View style={s.metaRow}>
                  {client.contact_email && <Text style={s.metaText}>{client.contact_email}</Text>}
                  {client.contact_email && client.contact_phone && <Text style={s.metaSep}>·</Text>}
                  {client.contact_phone && <Text style={s.metaText}>{client.contact_phone}</Text>}
                  {client.ig_handle && <Text style={s.metaSep}>·</Text>}
                  {client.ig_handle && <Text style={s.metaText}>{client.ig_handle}</Text>}
                </View>
              )}
            </View>
          </View>
          <View style={s.clientCircle}>
            <Text style={s.clientInitials}>{initials}</Text>
          </View>
        </View>

        {/* ── Resumen del ciclo ── */}
        <View style={s.sectionTitleRow}>
          <View style={s.sectionLine} />
          <Text style={s.sectionTitle}>Resumen del ciclo — {cycleMonthFull}</Text>
        </View>

        <View style={s.cardsGrid}>
          {activeTypes.map((type) => {
            const baseLimit = overrides?.[type] ?? snapshot[type]
            const rollKey = ROLLOVER_KEY[type]
            const rollover = (cycle.rollover_from_previous_json?.[rollKey] as number | undefined) ?? 0
            const extraSold = (cycle.extra_content_json ?? [])
              .filter(e => e.content_type === type)
              .reduce((sum, e) => sum + e.qty, 0)
            const effectiveTotal = baseLimit + rollover + extraSold
            const consumed = totals[type]
            const pct = effectiveTotal > 0 ? Math.min(100, Math.round((consumed / effectiveTotal) * 100)) : 0
            const available = Math.max(0, effectiveTotal - consumed)
            const color = barColor(pct)

            return (
              <View key={type} style={s.card}>
                <View style={s.cardTopRow}>
                  <Text style={s.cardLabel}>{CONTENT_TYPE_LABELS[type]}</Text>
                  <View style={s.cardBadges}>
                    {rollover > 0 && <Text style={s.badgeRollover}>+{rollover} rollover</Text>}
                    {extraSold > 0 && <Text style={s.badgeExtra}>+{extraSold} extra</Text>}
                  </View>
                </View>
                <View style={s.cardCountRow}>
                  <Text style={s.cardCount}>{consumed}</Text>
                  <Text style={s.cardLimit}> / {baseLimit}</Text>
                </View>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${pct}%`, backgroundColor: color }]} />
                </View>
                <Text style={s.cardAvailable}>{available} disponibles</Text>
              </View>
            )
          })}
        </View>

        {/* ── Cambios del ciclo ── */}
        <View style={s.cambiosBox}>
          <View style={s.cambiosTopRow}>
            <View>
              <Text style={s.cambiosSubtitle}>Control de ediciones</Text>
              <Text style={s.cambiosTitle}>Cambios del ciclo</Text>
            </View>
            <Text style={s.cambiosUsed}>{cambiosUsed} / {totalBudget} usados</Text>
          </View>
          <View style={s.cambiosBarTrack}>
            <View style={[s.barFill, { width: `${cambiosPct}%`, backgroundColor: barColor(cambiosPct), height: 5 }]} />
          </View>
          <View style={s.cambiosDotRow}>
            <View style={s.dotItem}>
              <View style={[s.dot, { backgroundColor: '#00675c' }]} />
              <Text style={s.dotText}>Plan: <Text style={{ fontFamily: 'Helvetica-Bold' }}>{planBase} incluidos</Text></Text>
            </View>
            {pkgTotal > 0 && (
              <View style={s.dotItem}>
                <View style={[s.dot, { backgroundColor: '#5bf4de' }]} />
                <Text style={s.dotText}>
                  Comprados: <Text style={{ fontFamily: 'Helvetica-Bold', color: '#00675c' }}>+{pkgTotal}</Text>
                  {packages[0]?.note ? <Text style={{ color: '#abadaf' }}> — {packages[0].note}</Text> : null}
                </Text>
              </View>
            )}
            <Text style={[s.cambiosAvail, { color: cambiosAvail === 0 ? '#b31b25' : '#5c5f61' }]}>
              {cambiosAvail} disponibles
            </Text>
          </View>
        </View>

        {/* ── Detalle de requerimientos ── */}
        {includeDetail && (
          <View>
            <View style={s.sectionTitleRow}>
              <View style={s.sectionLine} />
              <Text style={s.sectionTitle}>Detalle de requerimientos</Text>
            </View>

            {activeTypes.map((type) => {
              const items = reqsByType[type]
              if (!items || items.length === 0) return null
              return (
                <View key={type} style={s.groupWrap} wrap={false}>
                  <View style={s.groupHeader}>
                    <Text style={s.groupHeaderText}>{CONTENT_TYPE_LABELS[type]}</Text>
                  </View>
                  {items.map((req, i) => {
                    const phaseColors = PHASE_COLORS[req.phase]
                    return (
                      <View
                        key={req.id}
                        style={[s.reqRow, i === items.length - 1 ? { borderBottomWidth: 0 } : {}]}
                      >
                        <View style={s.reqBullet} />
                        <Text style={s.reqTitle}>{req.title}</Text>
                        <Text style={[s.phasePill, { backgroundColor: phaseColors.bg, color: phaseColors.text }]}>
                          {PHASE_LABELS[req.phase]}
                        </Text>
                        <Text style={s.cambiosBadge}>
                          {req.cambios_count} {req.cambios_count === 1 ? 'cambio' : 'cambios'}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              )
            })}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generado el {generatedAt}</Text>
          <Text style={s.footerBrand}>FM Communication Solutions</Text>
        </View>

      </Page>
    </Document>
  )
}
