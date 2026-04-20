'use client'

import { useState } from 'react'
import type { Plan } from '@/types/db'
import { PlanForm } from './PlanForm'

interface PlansManagerProps {
  isAdmin: boolean
}

/**
 * Barra de acciones cliente que abre el modal de crear/editar plan.
 * Los botones "Editar" por fila viven en PlanCardActions.
 */
export function PlansManager({ isAdmin }: PlansManagerProps) {
  const [creating, setCreating] = useState(false)

  if (!isAdmin) return null

  return (
    <>
      <button
        onClick={() => setCreating(true)}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm"
      >
        <span className="material-symbols-outlined text-base">add</span>
        Crear plan
      </button>
      {creating && <PlanForm onClose={() => setCreating(false)} />}
    </>
  )
}

/** Botón "Editar" por plan — se usa dentro de la grid server-rendered. */
export function PlanEditButton({ plan }: { plan: Plan }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <button
        onClick={() => setEditing(true)}
        className="text-xs font-semibold text-[#00675c] hover:underline"
      >
        Editar plan
      </button>
      {editing && <PlanForm plan={plan} onClose={() => setEditing(false)} />}
    </>
  )
}
