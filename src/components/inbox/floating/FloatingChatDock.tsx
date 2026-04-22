'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useInboxList } from '@/hooks/useInboxPolling'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { FloatingChatLauncher } from './FloatingChatLauncher'
import { FloatingChatBubble } from './FloatingChatBubble'
import type { ConversationListItem } from '@/types/db'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const SESSION_KEY = 'floating-chat-open'
const MAX_BUBBLES = 3

function readSessionChats(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

function writeSessionChats(ids: string[]) {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids)) } catch {}
}

export function FloatingChatDock() {
  const pathname = usePathname()
  const { data: convList } = useInboxList()
  const [panelOpen, setPanelOpen] = useState(false)
  const [openChatIds, setOpenChatIds] = useState<string[]>([])
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)

  const totalUnread = convList.reduce((s, c) => s + c.unread_count, 0)

  // Restore from sessionStorage on mount
  useEffect(() => {
    setOpenChatIds(readSessionChats())
  }, [])

  // Persist open chat ids
  useEffect(() => {
    writeSessionChats(openChatIds)
  }, [openChatIds])

  // Close panel on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    if (panelOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen])

  // Don't show on /inbox pages
  if (pathname.startsWith('/inbox')) return null

  const openConvs: ConversationListItem[] = openChatIds
    .map((id) => convList.find((c) => c.id === id))
    .filter((c): c is ConversationListItem => !!c)

  function openChat(conv: ConversationListItem) {
    setPanelOpen(false)
    setOpenChatIds((prev) => {
      if (prev.includes(conv.id)) return prev
      const next = [...prev, conv.id]
      return next.length > MAX_BUBBLES ? next.slice(next.length - MAX_BUBBLES) : next
    })
  }

  function closeChat(id: string) {
    setOpenChatIds((prev) => prev.filter((x) => x !== id))
    setMinimizedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
  }

  function toggleMinimize(id: string) {
    setMinimizedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  return (
    <div className="fixed bottom-4 left-4 z-[200] flex flex-col-reverse items-start gap-2">
      {/* Bubbles row — rendered above launcher, left to right */}
      <div className="flex items-end gap-2">
        <FloatingChatLauncher
          unreadCount={totalUnread}
          open={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
        />
        {openConvs.map((conv) => (
          <FloatingChatBubble
            key={conv.id}
            conversation={conv}
            onClose={closeChat}
            onMinimize={toggleMinimize}
            minimized={minimizedIds.has(conv.id)}
          />
        ))}
      </div>

      {/* Conversation list panel */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="absolute bottom-14 left-0 w-[320px] max-h-[420px] bg-white border border-[#dfe3e6] rounded-xl shadow-xl flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[#dfe3e6] flex items-center justify-between">
            <span className="text-sm font-bold text-[#2a2a2a]">Mensajes</span>
            {totalUnread > 0 && (
              <span className="text-xs font-semibold text-[#b31b25]">
                {totalUnread} nuevo{totalUnread !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {convList.length === 0 && (
              <p className="text-xs text-[#595c5e] text-center py-6">Sin conversaciones</p>
            )}
            {convList.map((conv) => {
              const label =
                conv.type === 'channel'
                  ? conv.name ?? 'Canal'
                  : conv.counterpart?.full_name ?? 'Usuario'

              let timeAgo = ''
              try {
                timeAgo = formatDistanceToNow(parseISO(conv.last_message_at), { locale: es, addSuffix: false })
              } catch {}

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => openChat(conv)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f5f7f9] transition-colors text-left"
                >
                  {conv.type === 'channel' ? (
                    <div className="w-8 h-8 rounded-full bg-[#00675c]/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-[#00675c]">#</span>
                    </div>
                  ) : (
                    <div className="flex-shrink-0">
                      <UserAvatar
                        name={conv.counterpart?.full_name ?? '?'}
                        avatarUrl={conv.counterpart?.avatar_url}
                        size="sm"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#2a2a2a] truncate">{label}</span>
                      <span className="text-[10px] text-[#595c5e]/60 ml-2 flex-shrink-0">{timeAgo}</span>
                    </div>
                    {conv.last_message_preview && (
                      <p className="text-[11px] text-[#595c5e] truncate mt-0.5">{conv.last_message_preview}</p>
                    )}
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="bg-[#b31b25] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center flex-shrink-0">
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
