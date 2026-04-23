'use client'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setActiveClient } from '@/app/actions/portalActiveClient'

interface Props {
  options: Array<{ id: string; name: string }>
  activeId: string
}

export function ActiveClientSwitcher({ options, activeId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <select
      className="w-full text-sm rounded-lg border border-fm-outline-variant/40 bg-white px-2 py-1.5"
      defaultValue={activeId}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value
        startTransition(async () => {
          await setActiveClient(next)
          router.refresh()
        })
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )
}
