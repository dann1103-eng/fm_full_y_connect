'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { cn } from '@/lib/utils'
import { shareRequirementToConversation, shareRequirementToUser } from '@/app/actions/inbox'
import { useInboxList } from '@/hooks/useInboxPolling'
import { createClient } from '@/lib/supabase/client'
import type { ConversationListItem } from '@/types/db'

interface ShareRequirementDialogProps {
  requirementId: string
  requirementTitle: string
  trigger: React.ReactNode
}

export function ShareRequirementDialog({
  requirementId,
  requirementTitle,
  trigger,
}: ShareRequirementDialogProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  function buildUrl(): string {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/pipeline?req=${requirementId}`
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    } finally {
      setMenuOpen(false)
    }
  }

  return (
    <>
      <div className="relative inline-block">
        <button type="button" onClick={() => setMenuOpen((v) => !v)} className="contents">
          {trigger}
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-fm-surface-container-lowest rounded-lg shadow-lg ring-1 ring-black/10 overflow-hidden">
              <button
                type="button"
                onClick={handleCopy}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fm-on-surface hover:bg-fm-background"
              >
                <span className="material-symbols-outlined text-[18px] text-fm-primary">link</span>
                {copied ? '¡Enlace copiado!' : 'Copiar enlace'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setSendOpen(true)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fm-on-surface hover:bg-fm-background"
              >
                <span className="material-symbols-outlined text-[18px] text-fm-primary">send</span>
                Enviar por Inbox
              </button>
            </div>
          </>
        )}
      </div>

      <SendToInboxDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        requirementId={requirementId}
        requirementTitle={requirementTitle}
      />
    </>
  )
}

interface SendToInboxDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  requirementId: string
  requirementTitle: string
}

type UserRow = {
  id: string
  full_name: string
  avatar_url: string | null
  role: string
}

function SendToInboxDialog({
  open,
  onOpenChange,
  requirementId,
  requirementTitle,
}: SendToInboxDialogProps) {
  const { data: conversations } = useInboxList([])
  const [activeTab, setActiveTab] = useState<'channels' | 'users'>('channels')
  const [query, setQuery] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()
  const [users, setUsers] = useState<UserRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
    supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .in('role', ['admin', 'supervisor', 'operator'])
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (data) setUsers(data as UserRow[])
      })
  }, [open])

  function resetAndClose() {
    setQuery('')
    setSelectedChannelId(null)
    setSelectedUserId(null)
    setError(null)
    setSent(false)
    setActiveTab('channels')
    onOpenChange(false)
  }

  const channels = useMemo(
    () => conversations.filter((c) => c.type === 'channel'),
    [conversations],
  )

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels.filter((c) => !q || (c.name ?? '').toLowerCase().includes(q))
  }, [channels, query])

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => u.id !== currentUserId)
      .filter((u) => !q || u.full_name.toLowerCase().includes(q))
      .sort((a, b) => a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()))
  }, [users, currentUserId, query])

  const canSubmit = activeTab === 'channels' ? !!selectedChannelId : !!selectedUserId

  function submit() {
    if (!canSubmit) {
      setError(activeTab === 'channels' ? 'Selecciona un canal.' : 'Selecciona un usuario.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res =
        activeTab === 'channels'
          ? await shareRequirementToConversation({
              conversationId: selectedChannelId!,
              requirementId,
              requirementTitle,
            })
          : await shareRequirementToUser({
              userId: selectedUserId!,
              requirementId,
              requirementTitle,
            })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      setSent(true)
      setTimeout(() => resetAndClose(), 900)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar por Inbox</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-fm-primary/10 flex items-center justify-center mx-auto mb-3">
              <span className="material-symbols-outlined text-fm-primary">check</span>
            </div>
            <p className="text-sm text-fm-on-surface font-semibold">¡Enviado!</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-fm-on-surface-variant">
              Se compartirá:{' '}
              <span className="font-semibold text-fm-on-surface">{requirementTitle}</span>
            </div>

            <div className="flex rounded-lg bg-fm-background p-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('channels')
                  setQuery('')
                  setError(null)
                }}
                className={cn(
                  'flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
                  activeTab === 'channels'
                    ? 'bg-fm-surface-container-lowest text-fm-on-surface shadow-sm'
                    : 'text-fm-on-surface-variant hover:text-fm-on-surface',
                )}
              >
                Canales
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('users')
                  setQuery('')
                  setError(null)
                }}
                className={cn(
                  'flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
                  activeTab === 'users'
                    ? 'bg-fm-surface-container-lowest text-fm-on-surface shadow-sm'
                    : 'text-fm-on-surface-variant hover:text-fm-on-surface',
                )}
              >
                Usuarios
              </button>
            </div>

            <Input
              placeholder={activeTab === 'channels' ? 'Buscar canal...' : 'Buscar usuario...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="max-h-64 overflow-y-auto border border-fm-surface-container-high rounded-lg divide-y divide-fm-surface-container-high">
              {activeTab === 'channels' ? (
                filteredChannels.length === 0 ? (
                  <div className="p-4 text-sm text-fm-on-surface-variant/70 text-center">
                    No hay canales disponibles.
                  </div>
                ) : (
                  filteredChannels.map((c) => (
                    <ChannelRow
                      key={c.id}
                      conv={c}
                      selected={selectedChannelId === c.id}
                      onSelect={() => setSelectedChannelId(c.id)}
                    />
                  ))
                )
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-sm text-fm-on-surface-variant/70 text-center">
                  No hay usuarios disponibles.
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <UserRowButton
                    key={u.id}
                    user={u}
                    selected={selectedUserId === u.id}
                    onSelect={() => setSelectedUserId(u.id)}
                  />
                ))
              )}
            </div>

            {error && <div className="text-xs text-fm-error">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetAndClose} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || !canSubmit}>
                {pending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChannelRow({
  conv,
  selected,
  onSelect,
}: {
  conv: ConversationListItem
  selected: boolean
  onSelect: () => void
}) {
  const label = conv.name ?? 'canal'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-fm-background transition-colors',
        selected && 'bg-fm-primary/10',
      )}
    >
      <span className="w-8 h-8 rounded-full bg-fm-primary/10 flex items-center justify-center text-fm-primary font-bold">
        #
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fm-on-surface truncate">{label}</div>
        <div className="text-xs text-fm-on-surface-variant/70">Canal</div>
      </div>
    </button>
  )
}

function UserRowButton({
  user,
  selected,
  onSelect,
}: {
  user: UserRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-fm-background transition-colors',
        selected && 'bg-fm-primary/10',
      )}
    >
      <UserAvatar name={user.full_name} avatarUrl={user.avatar_url} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fm-on-surface truncate">{user.full_name}</div>
        <div className="text-xs text-fm-on-surface-variant/70 capitalize">{user.role}</div>
      </div>
    </button>
  )
}
