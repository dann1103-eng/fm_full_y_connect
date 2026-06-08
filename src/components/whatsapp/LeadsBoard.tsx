'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import {
  assignLead,
  convertLeadToClient,
  updateLeadStatus,
  type WaLeadStatus,
} from '@/app/actions/waLeads'
import type { LeadRow, PlanOption, UserOption } from '@/app/(app)/leads/page'

interface Props {
  leads: LeadRow[]
  plans: PlanOption[]
  users: UserOption[]
  currentUserId: string
}

const STATUS_LABELS: Record<WaLeadStatus, string> = {
  active: 'Activo',
  escalated: 'Escalado',
  converted: 'Convertido',
  rejected: 'Descartado',
  archived: 'Archivado',
}

const STATUS_COLORS: Record<WaLeadStatus, string> = {
  active: 'bg-blue-100 text-blue-700',
  escalated: 'bg-amber-100 text-amber-700',
  converted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-700',
}

export function LeadsBoard({ leads, plans, users }: Props) {
  const [statusFilter, setStatusFilter] = useState<WaLeadStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [convertingLead, setConvertingLead] = useState<LeadRow | null>(null)
  const [rejectingLead, setRejectingLead] = useState<LeadRow | null>(null)

  const filtered = useMemo(() => {
    let r = leads
    if (statusFilter !== 'all') r = r.filter((l) => l.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter(
        (l) =>
          (l.company_name && l.company_name.toLowerCase().includes(q)) ||
          (l.contact_name && l.contact_name.toLowerCase().includes(q)) ||
          (l.interest && l.interest.toLowerCase().includes(q)) ||
          l.phone_e164.includes(q),
      )
    }
    return r
  }, [leads, statusFilter, search])

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por empresa, contacto, interés o número…"
          className="flex-1 px-3 py-2 text-sm rounded-md bg-fm-surface border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
        />
        <div className="flex gap-1 flex-wrap">
          {(['all', 'active', 'escalated', 'converted', 'rejected', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md border transition',
                statusFilter === s
                  ? 'bg-fm-primary text-white border-fm-primary'
                  : 'bg-fm-surface border-fm-outline-variant/40 text-fm-on-surface hover:bg-fm-surface-container-low',
              )}
            >
              {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <ExportCsvButton leads={filtered} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-fm-on-surface-variant text-sm">
          {search || statusFilter !== 'all'
            ? 'No hay leads que coincidan con esos filtros.'
            : 'Aún no hay leads. Cuando un prospecto escriba al WhatsApp y el bot recopile sus datos, aparecerá aquí.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-fm-outline-variant/30 bg-fm-surface">
          <table className="w-full text-sm">
            <thead className="bg-fm-surface-container-low text-xs uppercase tracking-wide text-fm-on-surface-variant">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Empresa / Contacto</th>
                <th className="text-left px-4 py-3 font-medium">Interés</th>
                <th className="text-left px-4 py-3 font-medium">Presupuesto</th>
                <th className="text-left px-4 py-3 font-medium">Urgencia</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="text-left px-4 py-3 font-medium">Asignado</th>
                <th className="text-left px-4 py-3 font-medium">Fecha</th>
                <th className="text-right px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fm-outline-variant/30">
              {filtered.map((l) => (
                <LeadRowItem
                  key={l.id}
                  lead={l}
                  users={users}
                  onConvert={() => setConvertingLead(l)}
                  onReject={() => setRejectingLead(l)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {convertingLead && (
        <ConvertDialog
          lead={convertingLead}
          plans={plans}
          onClose={() => setConvertingLead(null)}
        />
      )}
      {rejectingLead && (
        <RejectDialog lead={rejectingLead} onClose={() => setRejectingLead(null)} />
      )}
    </section>
  )
}

function LeadRowItem({
  lead,
  users,
  onConvert,
  onReject,
}: {
  lead: LeadRow
  users: UserOption[]
  onConvert: () => void
  onReject: () => void
}) {
  const [pending, startTransition] = useTransition()
  const assignedUser = users.find((u) => u.id === lead.assigned_to_user_id)

  function setStatus(status: WaLeadStatus) {
    startTransition(async () => {
      await updateLeadStatus({ leadId: lead.id, status })
    })
  }

  function assign(userId: string) {
    startTransition(async () => {
      await assignLead({ leadId: lead.id, userId: userId || null })
    })
  }

  return (
    <tr className="hover:bg-fm-surface-container-low/50">
      <td className="px-4 py-3">
        <div className="font-medium text-fm-on-surface">
          {lead.company_name ?? <span className="text-fm-on-surface-variant italic">Sin empresa</span>}
        </div>
        <div className="text-xs text-fm-on-surface-variant">
          {lead.contact_name && <span>{lead.contact_name} · </span>}
          {lead.phone_e164}
        </div>
      </td>
      <td className="px-4 py-3 max-w-[200px]">
        <div className="text-xs text-fm-on-surface line-clamp-2">{lead.interest ?? '—'}</div>
        {lead.notes && (
          <div className="text-[11px] text-fm-on-surface-variant line-clamp-1 mt-0.5" title={lead.notes}>
            📝 {lead.notes}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-fm-on-surface">{lead.budget_range ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-fm-on-surface">{lead.urgency ?? '—'}</td>
      <td className="px-4 py-3">
        <span
          className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[lead.status])}
        >
          {STATUS_LABELS[lead.status]}
        </span>
      </td>
      <td className="px-4 py-3">
        <select
          value={lead.assigned_to_user_id ?? ''}
          onChange={(e) => assign(e.target.value)}
          disabled={pending}
          className="text-xs border border-fm-outline-variant/40 rounded-md px-1.5 py-1 bg-fm-surface-container-low"
        >
          <option value="">— Sin asignar —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-xs text-fm-on-surface-variant whitespace-nowrap">
        {new Date(lead.created_at).toLocaleDateString('es-SV', {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
        })}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 flex-wrap">
          <Link
            href={`/whatsapp/${lead.conversation_id}`}
            prefetch={false}
            className="text-xs px-2 py-1 rounded border border-fm-outline-variant/40 text-fm-on-surface hover:bg-fm-surface-container-low"
          >
            Chat
          </Link>
          {lead.status !== 'converted' && lead.status !== 'rejected' && (
            <button
              type="button"
              onClick={onConvert}
              disabled={pending}
              className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50"
            >
              Convertir
            </button>
          )}
          {lead.status === 'active' && (
            <button
              type="button"
              onClick={() => setStatus('escalated')}
              disabled={pending}
              className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Escalar
            </button>
          )}
          {lead.status !== 'rejected' && lead.status !== 'converted' && (
            <button
              type="button"
              onClick={onReject}
              disabled={pending}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Descartar
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function ConvertDialog({
  lead,
  plans,
  onClose,
}: {
  lead: LeadRow
  plans: PlanOption[]
  onClose: () => void
}) {
  const [clientName, setClientName] = useState(lead.company_name ?? lead.contact_name ?? '')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [billingDay, setBillingDay] = useState(1)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await convertLeadToClient({
        leadId: lead.id,
        clientName,
        planId,
        billingDay,
        startDate,
      })
      if (!res.ok) setError(res.error)
      else {
        onClose()
        window.location.href = `/clients/${res.clientId}/edit`
      }
    })
  }

  return (
    <DialogShell onClose={onClose} title="Convertir lead a cliente">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre del cliente">
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          />
        </Field>
        <Field label="Plan inicial">
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
          >
            <option value="" disabled>Selecciona un plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Día de facturación">
            <input
              type="number"
              min={1}
              max={28}
              value={billingDay}
              onChange={(e) => setBillingDay(Number(e.target.value))}
              required
              className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
            />
          </Field>
          <Field label="Fecha de inicio">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
            />
          </Field>
        </div>
        <p className="text-xs text-fm-on-surface-variant">
          Se creará un cliente con datos mínimos, se vinculará esta conversación de WhatsApp y se registrará
          el número como contacto primario. Después te llevamos a la pantalla de edición para que completes
          el resto (datos fiscales, redes, etc.).
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-fm-outline-variant/40">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="px-4 py-2 text-sm rounded-md bg-fm-primary text-white disabled:opacity-50">
            {pending ? 'Creando…' : 'Crear cliente'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function RejectDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      await updateLeadStatus({ leadId: lead.id, status: 'rejected', rejectedReason: reason })
      onClose()
    })
  }

  return (
    <DialogShell onClose={onClose} title="Descartar lead">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-fm-on-surface-variant">
          ¿Por qué se descarta este lead? (opcional, sirve para reportes y aprendizaje del equipo)
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Ej: presupuesto muy bajo / fuera de alcance / no respondió"
          className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-fm-outline-variant/40">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="px-4 py-2 text-sm rounded-md bg-red-600 text-white disabled:opacity-50">
            {pending ? 'Descartando…' : 'Descartar'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function DialogShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-fm-surface w-full sm:max-w-md max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between p-4 border-b border-fm-outline-variant/30">
          <h2 className="font-medium text-fm-on-surface">{title}</h2>
          <button onClick={onClose} className="text-fm-on-surface-variant hover:text-fm-on-surface text-lg">×</button>
        </header>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-fm-on-surface-variant mb-1">{label}</label>
      {children}
    </div>
  )
}

function ExportCsvButton({ leads }: { leads: LeadRow[] }) {
  function exportCsv() {
    const header = [
      'created_at', 'phone', 'company', 'contact', 'interest', 'budget',
      'urgency', 'notes', 'status', 'converted_at',
    ]
    const rows = leads.map((l) => [
      l.created_at, l.phone_e164, l.company_name ?? '', l.contact_name ?? '',
      l.interest ?? '', l.budget_range ?? '', l.urgency ?? '', l.notes ?? '',
      l.status, l.converted_at ?? '',
    ])
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wa-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button
      type="button"
      onClick={exportCsv}
      className="px-3 py-1.5 text-xs rounded-md border border-fm-outline-variant/40 bg-fm-surface hover:bg-fm-surface-container-low"
    >
      Exportar CSV
    </button>
  )
}
