'use client'

import { useMemo, useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { cn } from '@/lib/utils'
import { shareRequirementToConversation } from '@/app/actions/inbox'
import { useInboxList } from '@/hooks/useInboxPolling'
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
                Enviar por Bandeja
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

function SendToInboxDialog({
  open,
  onOpenChange,
  requirementId,
  requirementTitle,
}: SendToInboxDialogProps) {
  const { data: conversations } = useInboxList([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()

  function resetAndClose() {
    setQuery('')
    setSelectedId(null)
    setError(null)
    setSent(false)
    onOpenChange(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      const label = c.type === 'channel' ? c.name ?? '' : c.counterpart?.full_name ?? ''
      return !q || label.toLowerCase().includes(q)
    })
  }, [conversations, query])

  function submit() {
    if (!selectedId) {
      setError('Selecciona una conversación.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await shareRequirementToConversation({
        conversationId: selectedId,
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
          <DialogTitle>Enviar por Bandeja</DialogTitle>
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
            <Input
              placeholder="Buscar conversación..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto border border-fm-surface-container-high rounded-lg divide-y divide-fm-surface-container-high">
              {filtered.length === 0 && (
                <div className="p-4 text-sm text-fm-on-surface-variant/70 text-center">
                  No hay conversaciones disponibles.
                </div>
              )}
              {filtered.map((c) => (
                <ConvRow
                  key={c.id}
                  conv={c}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
            </div>
            {error && <div className="text-xs text-fm-error">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetAndClose} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || !selectedId}>
                {pending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConvRow({
  conv,
  selected,
  onSelect,
}: {
  conv: ConversationListItem
  selected: boolean
  onSelect: () => void
}) {
  const label = conv.type === 'channel' ? conv.name ?? 'canal' : conv.counterpart?.full_name ?? 'Usuario'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-fm-background transition-colors',
        selected && 'bg-fm-primary/10',
      )}
    >
      {conv.type === 'channel' ? (
        <span className="w-8 h-8 rounded-full bg-fm-primary/10 flex items-center justify-center text-fm-primary font-bold">
          #
        </span>
      ) : (
        <UserAvatar name={conv.counterpart?.full_name ?? '?'} avatarUrl={conv.counterpart?.avatar_url} size="sm" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fm-on-surface truncate">{label}</div>
        <div className="text-xs text-fm-on-surface-variant/70 capitalize">
          {conv.type === 'channel' ? 'Canal' : 'Mensaje directo'}
        </div>
      </div>
    </button>
  )
}
