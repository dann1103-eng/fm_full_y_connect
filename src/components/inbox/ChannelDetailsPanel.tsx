'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { AttachmentPreview } from './AttachmentPreview'
import {
  updateChannelMeta,
  leaveChannel,
  deleteChannel,
  addChannelMembers,
  removeChannelMember,
} from '@/app/actions/inbox'
import type { Conversation, AppUser, MessageAttachment } from '@/types/db'
import { cn } from '@/lib/utils'

interface ChannelDetailsPanelProps {
  conversation: Conversation
  members: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
  allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
  attachments: MessageAttachment[]
  currentUserId: string
  isAdmin: boolean
  onClose: () => void
}

export function ChannelDetailsPanel({
  conversation,
  members,
  allUsers,
  attachments,
  currentUserId,
  isAdmin,
  onClose,
}: ChannelDetailsPanelProps) {
  const router = useRouter()
  const [editingAbout, setEditingAbout] = useState(false)
  const [description, setDescription] = useState(conversation.description ?? '')
  const [topic, setTopic] = useState(conversation.topic ?? '')
  const [addMode, setAddMode] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const nonMembers = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.id))
    return allUsers.filter((u) => !memberIds.has(u.id))
  }, [members, allUsers])

  function saveMeta() {
    startTransition(async () => {
      const res = await updateChannelMeta({
        conversationId: conversation.id,
        description,
        topic,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      setEditingAbout(false)
      setError(null)
      router.refresh()
    })
  }

  function handleAddMembers() {
    if (selectedToAdd.length === 0) {
      setAddMode(false)
      return
    }
    startTransition(async () => {
      const res = await addChannelMembers(conversation.id, selectedToAdd)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      setAddMode(false)
      setSelectedToAdd([])
      router.refresh()
    })
  }

  function handleRemove(userId: string) {
    if (!confirm('¿Expulsar a este miembro del canal?')) return
    startTransition(async () => {
      const res = await removeChannelMember(conversation.id, userId)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleLeave() {
    if (!confirm('¿Salir del canal?')) return
    startTransition(async () => {
      const res = await leaveChannel(conversation.id)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      router.push('/inbox')
    })
  }

  function handleDelete() {
    if (deleteConfirmText.trim() !== conversation.name) {
      setError('El nombre no coincide.')
      return
    }
    startTransition(async () => {
      const res = await deleteChannel(conversation.id)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      router.push('/inbox')
    })
  }

  return (
    <aside className="w-80 border-l border-fm-surface-container-high bg-fm-surface-container-lowest hidden lg:flex flex-col flex-shrink-0">
      <div className="p-5 border-b border-fm-surface-container-high flex items-center justify-between">
        <h3 className="font-bold text-fm-on-surface">Detalles del canal</h3>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1 text-fm-error hover:bg-fm-error/10 rounded"
              title="Eliminar canal"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-fm-background rounded"
            title="Cerrar"
          >
            <svg className="w-4 h-4 text-fm-on-surface-variant" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* About */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-fm-on-surface-variant">Acerca</h4>
            {isAdmin && !editingAbout && (
              <button
                onClick={() => setEditingAbout(true)}
                className="text-[10px] font-bold text-fm-primary"
              >
                Editar
              </button>
            )}
          </div>
          {editingAbout ? (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-bold text-fm-on-surface-variant/70 uppercase">Tema</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full text-sm border border-fm-surface-container-high rounded-lg px-2 py-1 mt-1 focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-fm-on-surface-variant/70 uppercase">Descripción</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full text-sm border border-fm-surface-container-high rounded-lg px-2 py-1 mt-1 focus:outline-none focus:ring-2 focus:ring-fm-primary/30 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveMeta}
                  disabled={pending}
                  className="text-[10px] font-bold text-fm-primary disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setDescription(conversation.description ?? '')
                    setTopic(conversation.topic ?? '')
                    setEditingAbout(false)
                  }}
                  className="text-[10px] font-bold text-fm-on-surface-variant"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-bold text-fm-on-surface-variant/70 uppercase">Tema</div>
                <div className="text-sm text-fm-on-surface mt-0.5">
                  {conversation.topic ?? <span className="italic text-fm-on-surface-variant/60">Sin tema</span>}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-fm-on-surface-variant/70 uppercase">Descripción</div>
                <div className="text-sm text-fm-on-surface mt-0.5 leading-relaxed">
                  {conversation.description ?? (
                    <span className="italic text-fm-on-surface-variant/60">Sin descripción</span>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Members */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-fm-on-surface-variant">
              Miembros ({members.length})
            </h4>
            {isAdmin && !addMode && (
              <button
                onClick={() => setAddMode(true)}
                className="text-[10px] font-bold text-fm-primary"
              >
                Agregar
              </button>
            )}
          </div>
          {addMode ? (
            <div className="space-y-2">
              <div className="max-h-32 overflow-y-auto border border-fm-surface-container-high rounded-lg divide-y divide-fm-surface-container-high">
                {nonMembers.length === 0 ? (
                  <div className="p-2 text-xs text-fm-on-surface-variant/70 text-center">
                    Todos ya son miembros
                  </div>
                ) : (
                  nonMembers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-fm-background cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedToAdd.includes(u.id)}
                        onChange={() =>
                          setSelectedToAdd((prev) =>
                            prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                          )
                        }
                        className="accent-fm-primary"
                      />
                      <UserAvatar name={u.full_name ?? '?'} avatarUrl={u.avatar_url} size="xs" />
                      <span className="text-xs text-fm-on-surface">{u.full_name}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddMembers}
                  disabled={pending || selectedToAdd.length === 0}
                  className="text-[10px] font-bold text-fm-primary disabled:opacity-50"
                >
                  Agregar seleccionados
                </button>
                <button
                  onClick={() => {
                    setAddMode(false)
                    setSelectedToAdd([])
                  }}
                  className="text-[10px] font-bold text-fm-on-surface-variant"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 group">
                  <UserAvatar name={m.full_name ?? '?'} avatarUrl={m.avatar_url} size="xs" />
                  <div className="text-sm text-fm-on-surface flex-1 truncate">
                    {m.full_name}
                    {m.role === 'admin' && (
                      <span className="text-[10px] text-fm-on-surface-variant/70"> · Admin</span>
                    )}
                  </div>
                  {isAdmin && m.id !== currentUserId && (
                    <button
                      onClick={() => handleRemove(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-fm-error p-1"
                      title="Expulsar"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14 8c0-2.21-1.79-4-4-4S6 5.79 6 8s1.79 4 4 4 4-1.79 4-4zm3 2v2h6v-2h-6zM2 18v2h16v-2c0-2.66-5.33-4-8-4s-8 1.34-8 4z" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Files */}
        <section className="space-y-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-fm-on-surface-variant">
            Archivos ({attachments.length})
          </h4>
          {attachments.length === 0 ? (
            <div className="text-xs text-fm-on-surface-variant/70 italic">Sin archivos compartidos.</div>
          ) : (
            <div className="space-y-2">
              {attachments.slice(0, 20).map((a) => (
                <AttachmentPreview key={a.id} attachment={a} />
              ))}
            </div>
          )}
        </section>

        {error && <div className="text-xs text-fm-error">{error}</div>}
      </div>

      <div className="p-5 border-t border-fm-surface-container-high">
        <button
          onClick={handleLeave}
          disabled={pending}
          className="w-full py-2 px-4 border border-fm-error text-fm-error font-bold text-xs rounded-lg hover:bg-fm-error hover:text-white uppercase tracking-widest transition-colors disabled:opacity-50"
        >
          Salir del canal
        </button>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="bg-fm-surface-container-lowest rounded-lg p-6 max-w-sm w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-fm-on-surface">Eliminar canal</h3>
            <p className="text-sm text-fm-on-surface-variant">
              Esta acción es permanente. Se eliminarán todos los mensajes y archivos de
              <b> #{conversation.name}</b>. Escribe el nombre del canal para confirmar.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={conversation.name ?? ''}
              className="w-full border border-fm-surface-container-high rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fm-error/30"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-sm text-fm-on-surface-variant hover:bg-fm-background rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={pending || deleteConfirmText.trim() !== conversation.name}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-lg text-white font-semibold',
                  pending || deleteConfirmText.trim() !== conversation.name
                    ? 'bg-fm-error/50 cursor-not-allowed'
                    : 'bg-fm-error hover:opacity-90'
                )}
              >
                {pending ? 'Eliminando...' : 'Eliminar canal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
