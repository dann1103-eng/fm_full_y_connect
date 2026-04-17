'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface Plan {
  id: string
  name: string
}

interface DashboardFiltersProps {
  plans: Plan[]
}

export function DashboardFilters({ plans }: DashboardFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#747779]">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
        </span>
        <input
          type="text"
          placeholder="Buscar cliente..."
          defaultValue={searchParams.get('q') ?? ''}
          onChange={(e) => updateParam('q', e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#dfe3e6] rounded-xl text-[#2c2f31] placeholder-[#abadaf] focus:outline-none focus:border-[#00675c] focus:ring-2 focus:ring-[#00675c]/10"
        />
      </div>

      {/* Plan filter */}
      <select
        defaultValue={searchParams.get('plan') ?? ''}
        onChange={(e) => updateParam('plan', e.target.value)}
        className="py-2 px-3 text-sm bg-white border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c] focus:ring-2 focus:ring-[#00675c]/10"
      >
        <option value="">Todos los planes</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Status filter */}
      <select
        defaultValue={searchParams.get('status') ?? ''}
        onChange={(e) => updateParam('status', e.target.value)}
        className="py-2 px-3 text-sm bg-white border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c] focus:ring-2 focus:ring-[#00675c]/10"
      >
        <option value="">Todos los estados</option>
        <option value="active">Activos</option>
        <option value="overdue">Morosos</option>
        <option value="paused">Pausados</option>
      </select>
    </div>
  )
}
