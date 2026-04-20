import type { ReactElement } from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { formatDurationHMS } from '@/lib/domain/time'
import type { PrimaryGroup, SecondaryGroup, TimesheetEntry, TimesheetGroup } from '@/lib/domain/timesheet'

export interface TimesheetPdfReportProps {
  groups: TimesheetGroup[]
  totalSeconds: number
  primary: PrimaryGroup
  secondary: SecondaryGroup
  rangeStart: string
  rangeEnd: string
  generatedAt: string
}

const PRIMARY_LABELS: Record<PrimaryGroup, string> = {
  member: 'Miembro del equipo',
  client: 'Cliente',
}
const SECONDARY_LABELS: Record<SecondaryGroup, string> = {
  client: 'Cliente',
  member: 'Miembro del equipo',
  requirement: 'Requerimiento',
  entry: 'Entrada de tiempo',
}

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function fmtEntryWhen(iso: string): string {
  const d = new Date(iso)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`
}

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', backgroundColor: '#ffffff', paddingHorizontal: 40, paddingVertical: 36, fontSize: 9, color: '#191c1e' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e8ecef' },
  logoBox: { backgroundColor: '#00675c', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4 },
  logoText: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 0.5 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, color: '#191c1e', marginBottom: 4 },
  subtitle: { fontSize: 9, color: '#5c5f61', marginBottom: 2 },
  filtersRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 16 },
  filterChip: { backgroundColor: '#f2f4f6', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, fontSize: 7.5, color: '#5c5f61' },

  // Tree
  groupRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#e8ecef', alignItems: 'center', gap: 6 },
  groupRow1: { backgroundColor: '#f8f9fa' },
  groupRow2: { backgroundColor: '#ffffff' },
  entryRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#f2f4f6', alignItems: 'center', gap: 6 },
  colTitle: { flex: 1 },
  colDur: { width: 60, textAlign: 'right' },
  colPct: { width: 45, textAlign: 'right' },
  textBold: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#191c1e' },
  text: { fontSize: 8.5, color: '#2c2f31' },
  textMeta: { fontSize: 7, color: '#abadaf' },
  textNotes: { fontSize: 7.5, color: '#5c5f61', marginTop: 1, marginBottom: 1 },

  // Header row
  theadRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#dfe3e6', backgroundColor: '#f5f7f9' },
  thead: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#5c5f61', letterSpacing: 1 },

  // Footer
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e8ecef', position: 'absolute', bottom: 24, left: 40, right: 40 },
  footerText: { fontSize: 7.5, color: '#5c5f61', letterSpacing: 0.5 },
  footerBrand: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#00675c', letterSpacing: 0.5 },

  totalRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#dfe3e6', backgroundColor: '#f5f7f9' },
})

function GroupRow({ group, depth }: { group: TimesheetGroup; depth: number }) {
  const rowStyle = depth === 0 ? [s.groupRow, s.groupRow1] : [s.groupRow, s.groupRow2]
  return (
    <View style={rowStyle}>
      <Text style={[s.colTitle, depth === 0 ? s.textBold : s.text, { paddingLeft: depth * 10 }]}>
        {depth === 0 ? '▸ ' : '· '}{group.label}
      </Text>
      <Text style={[s.colDur, s.textBold]}>{formatDurationHMS(group.durationSeconds)}</Text>
      <Text style={[s.colPct, s.text]}>{group.percentage.toFixed(1)}%</Text>
    </View>
  )
}

function EntryRowView({ entry, depth }: { entry: TimesheetEntry; depth: number }) {
  const label = entry.entry_type === 'administrative'
    ? (entry.category ? entry.category : 'Administrativo')
    : (entry.requirement_title || entry.title || '—')
  const contextLabel = entry.entry_type === 'administrative'
    ? 'Interno FM'
    : entry.client_name
  const hasNotes = !!entry.notes && entry.notes.trim().length > 0
  return (
    <View style={s.entryRow}>
      <View style={[s.colTitle, { paddingLeft: depth * 10 }]}>
        <Text style={s.text}>{label}</Text>
        {hasNotes && (
          <Text style={s.textNotes}>{entry.notes}</Text>
        )}
        <Text style={s.textMeta}>
          {fmtEntryWhen(entry.started_at)} · {entry.user_name}
          {contextLabel ? ` · ${contextLabel}` : ''}
        </Text>
      </View>
      <Text style={[s.colDur, s.text]}>{formatDurationHMS(entry.duration_seconds)}</Text>
      <Text style={[s.colPct, s.textMeta]}></Text>
    </View>
  )
}

function renderGroupNode(group: TimesheetGroup, depth: number, totalSeconds: number): ReactElement[] {
  const nodes: ReactElement[] = []
  nodes.push(<GroupRow key={`g-${group.key}`} group={group} depth={depth} />)
  if (group.children.length === 0) return nodes
  const firstChild = group.children[0] as TimesheetGroup | TimesheetEntry
  const isSubGroup = 'percentage' in firstChild && Array.isArray((firstChild as TimesheetGroup).children)
  if (isSubGroup) {
    for (const sub of group.children as TimesheetGroup[]) {
      nodes.push(...renderGroupNode(sub, depth + 1, totalSeconds))
    }
  } else {
    for (const entry of group.children as TimesheetEntry[]) {
      nodes.push(<EntryRowView key={`e-${entry.id}`} entry={entry} depth={depth + 1} />)
    }
  }
  return nodes
}

export function TimesheetPdfReport({
  groups,
  totalSeconds,
  primary,
  secondary,
  rangeStart,
  rangeEnd,
  generatedAt,
}: TimesheetPdfReportProps) {
  const endDisplay = new Date(new Date(rangeEnd).getTime() - 24 * 3600 * 1000).toISOString()
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <View style={[s.logoBox, { alignSelf: 'flex-start', marginBottom: 8 }]}>
              <Text style={s.logoText}>FM</Text>
            </View>
            <Text style={s.title}>Informe de hojas de tiempo</Text>
            <Text style={s.subtitle}>{fmtDate(rangeStart)} — {fmtDate(endDisplay)}</Text>
            <Text style={s.subtitle}>
              Agrupado por {PRIMARY_LABELS[primary]} · {SECONDARY_LABELS[secondary]}
            </Text>
          </View>
          <View>
            <Text style={[s.textBold, { textAlign: 'right' }]}>Total</Text>
            <Text style={[s.title, { textAlign: 'right', color: '#00675c' }]}>
              {formatDurationHMS(totalSeconds)}
            </Text>
          </View>
        </View>

        <View style={s.theadRow}>
          <Text style={[s.colTitle, s.thead]}>TÍTULO</Text>
          <Text style={[s.colDur, s.thead]}>DURACIÓN</Text>
          <Text style={[s.colPct, s.thead]}>%</Text>
        </View>

        {groups.length === 0 ? (
          <View style={{ padding: 20 }}>
            <Text style={s.text}>Sin entradas en el rango seleccionado.</Text>
          </View>
        ) : (
          groups.flatMap((g) => renderGroupNode(g, 0, totalSeconds))
        )}

        <View style={s.totalRow}>
          <Text style={[s.colTitle, s.textBold]}>Total</Text>
          <Text style={[s.colDur, s.textBold]}>{formatDurationHMS(totalSeconds)}</Text>
          <Text style={[s.colPct, s.textBold]}>100.0%</Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{generatedAt}</Text>
          <Text style={s.footerBrand}>FM Communication Solutions</Text>
        </View>
      </Page>
    </Document>
  )
}
