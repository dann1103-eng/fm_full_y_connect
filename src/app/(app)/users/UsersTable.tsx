'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AppUser, UserRole } from '@/types/db'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { updateUserRole } from '@/app/actions/updateUserRole'
import { updateUserDefaultAssignee } from '@/app/actions/updateUserDefaultAssignee'
import {
  adminChangeUserPassword,
  createUser,
  deleteUser,
  updateUserProfile,
} from '@/app/actions/users'
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
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-fm-primary/10 text-fm-primary">
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
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-fm-on-surface-variant/10 text-fm-on-surface-variant">
      Operador
    </span>
  )
}

function UserRow({
  user,
  isCurrentUser,
  onDeleted,
  onRoleChanged,
  onDefaultAssigneeChanged,
  onEdit,
  onChangePassword,
}: {
  user: AppUser
  isCurrentUser: boolean
  onDeleted: (id: string) => void
  onRoleChanged: (id: string, role: UserRole) => void
  onDefaultAssigneeChanged: (id: string, value: boolean) => void
  onEdit: (user: AppUser) => void
  onChangePassword: (user: AppUser) => void
}) {

  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isTogglingDefault, setIsTogglingDefault] = useState(false)

  function handleRoleChange(newRole: string | null) {
    if (!newRole || isPending) return
    setError(null)
    setIsPending(true)
    updateUserRole(user.id, newRole as UserRole).then((res) => {
      setIsPending(false)
      if (res.error) {
        setError(res.error)
      } else {
        onRoleChanged(user.id, newRole as UserRole)
        router.refresh()
      }
    })
  }

  function handleToggleDefaultAssignee() {
    if (isTogglingDefault) return
    setError(null)
    const next = !user.default_assignee
    setIsTogglingDefault(true)
    // Optimistic update
    onDefaultAssigneeChanged(user.id, next)
    updateUserDefaultAssignee(user.id, next).then((res) => {
      setIsTogglingDefault(false)
      if (res.error) {
        setError(res.error)
        // Revert optimistic change
        onDefaultAssigneeChanged(user.id, !next)
      } else {
        router.refresh()
      }
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
    <div className="flex items-center gap-4 px-4 py-3 border-b border-fm-surface-container-high last:border-0">
      {/* Avatar */}
      <UserAvatar name={user.full_name || user.email} avatarUrl={user.avatar_url} size="sm" />

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-fm-on-surface truncate">
          {user.full_name ?? user.email}
        </p>
        <p className="text-xs text-fm-on-surface-variant truncate">{user.email}</p>
      </div>

      {/* Role badge */}
      <div className="hidden sm:block w-24 flex-shrink-0">
        <RoleBadge role={user.role} />
      </div>

      {/* Created at */}
      <div className="hidden md:block w-32 flex-shrink-0 text-xs text-fm-on-surface-variant">
        {formatDate(user.created_at)}
      </div>

      {/* Default assignee toggle */}
      <div className="w-20 flex-shrink-0 flex items-center justify-center">
        <button
          onClick={handleToggleDefaultAssignee}
          disabled={isTogglingDefault}
          title={
            user.default_assignee
              ? 'Usuario preseleccionado al crear requerimientos — click para desactivar'
              : 'Click para preseleccionar al crear requerimientos'
          }
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
            user.default_assignee ? 'bg-fm-primary' : 'bg-fm-surface-container-high'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-fm-surface-container-lowest transition-transform ${
              user.default_assignee ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
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
        {error && <p className="mt-1 text-xs text-fm-error">{error}</p>}
        {isCurrentUser && <p className="mt-1 text-xs text-fm-on-surface-variant">Tu cuenta</p>}
      </div>

      {/* Edit profile */}
      <button
        onClick={() => onEdit(user)}
        title="Editar perfil"
        className="p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-background hover:text-fm-primary transition-colors flex-shrink-0"
      >
        <span className="material-symbols-outlined text-base">edit</span>
      </button>

      {/* Change password */}
      <button
        onClick={() => onChangePassword(user)}
        title="Cambiar contraseña"
        className="p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-background hover:text-fm-primary transition-colors flex-shrink-0"
      >
        <span className="material-symbols-outlined text-base">key</span>
      </button>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={isCurrentUser || isDeleting}
        title={isCurrentUser ? 'No puedes eliminar tu propia cuenta' : 'Eliminar usuario'}
        className="p-1.5 rounded-lg text-fm-error hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
      >
        <span className="material-symbols-outlined text-base">
          {isDeleting ? 'hourglass_empty' : 'delete'}
        </span>
      </button>
    </div>
  )
}

// ── Edit profile modal ─────────────────────────────────────────────────────

function EditProfileModal({
  user,
  onClose,
  onUpdated,
}: {
  user: AppUser
  onClose: () => void
  onUpdated: (patch: Partial<AppUser>) => void
}) {
  const [fullName, setFullName] = useState(user.full_name ?? '')
  const [email, setEmail] = useState(user.email)
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!fullName.trim() || !email.trim()) {
      setError('Nombre y correo son requeridos.')
      return
    }
    setError(null)
    startTransition(async () => {
      const payload: {
        userId: string
        fullName?: string
        email?: string
        avatarUrl?: string | null
      } = { userId: user.id }
      const nextFullName = fullName.trim()
      const nextEmail = email.trim()
      const nextAvatar = avatarUrl.trim() ? avatarUrl.trim() : null
      if (nextFullName !== (user.full_name ?? '')) payload.fullName = nextFullName
      if (nextEmail !== user.email) payload.email = nextEmail
      if (nextAvatar !== (user.avatar_url ?? null)) payload.avatarUrl = nextAvatar

      const res = await updateUserProfile(payload)
      if (res.error) {
        setError(res.error)
        return
      }
      onUpdated({
        full_name: nextFullName,
        email: nextEmail,
        avatar_url: nextAvatar,
      })
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Editar perfil</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Nombre completo</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">URL de avatar (opcional)</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Change password modal ──────────────────────────────────────────────────

function ChangePasswordModal({
  user,
  onClose,
}: {
  user: AppUser
  onClose: () => void
}) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (pw.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (pw !== pw2) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await adminChangeUserPassword({ userId: user.id, newPassword: pw })
      if (res.error) {
        setError(res.error)
        return
      }
      setSuccess(true)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Cambiar contraseña</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="text-xs text-fm-on-surface-variant">
          Nueva contraseña para <b>{user.full_name ?? user.email}</b>. Compártela con el usuario por un canal seguro.
        </p>

        {success ? (
          <>
            <div className="p-4 rounded-xl bg-fm-primary/10 text-fm-primary text-sm font-semibold">
              Contraseña actualizada correctamente.
            </div>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim"
            >
              Cerrar
            </button>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Nueva contraseña</label>
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Confirmar contraseña</label>
                <input
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
                />
              </div>
            </div>

            {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60"
              >
                {isPending ? 'Guardando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </>
        )}
      </div>
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
        default_assignee: false,
      })
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Nuevo usuario</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Nombre completo</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ana García"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ana@fmcommunication.com"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Contraseña inicial</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Rol</label>
            <div className="flex gap-3 mt-1.5">
              {(['operator', 'supervisor', 'admin'] as UserRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    role === r
                      ? 'bg-fm-primary text-white border-fm-primary'
                      : 'border-fm-surface-container-high text-fm-on-surface-variant hover:border-fm-primary/40'
                  }`}
                >
                  {r === 'operator' ? 'Operador' : r === 'supervisor' ? 'Supervisor' : 'Admin'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60"
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
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [changingPw, setChangingPw] = useState<AppUser | null>(null)

  return (
    <>
      <div className="glass-panel overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-4 py-3 bg-fm-background border-b border-fm-surface-container-high">
          <div className="flex-1 text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide">
            Usuario
          </div>
          <div className="hidden sm:block w-24 flex-shrink-0 text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide">
            Rol actual
          </div>
          <div className="hidden md:block w-32 flex-shrink-0 text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide">
            Creado
          </div>
          <div className="w-20 flex-shrink-0 text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide text-center">
            Default
          </div>
          <div className="w-36 flex-shrink-0 text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide">
            Cambiar rol
          </div>
          <div className="w-24 flex-shrink-0" />
        </div>

        {users.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fm-on-surface-variant">
            No hay usuarios registrados.
          </p>
        ) : (
          users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isCurrentUser={user.id === currentUserId}
              onDeleted={(id) => setUsers(prev => prev.filter(u => u.id !== id))}
              onRoleChanged={(id, role) => setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u))}
              onDefaultAssigneeChanged={(id, value) =>
                setUsers(prev => prev.map(u => u.id === id ? { ...u, default_assignee: value } : u))
              }
              onEdit={(u) => setEditing(u)}
              onChangePassword={(u) => setChangingPw(u)}
            />
          ))
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-fm-primary text-white font-bold rounded-full hover:bg-fm-primary-dim transition-all text-sm"
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

      {editing && (
        <EditProfileModal
          user={editing}
          onClose={() => setEditing(null)}
          onUpdated={(patch) =>
            setUsers((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...patch } : u)))
          }
        />
      )}

      {changingPw && (
        <ChangePasswordModal user={changingPw} onClose={() => setChangingPw(null)} />
      )}
    </>
  )
}
