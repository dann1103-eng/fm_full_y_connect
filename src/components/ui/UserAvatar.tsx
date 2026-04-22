interface UserAvatarProps {
  name: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const SIZE_MAP = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-lg',
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export function UserAvatar({ name, avatarUrl, size = 'sm' }: UserAvatarProps) {
  const cls = SIZE_MAP[size]

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${cls} rounded-full object-cover flex-shrink-0`}
      />
    )
  }

  return (
    <div
      className={`${cls} rounded-full bg-fm-primary/15 flex items-center justify-center font-bold text-fm-primary flex-shrink-0`}
    >
      {initials(name)}
    </div>
  )
}
