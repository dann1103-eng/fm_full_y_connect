import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type JSXElementConstructor, type ReactElement } from 'react'
import { fetchTimesheetEntries } from '@/app/actions/fetchTimesheet'
import { buildTimesheetTree, type PrimaryGroup, type SecondaryGroup, type EntryTypeFilter } from '@/lib/domain/timesheet'
import { TimesheetPdfReport } from '@/components/reports/TimesheetPdfReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start/end' }, { status: 400 })
  }

  const primary = (sp.get('primary') ?? 'member') as PrimaryGroup
  const secondary = (sp.get('secondary') ?? 'client') as SecondaryGroup
  const entryType = (sp.get('entryType') ?? 'all') as EntryTypeFilter
  const userIds = sp.getAll('userIds').filter(Boolean)
  const clientIds = sp.getAll('clientIds').filter(Boolean)

  const res = await fetchTimesheetEntries({
    startIso: start,
    endIso: end,
    userIds: userIds.length > 0 ? userIds : undefined,
    clientIds: clientIds.length > 0 ? clientIds : undefined,
    entryType,
  })
  if (res.error || !res.entries) {
    return NextResponse.json({ error: res.error ?? 'Error' }, { status: 403 })
  }

  const { groups, totalSeconds } = buildTimesheetTree(res.entries, primary, secondary)

  const generatedAt = new Date().toLocaleDateString('es-SV', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const element = createElement(TimesheetPdfReport, {
    groups,
    totalSeconds,
    primary,
    secondary,
    rangeStart: start,
    rangeEnd: end,
    generatedAt,
  }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  const startShort = start.slice(0, 10)
  const endShort = end.slice(0, 10)
  const filename = `hojas-de-tiempo_${startShort}_${endShort}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
