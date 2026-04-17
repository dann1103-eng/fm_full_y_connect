'use client'

import { useUser } from '@/contexts/UserContext'

const avatarGradients = [
  'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
  'linear-gradient(135deg, #4a6319 0%, #ceee93 100%)',
  'linear-gradient(135deg, #006385 0%, #1dc0fe 100%)',
  'linear-gradient(135deg, #5c4a8a 0%, #b89cff 100%)',
  'linear-gradient(135deg, #7a4f00 0%, #ffcc5c 100%)',
]

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function getGradient(name: string): string {
  const idx = name.charCodeAt(0) % avatarGradients.length
  return avatarGradients[idx]
}

interface TopNavProps {
  title: string
}

export function TopNav({ title }: TopNavProps) {
  const user = useUser()
  const displayName = user.full_name || user.email
  const initials = getInitials(displayName)
  const gradient = getGradient(displayName)

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-[#abadaf]/30 flex-shrink-0">
      <h1 className="text-lg font-semibold text-[#2c2f31]">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium text-[#2c2f31] leading-tight">{displayName}</p>
          <p className="text-xs text-[#595c5e] capitalize">{user.role}</p>
        </div>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: gradient }}
        >
          <span className="text-white font-semibold text-sm">{initials}</span>
        </div>
      </div>
    </header>
  )
}
