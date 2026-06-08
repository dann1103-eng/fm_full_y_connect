'use client'

import { useState } from 'react'
import { WaBotConfigForm } from './WaBotConfigForm'
import { cn } from '@/lib/utils'
import type { WaBotConfig } from '@/types/db'

interface Props {
  clientConfig: WaBotConfig
  leadConfig: WaBotConfig
}

export function WaBotConfigTabs({ clientConfig, leadConfig }: Props) {
  const [audience, setAudience] = useState<'client' | 'lead'>('client')
  const current = audience === 'client' ? clientConfig : leadConfig

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-fm-outline-variant/40 overflow-hidden">
        <TabButton active={audience === 'client'} onClick={() => setAudience('client')}>
          Clientes (con marca vinculada)
        </TabButton>
        <TabButton active={audience === 'lead'} onClick={() => setAudience('lead')}>
          Leads / prospectos
        </TabButton>
      </div>

      <p className="text-xs text-fm-on-surface-variant">
        {audience === 'client'
          ? 'Esta config se usa cuando la conversación está vinculada a un cliente del CRM.'
          : 'Esta config se usa cuando alguien escribe y AÚN no tiene marca vinculada (prospecto).'}
      </p>

      <WaBotConfigForm key={audience} config={current} />
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm transition',
        active
          ? 'bg-fm-primary text-white'
          : 'bg-fm-surface text-fm-on-surface hover:bg-fm-surface-container-low',
      )}
    >
      {children}
    </button>
  )
}
