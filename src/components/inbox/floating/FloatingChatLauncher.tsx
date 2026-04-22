'use client'

interface FloatingChatLauncherProps {
  unreadCount: number
  open: boolean
  onClick: () => void
}

export function FloatingChatLauncher({ unreadCount, open, onClick }: FloatingChatLauncherProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-12 h-12 rounded-full bg-[#00675c] text-white shadow-lg flex items-center justify-center hover:bg-[#005549] transition-colors"
      aria-label="Chat"
    >
      {open ? (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z"/>
        </svg>
      )}
      {unreadCount > 0 && !open && (
        <span className="absolute -top-1 -right-1 bg-[#b31b25] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
