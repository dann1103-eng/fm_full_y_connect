'use client'

import { useState, useTransition } from 'react'
import type { AppUser, UserRole } from '@/types/db'
import { updateUserRole } from '@/app/actions/updateUserRole'
import { createUser, deleteUser } from '@/app/actions/users'
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
  if (role === 'supervisor') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
        Supervisor
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
  onDeleted,
}: {
  user: AppUser
  isCurrentUser: boolean
  onDeleted: (id: string) => void
}) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()

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

  function handleDelete() {
    if (!confirm(`¿Eliminar a ${user.full_name ?? user.email}? Esta acción no se puede deshacer.`)) return
    startDeleteTransition(async () => {
      const res = await deleteUser(user.id)
      if (res.error) { setError(res.error); return }
      onDeleted(user.id)
    })
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[#dfe3e6] last:border-0">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-[#00675c]/10 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[#00675c]">
          {(user.full_name ?? user.email).slice(0, 2).toUpperCase()}
        </span>
      </div>

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
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="operator">Operador</SelectItem>
          </SelectContent>
        </Select>
        {error && <p className="mt-1 text-xs text-[#b31b25]">{error}</p>}
        {isCurrentUser && <p className="mt-1 text-xs text-[#595c5e]">Tu cuenta</p>}
      </div>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={isCurrentUser || isDeleting}
        title={isCurrentUser ? 'No puedes eliminar tu propia cuenta' : 'Eliminar usuario'}
        className="p-1.5 rounded-lg text-[#b31b25] hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
      >
        <span className="material-symbols-outlined text-base">
          {isDeleting ? 'hourglass_empty' : 'delete'}
        </span>
      </button>
    </div>
  )
}

// ── Create user modal ──────────────────────────────────────────────────────

function CreateUserModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (user: AppUser) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('operator')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!email.trim() || !password.trim() || !fullName.trim()) {
      setError('Todos los campos son requeridos.')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createUser({ email: email.trim(), password, fullName: fullName.trim(), role })
      if (res.error) { setError(res.error); return }
      // Optimistic: create a fake AppUser to show immediately
      onCreated({
        id: crypto.randomUUID(),
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        created_at: new Date().toISOString(),
        avatar_url: null,
      })
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-[#2c2f31]">Nuevo usuario</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Nombre completo</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ana García"
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ana@fmcommunication.com"
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Contraseña inicial</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Rol</label>
            <div className="flex gap-3 mt-1.5">
              {(['operator', 'supervisor', 'admin'] as UserRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    role === r
                      ? 'bg-[#00675c] text-white border-[#00675c]'
                      : 'border-[#dfe3e6] text-[#595c5e] hover:border-[#00675c]/40'
                  }`}
                >
                  {r === 'operator' ? 'Operador' : r === 'supervisor' ? 'Supervisor' : 'Admin'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-[#b31b25] font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-[#dfe3e6] rounded-full text-sm font-bold text-[#595c5e] hover:bg-[#f5f7f9]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2.5 bg-[#00675c] text-white rounded-full text-sm font-bold hover:bg-[#005047] disabled:opacity-60"
          >
            {isPending ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function UsersTable({ users: initialUsers, currentUserId }: UsersTableProps) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers)
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <div className="glass-panel overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-4 py-3 bg-[#f5f7f9] border-b border-[#dfe3e6]">
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
          <div className="w-8 flex-shrink-0" />
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
              onDeleted={(id) => setUsers(prev => prev.filter(u => u.id !== id))}
            />
          ))
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-base">person_add</span>
          Crear usuario
        </button>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(user) => setUsers(prev => [...prev, user])}
        />
      )}
    </>
  )
}
