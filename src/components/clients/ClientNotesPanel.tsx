'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface ClientNotesPanelProps {
  clientId: string
  initialNotes: string | null
}

export function ClientNotesPanel({ clientId, initialNotes }: ClientNotesPanelProps) {
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleSave() {
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('clients')
      .update({ notes: notes || null })
      .eq('id', clientId)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="glass-panel p-6 rounded-[2rem] flex flex-col" style={{ minHeight: '340px' }}>
      <textarea
        className="flex-1 w-full bg-transparent border border-[#abadaf]/30 rounded-2xl p-4 text-sm text-[#2c2f31] placeholder:text-[#747779]/50 resize-none outline-none transition-all focus:border-[#00675c]/50 focus:ring-2 focus:ring-[#5bf4de]/40"
        rows={8}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas internas sobre el cliente..."
      />
      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 text-white font-bold rounded-full shadow-lg hover:scale-[1.02] transition-transform active:scale-95 text-sm disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
            boxShadow: '0 4px 15px rgba(0,103,92,0.2)',
          }}
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
