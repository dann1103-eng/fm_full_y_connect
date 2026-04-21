'use client'

import { useState } from 'react'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { MessageComposer } from './MessageComposer'
import { ChannelDetailsPanel } from './ChannelDetailsPanel'
import type {
  Conversation,
  MessageWithMeta,
  AppUser,
  MessageAttachment,
} from '@/types/db'

interface ConversationViewProps {
  conversation: Conversation
  members: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
  allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
  initialMessages: MessageWithMeta[]
  channelAttachments: MessageAttachment[]
  currentUserId: string
  isAdmin: boolean
}

export function ConversationView({
  conversation,
  members,
  allUsers,
  initialMessages,
  channelAttachments,
  currentUserId,
  isAdmin,
}: ConversationViewProps) {
  const [detailsOpen, setDetailsOpen] = useState(conversation.type === 'channel')

  const counterpart =
    conversation.type === 'dm'
      ? members.find((m) => m.id !== currentUserId) ?? null
      : null

  const composerPlaceholder =
    conversation.type === 'channel'
      ? `Escribe un mensaje a #${conversation.name}...`
      : `Escribe un mensaje a ${counterpart?.full_name ?? ''}...`

  return (
    <>
      <main className="flex-1 flex flex-col bg-white min-w-0">
        <ChatHeader
          conversation={conversation}
          counterpart={counterpart}
          memberCount={members.length}
          showDetailsButton={conversation.type === 'channel'}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
        />
        <MessageList
          conversationId={conversation.id}
          currentUserId={currentUserId}
          initialMessages={initialMessages}
        />
        <MessageComposer conversationId={conversation.id} placeholder={composerPlaceholder} />
      </main>
      {conversation.type === 'channel' && detailsOpen && (
        <ChannelDetailsPanel
          conversation={conversation}
          members={members}
          allUsers={allUsers}
          attachments={channelAttachments}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  )
}
