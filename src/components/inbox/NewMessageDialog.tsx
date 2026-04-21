'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { cn } from '@/lib/utils'
import { createOrGetDM, createChannel } from '@/app/actions/inbox'
import type { AppUser } from '@/types/db'

interface NewMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canCreateChannels: boolean
  allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
}

type Tab = 'dm' | 'channel'

export function NewMessageDialog({ open, onOpenChange, canCreateChannels, allUsers }: NewMessageDialogProps) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('dm')
  const [query, setQuery] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [channelName, setChannelName] = useState('')
  const [channelDescription, setChannelDescription] = useState('')
  const [channelTopic, setChannelTopic] = useState('')
  const [channelMemberIds, setChannelMemberIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allUsers
    return allUsers.filter((u) => u.full_name?.toLowerCase().includes(q))
  }, [allUsers, query])

  function reset() {
    setQuery('')
    setSelectedUserId(null)
    setChannelName('')
    setChannelDescription('')
    setChannelTopic('')
    setChannelMemberIds([])
    setError(null)
  }

  function onClose(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  function submitDM() {
    if (!selectedUserId) {
      setError('Selecciona un usuario.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createOrGetDM(selectedUserId)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      if ('conversationId' in res && res.conversationId) {
        onClose(false)
        router.push(`/inbox/${res.conversationId}`)
      }
    })
  }

  function submitChannel() {
    if (!channelName.trim()) {
      setError('El nombre del canal es obligatorio.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createChannel({
        name: channelName,
        description: channelDescription,
        topic: channelTopic,
        memberIds: channelMemberIds,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      if ('conversationId' in res && res.conversationId) {
        onClose(false)
        router.push(`/inbox/${res.conversationId}`)
      }
    })
  }

  function toggleChannelMember(id: string) {
    setChannelMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo mensaje</DialogTitle>
        </DialogHeader>

        {canCreateChannels && (
          <div className="flex border border-[#dfe3e6] rounded-lg p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setTab('dm')}
              className={cn(
                'flex-1 py-1.5 rounded-md font-medium transition-colors',
                tab === 'dm' ? 'bg-[#00675c] text-white' : 'text-[#595c5e] hover:bg-[#f5f7f9]'
              )}
            >
              Mensaje directo
            </button>
            <button
              type="button"
              onClick={() => setTab('channel')}
              className={cn(
                'flex-1 py-1.5 rounded-md font-medium transition-colors',
                tab === 'channel' ? 'bg-[#00675c] text-white' : 'text-[#595c5e] hover:bg-[#f5f7f9]'
              )}
            >
              Canal
            </button>
          </div>
        )}

        {tab === 'dm' ? (
          <div className="space-y-3">
            <Input
              placeholder="Buscar usuario por nombre..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto border border-[#dfe3e6] rounded-lg divide-y divide-[#dfe3e6]">
              {filtered.length === 0 && (
                <div className="p-4 text-sm text-[#595c5e]/70 text-center">Sin resultados</div>
              )}
              {filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f5f7f9] transition-colors',
                    selectedUserId === u.id && 'bg-[#00675c]/10'
                  )}
                >
                  <UserAvatar name={u.full_name ?? '?'} avatarUrl={u.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#2c2f31] truncate">{u.full_name}</div>
                    <div className="text-xs text-[#595c5e]/70 capitalize">{u.role}</div>
                  </div>
                </button>
              ))}
            </div>
            {error && <div className="text-xs text-[#b31b25]">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submitDM} disabled={pending || !selectedUserId}>
                {pending ? 'Creando...' : 'Iniciar conversación'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wider">Nombre</label>
              <Input
                placeholder="ej: marketing"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
              <p className="text-[10px] text-[#595c5e]/70 mt-1">Solo letras, números y guiones.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wider">Tema</label>
              <Input
                placeholder="ej: Estrategia Q4"
                value={channelTopic}
                onChange={(e) => setChannelTopic(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wider">Descripción</label>
              <Input
                placeholder="Opcional"
                value={channelDescription}
                onChange={(e) => setChannelDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wider">Miembros</label>
              <div className="max-h-40 overflow-y-auto border border-[#dfe3e6] rounded-lg mt-1 divide-y divide-[#dfe3e6]">
                {allUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#f5f7f9] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={channelMemberIds.includes(u.id)}
                      onChange={() => toggleChannelMember(u.id)}
                      className="accent-[#00675c]"
                    />
                    <UserAvatar name={u.full_name ?? '?'} avatarUrl={u.avatar_url} size="xs" />
                    <span className="text-sm text-[#2c2f31]">{u.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
            {error && <div className="text-xs text-[#b31b25]">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submitChannel} disabled={pending || !channelName.trim()}>
                {pending ? 'Creando...' : 'Crear canal'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
