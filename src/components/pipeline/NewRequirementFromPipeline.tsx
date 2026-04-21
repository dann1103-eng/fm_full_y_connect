'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RequirementModal } from '@/components/clients/RequirementModal'
import { CONTENT_TYPES, limitsToRecord, effectiveLimits } from '@/lib/domain/plans'
import type { ClientWithPlan, BillingCycle, ContentType } from '@/types/db'

interface Props {
  clients: { id: string; name: string }[]
  isAdmin: boolean
  canAssign: boolean
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function emptyTotals(): Record<ContentType, number> {
  return Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<ContentType, number>
}

export function NewRequirementFromPipeline({ clients, isAdmin, canAssign }: Props) {
  const [step, setStep] = useState<'closed' | 'pick' | 'form'>('closed')
  const [search, setSearch] = useState('')
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [clientData, setClientData] = useState<ClientWithPlan | null>(null)
  const [cycle, setCycle] = useState<BillingCycle | null>(null)
  const [totals, setTotals] = useState<Record<ContentType, number>>(emptyTotals())
  const [limits, setLimits] = useState<Record<ContentType, number>>(emptyTotals())
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; full_name: string; default_assignee?: boolean }[]>([])

  const q = search.trim().toLowerCase()
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients

  const selectClient = useCallback(async (clientId: string) => {
    setLoadState('loading')
    setStep('form')
    const supabase = createClient()

    const [{ data: cl }, { data: cy }, { data: users }] = await Promise.all([
      supabase.from('clients').select('*, plan:plans(*)').eq('id', clientId).single(),
      supabase.from('billing_cycles').select('*').eq('client_id', clientId).eq('status', 'current').single(),
      canAssign
        ? supabase.from('users').select('id, full_name, default_assignee').order('full_name')
        : Promise.resolve({ data: [] }),
    ])

    if (!cl || !cy) {
      setLoadState('error')
      return
    }

    const { data: reqs } = await supabase
      .from('requirements')
      .select('content_type, includes_story')
      .eq('billing_cycle_id', cy.id)
      .eq('voided', false)

    const t = emptyTotals()
    for (const r of reqs ?? []) {
      t[r.content_type as ContentType] = (t[r.content_type as ContentType] ?? 0) + 1
      if (r.includes_story) t.historia = (t.historia ?? 0) + 1
    }

    const lim = effectiveLimits(
      cy.limits_snapshot_json,
      cy.rollover_from_previous_json as Parameters<typeof effectiveLimits>[1],
    )

    setClientData(cl as ClientWithPlan)
    setCycle(cy as BillingCycle)
    setTotals(t)
    setLimits(lim)
    setAssignableUsers(
      (users ?? []).map((u) => ({ id: u.id, full_name: u.full_name, default_assignee: u.default_assignee ?? false }))
    )
    setLoadState('ready')
  }, [canAssign])

  function close() {
    setStep('closed')
    setSearch('')
    setLoadState('idle')
    setClientData(null)
    setCycle(null)
  }

  return (
    <>
      <button
        onClick={() => setStep('pick')}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#00675c] text-white text-sm font-semibold rounded-xl hover:bg-[#005047] transition-colors"
      >
        <span className="material-symbols-outlined text-base">add</span>
        Nuevo requerimiento
      </button>

      {/* Step 1 — Client picker */}
      {step === 'pick' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-[#f0f3f5]">
              <h3 className="text-base font-extrabold text-[#2c2f31]">¿Para qué cliente?</h3>
              <p className="text-xs text-[#595c5e] mt-0.5">Selecciona el cliente antes de registrar el requerimiento.</p>
            </div>

            <div className="px-4 pt-4 pb-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#abadaf] text-base pointer-events-none">search</span>
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#dfe3e6] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5bf4de]/30 text-[#2c2f31] placeholder:text-[#abadaf]"
                />
              </div>
            </div>

            <ul className="max-h-64 overflow-y-auto px-4 pb-4 space-y-1">
              {filtered.length === 0 && (
                <li className="text-xs text-[#abadaf] text-center py-6">Sin resultados</li>
              )}
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { setSearch(''); selectClient(c.id) }}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-[#2c2f31] hover:bg-[#f5f7f9] transition-colors"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>

            <div className="px-6 pb-5">
              <button onClick={close} className="w-full py-2 text-sm text-[#595c5e] border border-[#dfe3e6] rounded-full hover:bg-[#f5f7f9]">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay while fetching client data */}
      {step === 'form' && loadState === 'loading' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 flex items-center gap-3 shadow-xl">
            <span className="material-symbols-outlined animate-spin text-[#00675c]">progress_activity</span>
            <span className="text-sm font-medium text-[#2c2f31]">Cargando datos del cliente…</span>
          </div>
        </div>
      )}

      {step === 'form' && loadState === 'error' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl space-y-3 max-w-xs w-full text-center">
            <span className="material-symbols-outlined text-[#b31b25] text-3xl">error</span>
            <p className="text-sm text-[#2c2f31]">No se encontró un ciclo activo para este cliente.</p>
            <button onClick={close} className="w-full py-2 text-sm border border-[#dfe3e6] rounded-full hover:bg-[#f5f7f9]">Cerrar</button>
          </div>
        </div>
      )}

      {/* Step 2 — Requirement form via RequirementModal */}
      {step === 'form' && loadState === 'ready' && clientData && cycle && (
        <RequirementModal
          open
          onClose={close}
          client={clientData}
          cycle={cycle}
          totals={totals}
          limits={limits}
          isAdmin={isAdmin}
          canAssign={canAssign}
          assignableUsers={assignableUsers}
        />
      )}
    </>
  )
}
