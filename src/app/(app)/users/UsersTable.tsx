'use client'

import { useState } from 'react'
import type { AppUser, UserRole } from '@/types/db'
import { updateUserRole } from '@/app/actions/updateUserRole'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface UsersTableProps {
  users: AppUser[]
  currentUserId: string
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-SV', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#00675c]/10 text-[#00675c]">
        Admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#595c5e]/10 text-[#595c5e]">
      Operador
    </span>
  )
}

function UserRow({
  user,
  isCurrentUser,
}: {
  user: AppUser
  isCurrentUser: boolean
}) {
  const [isPending, setIsPending] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  function handleRoleChange(newRole: string | null) {
    if (!newRole || isPending) return
    setError(null)
    setIsPending(true)
    updateUserRole(user.id, newRole as UserRole)
      .then(() => setIsPending(false))
      .catch((err: unknown) => {
        setIsPending(false)
        setError(err instanceof Error ? err.message : 'Error al actualizar el rol')
      })
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[#dfe3e6] last:border-0">
      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#2c2f31] truncate">
          {user.full_name ?? user.email}
        </p>
        <p className="text-xs text-[#595c5e] truncate">{user.email}</p>
      </div>

      {/* Role badge */}
      <div className="hidden sm:block w-24 flex-shrink-0">
        <RoleBadge role={user.role} />
      </div>

      {/* Created at */}
      <div className="hidden md:block w-32 flex-shrink-0 text-xs text-[#595c5e]">
        {formatDate(user.created_at)}
      </div>

      {/* Role selector */}
      <div className="w-36 flex-shrink-0">
        <Select
          value={user.role}
          onValueChange={handleRoleChange}
          disabled={isCurrentUser || isPending}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="operator">Operador</SelectItem>
          </SelectContent>
        </Select>
        {error && (
          <p className="mt-1 text-xs text-[#b31b25]">{error}</p>
        )}
        {isCurrentUser && (
          <p className="mt-1 text-xs text-[#595c5e]">Tu cuenta</p>
        )}
      </div>
    </div>
  )
}

export function UsersTable({ users, currentUserId }: UsersTableProps) {
  return (
    <div className="glass-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 bg-[#f5f7f9] border-b border-[#dfe3e6]">
        <div className="flex-1 text-xs font-semibold text-[#595c5e] uppercase tracking-wide">
          Usuario
        </div>
        <div className="hidden sm:block w-24 flex-shrink-0 text-xs font-semibold text-[#595c5e] uppercase tracking-wide">
          Rol actual
        </div>
        <div className="hidden md:block w-32 flex-shrink-0 text-xs font-semibold text-[#595c5e] uppercase tracking-wide">
          Creado
        </div>
        <div className="w-36 flex-shrink-0 text-xs font-semibold text-[#595c5e] uppercase tracking-wide">
          Cambiar rol
        </div>
      </div>

      {users.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[#595c5e]">
          No hay usuarios registrados.
        </p>
      ) : (
        users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isCurrentUser={user.id === currentUserId}
          />
        ))
      )}
    </div>
  )
}
