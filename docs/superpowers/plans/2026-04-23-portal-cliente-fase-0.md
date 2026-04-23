# Portal del Cliente — Fase 0 (Fundamentos) · Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar rol `client` en DB, vínculo user↔cliente N:N, RLS por-cliente, grupo de rutas `(portal)` con gating, redirect por rol en login, y flujo de invitación por email desde `/clients/[id]`. Sin features del portal aún — solo la infraestructura.

**Architecture:** Migración SQL 0052 (rol `client`, tabla `client_users`, helper `is_client_of`, refactor de `is_agency_user()`, flag `visible_to_client`, tabla `renewal_requests`, rewrite de policies). Nuevo `middleware.ts` que gatea `/portal/*` vs área staff. Grupo de rutas `src/app/(portal)/portal/*` con layout + sidebar dedicados y stubs de páginas. Server action `clientUsers.ts` que usa `createAdminClient()` + `auth.admin.inviteUserByEmail`.

**Tech Stack:** Next.js 16.2.4 · TypeScript · Supabase (Postgres + Auth) · Tailwind v4 · Vitest v2.

**Referencia del brainstorm:** `C:\Users\Daniel\.claude\plans\necesito-que-me-ayudes-moonlit-treehouse.md`

---

## Pre-flight

- [ ] **Leer docs de Next 16 sobre middleware.** El `AGENTS.md` enfatiza que Next 16 tiene breaking changes. Antes de escribir `src/middleware.ts`, revisar `node_modules/next/dist/docs/` buscando páginas relacionadas con middleware y Route Groups. Anotar cualquier diferencia respecto a Next 14/15.
- [ ] **Confirmar variables de entorno.** En `.env.local` deben estar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. La acción de invitación requiere la service-role.
- [ ] **Crear rama de trabajo** (si aún no existe):

```bash
cd "C:/Users/Daniel/Desktop/FM CRM/fm-crm"
git checkout -b portal-cliente-fase-0
```

---

## Mapa de archivos (Fase 0)

### Nuevos
| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0052_client_portal_foundations.sql` | Schema: rol `client`, `client_users`, `is_client_of`, refactor `is_agency_user`, `visible_to_client`, `renewal_requests`, rewrite policies |
| `src/middleware.ts` | Gating: `/portal` solo para role=client; área staff redirige clients a `/portal` |
| `src/lib/supabase/active-client.ts` | `getActiveClientIds()` + `getActiveClientId()` leyendo cookie `portal_active_client` |
| `src/lib/domain/permissions.ts` (se modifica) | Añadir `isClientRole`, `isStaffRole`, `canAccessPortal` |
| `src/app/actions/clientUsers.ts` | `inviteClientUser()`, `revokeClientUser()`, `listClientUsers()` |
| `src/app/(portal)/layout.tsx` | Layout que requiere role=client, carga `client_users`, resuelve marca activa |
| `src/app/(portal)/seleccionar-marca/page.tsx` | Intersticial cuando un user tiene ≥2 marcas |
| `src/app/(portal)/portal/dashboard/page.tsx` | Stub |
| `src/app/(portal)/portal/pipeline/page.tsx` | Stub |
| `src/app/(portal)/portal/calendario/page.tsx` | Stub |
| `src/app/(portal)/portal/facturacion/page.tsx` | Stub |
| `src/app/(portal)/portal/empresa/page.tsx` | Stub |
| `src/app/(portal)/portal/config/page.tsx` | Stub |
| `src/components/portal/PortalSidebar.tsx` | Sidebar fijo con 6 items + selector de marca + logout |
| `src/components/portal/ActiveClientSwitcher.tsx` | Dropdown de marcas + server action que setea cookie |
| `src/components/clients/ClientPortalInvite.tsx` | Card con form de invitar + lista de usuarios vinculados |

### Modificados
| Archivo | Cambio |
|---|---|
| `src/types/db.ts` | `UserRole += 'client'`; tipos `ClientUser`, `RenewalRequest`; `RequirementMessages.visible_to_client: boolean` |
| `src/app/(auth)/login/LoginForm.tsx` | Tras `signInWithPassword`, leer role y redirigir a `/portal/dashboard` o `/dashboard` |
| `src/app/(app)/layout.tsx` | Si `appUser.role === 'client'` → `redirect('/portal/dashboard')` (defensa adicional al middleware) |
| `src/app/(app)/clients/[id]/page.tsx` | Importar `ClientPortalInvite` y renderizarlo (solo si role=admin) |

### Tests
| Archivo | Cubre |
|---|---|
| `src/lib/domain/permissions.test.ts` | `isClientRole`, `isStaffRole`, `canAccessPortal` |
| `src/lib/supabase/active-client.test.ts` | `getActiveClientId` respeta cookie, falla si cookie no está en lista del user |

---

## Task 1 — Migración 0052: schema foundations

**Files:**
- Create: `supabase/migrations/0052_client_portal_foundations.sql`

- [ ] **Step 1.1: Leer 0001 y 0015 para replicar estilo.**

Leer `supabase/migrations/0001_init.sql` líneas 137–215 (helpers y policies) y `0015_supervisor_role.sql` completo. Confirmar convención: `create or replace function public.xxx()`, RLS policies con `public.is_agency_user()`.

- [ ] **Step 1.2: Crear archivo con el siguiente SQL.**

```sql
-- 0052_client_portal_foundations.sql
-- Fundamentos del Portal del Cliente:
-- 1) rol 'client' + refactor is_agency_user
-- 2) tabla client_users (user ↔ cliente N:N)
-- 3) helper is_client_of
-- 4) flag visible_to_client en requirement_messages
-- 5) tabla renewal_requests
-- 6) policies complementarias (staff OR client_of) en tablas expuestas al portal

begin;

-- 1) Ampliar CHECK de users.role
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin','supervisor','operator','client'));

-- 1b) Refactor is_agency_user: excluir role='client'
create or replace function public.is_agency_user()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin','supervisor','operator')
  );
$$;

-- 2) client_users
create table public.client_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index client_users_user_idx on public.client_users(user_id);
create index client_users_client_idx on public.client_users(client_id);
alter table public.client_users enable row level security;

-- RLS client_users: staff lee todo; cliente solo sus propias filas
create policy "Agency users can view client_users"
  on public.client_users for select
  using (public.is_agency_user());
create policy "Clients can view their own client_users"
  on public.client_users for select
  using (user_id = auth.uid());
create policy "Admins manage client_users"
  on public.client_users for all
  using (public.is_admin())
  with check (public.is_admin());

-- 3) Helper is_client_of(client_id)
create or replace function public.is_client_of(target_client_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.client_users
    where user_id = auth.uid()
      and client_id = target_client_id
  );
$$;

-- 4) visible_to_client en requirement_messages
alter table public.requirement_messages
  add column if not exists visible_to_client boolean not null default false;
create index if not exists requirement_messages_visible_client_idx
  on public.requirement_messages(requirement_id)
  where visible_to_client = true;

-- 5) renewal_requests
create table public.renewal_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  from_cycle_id uuid references public.billing_cycles(id),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed')),
  rollover_items_json jsonb not null default '[]'::jsonb,
  addons_json jsonb not null default '{}'::jsonb,
  admin_notes text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id)
);
create index renewal_requests_client_idx on public.renewal_requests(client_id);
create index renewal_requests_status_idx on public.renewal_requests(status);
alter table public.renewal_requests enable row level security;

create policy "Staff or owner-client can view renewal_requests"
  on public.renewal_requests for select
  using (public.is_agency_user() or public.is_client_of(client_id));
create policy "Owner-client can create renewal_requests"
  on public.renewal_requests for insert
  with check (public.is_client_of(client_id) and requested_by = auth.uid());
create policy "Admin can decide renewal_requests"
  on public.renewal_requests for update
  using (public.is_admin());

-- 6) Extender policies existentes para que clients vean lo suyo.
--    Patrón: añadir policies PERMISSIVE adicionales (no alterar las de staff).

-- clients
create policy "Client can view own client row"
  on public.clients for select
  using (public.is_client_of(id));
create policy "Client can update own client row"
  on public.clients for update
  using (public.is_client_of(id));

-- billing_cycles
create policy "Client can view own cycles"
  on public.billing_cycles for select
  using (public.is_client_of(client_id));

-- requirements (tabla actual, post-rename de 0009)
create policy "Client can view own requirements"
  on public.requirements for select
  using (public.is_client_of(client_id));

-- requirement_messages: cliente solo ve visible_to_client=true
create policy "Client can view visible messages"
  on public.requirement_messages for select
  using (
    visible_to_client = true
    and exists (
      select 1 from public.requirements r
      where r.id = requirement_messages.requirement_id
        and public.is_client_of(r.client_id)
    )
  );
create policy "Client can insert visible messages"
  on public.requirement_messages for insert
  with check (
    visible_to_client = true
    and user_id = auth.uid()
    and exists (
      select 1 from public.requirements r
      where r.id = requirement_id
        and public.is_client_of(r.client_id)
    )
  );

-- invoices / quotes (schema de 0048)
create policy "Client can view own invoices"
  on public.invoices for select
  using (public.is_client_of(client_id));
create policy "Client can view own quotes"
  on public.quotes for select
  using (public.is_client_of(client_id));

-- Nota: calendar-related (time_entries) se cubrirá en Fase 3 cuando
-- se defina exactamente qué debe ver el cliente. Por ahora sus policies
-- siguen siendo solo is_agency_user().

commit;
```

- [ ] **Step 1.3: Aplicar la migración en Supabase Dashboard.**

Abrir proyecto `witcgfylutplgfxvzoab` → SQL Editor → pegar contenido de 0052 → Run. Verificar que no hay errores.

- [ ] **Step 1.4: Verificación SQL.**

En SQL Editor, ejecutar:

```sql
-- Verificar CHECK ampliado
select pg_get_constraintdef(oid) from pg_constraint where conname = 'users_role_check';
-- Esperado: CHECK ((role IN ('admin','supervisor','operator','client')))

-- Verificar tabla
select count(*) from public.client_users;
-- Esperado: 0

-- Verificar helper
select public.is_client_of('00000000-0000-0000-0000-000000000000'::uuid);
-- Esperado: false

-- Verificar columna
select column_name from information_schema.columns
where table_name='requirement_messages' and column_name='visible_to_client';
-- Esperado: una fila
```

- [ ] **Step 1.5: Commit.**

```bash
git add supabase/migrations/0052_client_portal_foundations.sql
git commit -m "feat(db): fundamentos de portal cliente — rol client, client_users, RLS"
```

---

## Task 2 — Tipos en `src/types/db.ts`

**Files:**
- Modify: `src/types/db.ts`

- [ ] **Step 2.1: Leer el archivo completo para entender el estilo actual.**

```bash
# Revisa al menos las líneas 1-180
```

- [ ] **Step 2.2: Ampliar `UserRole`.**

Cambiar en línea 52:
```ts
export type UserRole = 'admin' | 'supervisor' | 'operator' | 'client'
```

- [ ] **Step 2.3: Añadir tipo `ClientUserRole` y la fila `client_users` al `Database`.**

En la sección donde viven los otros tipos de tabla:
```ts
export type ClientUserRole = 'owner' | 'viewer'

export interface ClientUser {
  id: string
  user_id: string
  client_id: string
  role: ClientUserRole
  created_at: string
}
```

Y en `Database['public']['Tables']`:
```ts
client_users: {
  Row: ClientUser
  Insert: Omit<ClientUser, 'id' | 'created_at'> & {
    id?: string
    created_at?: string
  }
  Update: Partial<Omit<ClientUser, 'id' | 'user_id' | 'client_id'>>
}
```

- [ ] **Step 2.4: Añadir tipo `RenewalRequest` y la tabla.**

```ts
export type RenewalRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed'

export interface RenewalRequest {
  id: string
  client_id: string
  requested_by: string
  from_cycle_id: string | null
  status: RenewalRequestStatus
  rollover_items_json: Array<{ requirement_id: string; action: 'carry' | 'drop' }>
  addons_json: Record<string, unknown>
  admin_notes: string | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
}
```

Y registrar en `Database['public']['Tables']`.

- [ ] **Step 2.5: Añadir `visible_to_client` a `RequirementMessage`.**

Localizar `RequirementMessage`/`requirement_messages.Row` en el archivo. Añadir:
```ts
visible_to_client: boolean
```
En `Insert` dejar opcional (default en DB): `visible_to_client?: boolean`.

- [ ] **Step 2.6: Verificar tipos.**

```bash
npm run lint
# y
npx tsc --noEmit
```

Expected: 0 errores nuevos. Baseline: 9 warnings react-hooks pre-existentes ok.

- [ ] **Step 2.7: Commit.**

```bash
git add src/types/db.ts
git commit -m "feat(types): rol client, ClientUser, RenewalRequest, visible_to_client"
```

---

## Task 3 — Helpers de permisos y cliente activo

**Files:**
- Modify: `src/lib/domain/permissions.ts`
- Create: `src/lib/domain/permissions.test.ts`
- Create: `src/lib/supabase/active-client.ts`
- Create: `src/lib/supabase/active-client.test.ts`

- [ ] **Step 3.1: Test — extender `permissions.test.ts`.**

Crear el archivo (no existe actualmente). Contenido:

```ts
import { describe, it, expect } from 'vitest'
import {
  isClientRole,
  isStaffRole,
  canAccessPortal,
} from './permissions'

describe('permissions — roles de portal', () => {
  it('isClientRole detecta solo role=client', () => {
    expect(isClientRole('client')).toBe(true)
    expect(isClientRole('admin')).toBe(false)
    expect(isClientRole('supervisor')).toBe(false)
    expect(isClientRole('operator')).toBe(false)
    expect(isClientRole(null)).toBe(false)
    expect(isClientRole(undefined)).toBe(false)
  })

  it('isStaffRole detecta admin/supervisor/operator', () => {
    expect(isStaffRole('admin')).toBe(true)
    expect(isStaffRole('supervisor')).toBe(true)
    expect(isStaffRole('operator')).toBe(true)
    expect(isStaffRole('client')).toBe(false)
    expect(isStaffRole(null)).toBe(false)
  })

  it('canAccessPortal es equivalente a isClientRole', () => {
    expect(canAccessPortal('client')).toBe(true)
    expect(canAccessPortal('admin')).toBe(false)
  })
})
```

- [ ] **Step 3.2: Correr el test y confirmar que falla.**

```bash
npx vitest run src/lib/domain/permissions.test.ts
```
Expected: FAIL — `isClientRole is not exported`.

- [ ] **Step 3.3: Implementar en `permissions.ts`.**

Añadir al final del archivo:
```ts
export const isClientRole = (role: UserRole | null | undefined): role is 'client' =>
  role === 'client'

export const isStaffRole = (role: UserRole | null | undefined): boolean =>
  role === 'admin' || role === 'supervisor' || role === 'operator'

export const canAccessPortal = (role: UserRole | null | undefined): boolean =>
  isClientRole(role)
```

- [ ] **Step 3.4: Correr el test y confirmar que pasa.**

```bash
npx vitest run src/lib/domain/permissions.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 3.5: Crear `src/lib/supabase/active-client.ts`.**

```ts
import { cookies } from 'next/headers'
import { createClient } from './server'

export const ACTIVE_CLIENT_COOKIE = 'portal_active_client'

/** Devuelve todos los client_id vinculados al user autenticado. */
export async function getActiveClientIds(): Promise<string[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)

  if (error || !data) return []
  return data.map((r) => r.client_id)
}

/**
 * Resuelve el client_id activo leyendo la cookie; si la cookie no está o
 * apunta a un client_id fuera de la lista del user, devuelve null.
 * Los server components deben redirigir a /portal/seleccionar-marca cuando
 * esta función retorna null pero getActiveClientIds() tiene al menos uno.
 */
export async function getActiveClientId(): Promise<string | null> {
  const ids = await getActiveClientIds()
  if (ids.length === 0) return null

  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value

  if (fromCookie && ids.includes(fromCookie)) return fromCookie
  if (ids.length === 1) return ids[0]

  return null
}
```

- [ ] **Step 3.6: Test para `active-client.ts`.**

Este archivo depende de `cookies()` y del supabase client, ambos difíciles de mockear. **Saltarse TDD aquí** — verificación se hace en el end-to-end del Task 10. Añadir un comentario al tope del archivo:

```ts
// Testing strategy: cubierto por el flujo end-to-end en Task 10 (no unit test).
// Mockear cookies() + Supabase introduce más fragilidad que valor.
```

- [ ] **Step 3.7: Commit.**

```bash
git add src/lib/domain/permissions.ts src/lib/domain/permissions.test.ts src/lib/supabase/active-client.ts
git commit -m "feat(permissions): helpers isClientRole/isStaffRole y active-client"
```

---

## Task 4 — Middleware de gating

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 4.1: Confirmar que NO existe `middleware.ts` ni `src/middleware.ts`.**

```bash
ls src/middleware.ts 2>/dev/null || echo "no existe"
ls middleware.ts 2>/dev/null || echo "no existe"
```
Expected: "no existe" en ambos.

- [ ] **Step 4.2: Leer la guía oficial de middleware de Next 16.**

```bash
ls node_modules/next/dist/docs/
# Identificar el archivo de middleware y leerlo. NO asumir la API de Next 14/15.
```

Puntos críticos a confirmar:
- ¿La función debe ser `export default` o `export async function middleware`?
- Firma de `NextResponse.redirect(new URL(..., request.url))` sigue igual.
- `export const config = { matcher: [...] }` sigue vigente.

- [ ] **Step 4.3: Crear `src/middleware.ts`.**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const STAFF_PREFIXES = [
  '/dashboard',
  '/clients',
  '/pipeline',
  '/plans',
  '/calendario',
  '/inbox',
  '/tiempo',
  '/reports',
  '/renewals',
  '/billing',
  '/users',
  '/profile',
]

const PORTAL_PREFIX = '/portal'

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Si no hay sesión y la ruta pide auth, dejar que el layout haga redirect a /login.
  if (!user) return response

  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = appUser?.role

  // Cliente intentando entrar al área staff → redirect a /portal/dashboard.
  if (role === 'client' && startsWithAny(pathname, STAFF_PREFIXES)) {
    return NextResponse.redirect(new URL('/portal/dashboard', request.url))
  }

  // Staff intentando entrar al portal → redirect a /dashboard.
  if (role && role !== 'client' && pathname.startsWith(PORTAL_PREFIX)) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // todo menos archivos estáticos y api/auth callback
    '/((?!_next/static|_next/image|favicon.ico|api/auth|auth/signout).*)',
  ],
}
```

- [ ] **Step 4.4: Build para validar.**

```bash
npm run build
```
Expected: build pasa sin errores.

- [ ] **Step 4.5: Commit.**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): gating por rol entre /portal y \u00e1rea staff"
```

---

## Task 5 — Redirect por rol en login

**Files:**
- Modify: `src/app/(auth)/login/LoginForm.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 5.1: Actualizar `LoginForm.tsx`.**

Reemplazar el bloque `router.push('/dashboard')` (líneas 50–51) por:

```tsx
// Leer rol para decidir destino
const { data: { user } } = await supabase.auth.getUser()
let destination = '/dashboard'
if (user) {
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (appUser?.role === 'client') destination = '/portal/dashboard'
}

router.push(destination)
router.refresh()
```

- [ ] **Step 5.2: Defensa en `(app)/layout.tsx`.**

Entre las líneas 44 y 46 (después de `if (!appUser) redirect('/login')`), añadir:

```tsx
if (appUser.role === 'client') redirect('/portal/dashboard')
```

- [ ] **Step 5.3: Lint + build.**

```bash
npm run lint
npm run build
```
Expected: 0 errores nuevos.

- [ ] **Step 5.4: Commit.**

```bash
git add src/app/\(auth\)/login/LoginForm.tsx src/app/\(app\)/layout.tsx
git commit -m "feat(auth): login redirige seg\u00fan rol y staff-layout bloquea clients"
```

---

## Task 6 — Layout y sidebar del portal

**Files:**
- Create: `src/app/(portal)/layout.tsx`
- Create: `src/components/portal/PortalSidebar.tsx`
- Create: `src/components/portal/ActiveClientSwitcher.tsx`
- Create: `src/app/(portal)/seleccionar-marca/page.tsx`
- Create: `src/app/actions/portalActiveClient.ts`

- [ ] **Step 6.1: `portalActiveClient.ts` — server action para setear la cookie.**

```ts
'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_CLIENT_COOKIE } from '@/lib/supabase/active-client'

export async function setActiveClient(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!data) throw new Error('No tienes acceso a esa marca')

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_CLIENT_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath('/portal', 'layout')
}
```

- [ ] **Step 6.2: `PortalSidebar.tsx`.**

Esqueleto similar a `Sidebar.tsx` pero con items del portal y sin `allowedRoles`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ActiveClientSwitcher } from './ActiveClientSwitcher'

interface PortalNavItem { href: string; label: string; icon: React.ReactNode }

const navItems: PortalNavItem[] = [
  { href: '/portal/dashboard',   label: 'Dashboard',     icon: /* svg */ null },
  { href: '/portal/pipeline',    label: 'Pipeline',      icon: /* svg */ null },
  { href: '/portal/calendario',  label: 'Calendario',    icon: /* svg */ null },
  { href: '/portal/facturacion', label: 'Facturaci\u00f3n',    icon: /* svg */ null },
  { href: '/portal/empresa',     label: 'Mi empresa',    icon: /* svg */ null },
  { href: '/portal/config',      label: 'Configuraci\u00f3n',  icon: /* svg */ null },
]

interface PortalSidebarProps {
  clientOptions: Array<{ id: string; name: string; logo_url: string | null }>
  activeClientId: string
  clientDisplayName: string
}

export function PortalSidebar({ clientOptions, activeClientId, clientDisplayName }: PortalSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 hidden md:flex flex-col bg-fm-surface-container-lowest border-r border-fm-outline-variant/30 shadow-sm">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-fm-outline-variant/20">
          <div className="w-9 h-9 rounded-xl signature-gradient flex items-center justify-center">
            <span className="text-white font-bold text-sm">FM</span>
          </div>
          <div>
            <p className="font-bold text-fm-on-surface text-sm leading-tight">{clientDisplayName}</p>
            <p className="text-fm-on-surface-variant text-xs">Portal del cliente</p>
          </div>
        </div>

        {clientOptions.length > 1 && (
          <div className="px-3 py-3 border-b border-fm-outline-variant/20">
            <ActiveClientSwitcher options={clientOptions} activeId={activeClientId} />
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-fm-primary/10 text-fm-primary'
                    : 'text-fm-on-surface-variant hover:bg-fm-background hover:text-fm-on-surface'
                )}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="px-3 pb-4 border-t border-fm-outline-variant/20 pt-3">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-fm-on-surface-variant hover:bg-red-50 hover:text-fm-error"
            >
              Cerrar sesi\u00f3n
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
```

(Nota: reemplazar `/* svg */ null` por SVG inline similar al de `Sidebar.tsx`. Dejados vacíos para no inflar este plan.)

- [ ] **Step 6.3: `ActiveClientSwitcher.tsx`.**

```tsx
'use client'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setActiveClient } from '@/app/actions/portalActiveClient'

interface Props {
  options: Array<{ id: string; name: string }>
  activeId: string
}

export function ActiveClientSwitcher({ options, activeId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <select
      className="w-full text-sm rounded-lg border border-fm-outline-variant/40 bg-white px-2 py-1.5"
      defaultValue={activeId}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value
        startTransition(async () => {
          await setActiveClient(next)
          router.refresh()
        })
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 6.4: `(portal)/layout.tsx`.**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId, getActiveClientIds } from '@/lib/supabase/active-client'
import { PortalSidebar } from '@/components/portal/PortalSidebar'
import { UserProvider } from '@/contexts/UserContext'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()

  if (!appUser) redirect('/login')
  if (appUser.role !== 'client') redirect('/dashboard')

  const ids = await getActiveClientIds()
  if (ids.length === 0) {
    // Cliente sin ninguna marca asignada. Sign-out defensivo.
    redirect('/auth/signout')
  }

  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const { data: clientOptions } = await supabase
    .from('clients')
    .select('id, name, logo_url')
    .in('id', ids)

  const active = clientOptions?.find((c) => c.id === activeId)
  const clientDisplayName = active?.name ?? 'Mi empresa'

  return (
    <UserProvider user={appUser}>
      <div className="flex h-screen overflow-hidden bg-fm-background">
        <PortalSidebar
          clientOptions={clientOptions ?? []}
          activeClientId={activeId}
          clientDisplayName={clientDisplayName}
        />
        <div className="flex flex-col flex-1 md:ml-64 overflow-hidden">
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </UserProvider>
  )
}
```

- [ ] **Step 6.5: `seleccionar-marca/page.tsx` — intersticial para ≥2 marcas.**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientIds } from '@/lib/supabase/active-client'
import { setActiveClient } from '@/app/actions/portalActiveClient'

export default async function SeleccionarMarca() {
  const ids = await getActiveClientIds()
  if (ids.length === 0) redirect('/login')
  if (ids.length === 1) {
    await setActiveClient(ids[0])
    redirect('/portal/dashboard')
  }

  const supabase = await createClient()
  const { data: clientes } = await supabase
    .from('clients')
    .select('id, name, logo_url')
    .in('id', ids)

  return (
    <div className="min-h-screen flex items-center justify-center bg-fm-background p-6">
      <div className="max-w-md w-full glass-panel p-6">
        <h1 className="text-xl font-semibold mb-4 text-fm-on-surface">Elige una marca</h1>
        <p className="text-sm text-fm-on-surface-variant mb-5">
          Tu cuenta tiene acceso a varias marcas. Selecciona con cu\u00e1l deseas trabajar.
        </p>
        <div className="space-y-2">
          {clientes?.map((c) => (
            <form key={c.id} action={async () => { 'use server'; await setActiveClient(c.id); redirect('/portal/dashboard') }}>
              <button className="w-full text-left px-4 py-3 rounded-xl border border-fm-outline-variant/40 hover:bg-fm-primary/5">
                {c.name}
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.6: Lint + build.**

```bash
npm run lint && npm run build
```
Expected: pasa.

- [ ] **Step 6.7: Commit.**

```bash
git add src/app/\(portal\) src/components/portal src/app/actions/portalActiveClient.ts
git commit -m "feat(portal): layout, sidebar y selector de marca activa"
```

---

## Task 7 — Stubs de páginas `/portal/*`

**Files:**
- Create: `src/app/(portal)/portal/dashboard/page.tsx`
- Create: `src/app/(portal)/portal/pipeline/page.tsx`
- Create: `src/app/(portal)/portal/calendario/page.tsx`
- Create: `src/app/(portal)/portal/facturacion/page.tsx`
- Create: `src/app/(portal)/portal/empresa/page.tsx`
- Create: `src/app/(portal)/portal/config/page.tsx`

- [ ] **Step 7.1: Crear los 6 stubs con el mismo patrón.**

Ejemplo para `dashboard/page.tsx`:

```tsx
export default function PortalDashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-fm-on-surface mb-2">Dashboard</h1>
      <p className="text-sm text-fm-on-surface-variant">
        Pronto aqu\u00ed ver\u00e1s el resumen de tu ciclo, progreso semanal y pr\u00f3ximos deadlines.
      </p>
    </div>
  )
}
```

Repetir con título distinto para: `Pipeline`, `Calendario`, `Facturaci\u00f3n`, `Mi empresa`, `Configuraci\u00f3n`.

- [ ] **Step 7.2: Arrancar dev y abrir cada ruta.**

```bash
npm run dev
```

Visitar `/portal/dashboard`, `/portal/pipeline`, `/portal/calendario`, `/portal/facturacion`, `/portal/empresa`, `/portal/config`. Expected: layout con sidebar renderiza, cada página muestra su título de stub. (Sin usuario autenticado redirige a `/login` — correcto.)

- [ ] **Step 7.3: Commit.**

```bash
git add src/app/\(portal\)/portal
git commit -m "feat(portal): stubs de dashboard, pipeline, calendario, facturaci\u00f3n, empresa, config"
```

---

## Task 8 — Acción de invitación/revocación

**Files:**
- Create: `src/app/actions/clientUsers.ts`

- [ ] **Step 8.1: Leer `src/lib/supabase/admin.ts`.**

Confirmar que `createAdminClient()` existe y usa service-role. Necesario para `auth.admin.inviteUserByEmail`.

- [ ] **Step 8.2: Crear la acción.**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (appUser?.role !== 'admin') throw new Error('Solo admins pueden gestionar accesos de portal')
  return { supabase, adminUserId: user.id }
}

export async function inviteClientUser(params: {
  clientId: string
  email: string
  fullName?: string
}) {
  const { clientId, email, fullName } = params
  const clean = email.trim().toLowerCase()
  if (!clean || !clean.includes('@')) throw new Error('Email inv\u00e1lido')

  await requireAdmin()
  const admin = createAdminClient()

  // 1) Buscar si ya existe el auth user.
  const { data: existing } = await admin
    .from('users')
    .select('id, role')
    .eq('email', clean)  // si users.email no existe, ajustar: listar via auth.admin.listUsers
    .maybeSingle()

  let userId: string
  if (existing) {
    userId = existing.id
    if (existing.role !== 'client') {
      throw new Error(
        `${clean} ya tiene cuenta como ${existing.role}. No se puede convertir en cliente.`
      )
    }
  } else {
    // 2) Invitar por email v\u00eda Supabase Auth.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(clean, {
      data: { role: 'client', full_name: fullName ?? null },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/portal/dashboard`,
    })
    if (error || !data.user) throw new Error(`No se pudo enviar invitaci\u00f3n: ${error?.message}`)
    userId = data.user.id

    // 3) Insertar fila en public.users con role=client.
    const { error: upsertErr } = await admin.from('users').upsert({
      id: userId,
      email: clean,
      full_name: fullName ?? null,
      role: 'client',
    })
    if (upsertErr) throw new Error(`No se pudo registrar el usuario: ${upsertErr.message}`)
  }

  // 4) Vincular al cliente.
  const { error: linkErr } = await admin
    .from('client_users')
    .upsert({ user_id: userId, client_id: clientId, role: 'owner' },
            { onConflict: 'user_id,client_id' })
  if (linkErr) throw new Error(`No se pudo vincular al cliente: ${linkErr.message}`)

  revalidatePath(`/clients/${clientId}`)
}

export async function revokeClientUser(params: { clientId: string; userId: string }) {
  await requireAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .from('client_users')
    .delete()
    .eq('client_id', params.clientId)
    .eq('user_id', params.userId)
  if (error) throw new Error(`No se pudo revocar acceso: ${error.message}`)

  revalidatePath(`/clients/${params.clientId}`)
}

export async function listClientUsers(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('client_users')
    .select('id, user_id, role, created_at, users:users!inner(id, full_name, email, role)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}
```

> **Ajuste si `public.users.email` no existe:** usar `admin.auth.admin.listUsers({ filter: \`email.eq.${clean}\` })` o similar para encontrar al usuario por email. Validar con `src/types/db.ts` la forma real de la tabla `users` antes de implementar.

- [ ] **Step 8.3: Validar con lint/build.**

```bash
npm run lint && npm run build
```

- [ ] **Step 8.4: Commit.**

```bash
git add src/app/actions/clientUsers.ts
git commit -m "feat(actions): invitar y revocar usuarios de portal de cliente"
```

---

## Task 9 — Card de invitación en `/clients/[id]`

**Files:**
- Create: `src/components/clients/ClientPortalInvite.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 9.1: Crear `ClientPortalInvite.tsx`.**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { inviteClientUser, revokeClientUser } from '@/app/actions/clientUsers'

interface Props {
  clientId: string
  users: Array<{
    id: string
    user_id: string
    role: string
    users: { id: string; full_name: string | null; email: string | null; role: string } | null
  }>
}

export function ClientPortalInvite({ clientId, users }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    startTransition(async () => {
      try {
        await inviteClientUser({ clientId, email, fullName: name || undefined })
        setEmail(''); setName(''); setMsg('Invitaci\u00f3n enviada')
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Error al invitar')
      }
    })
  }

  function revoke(userId: string) {
    startTransition(async () => {
      try { await revokeClientUser({ clientId, userId }) }
      catch (err) { setMsg(err instanceof Error ? err.message : 'Error al revocar') }
    })
  }

  return (
    <section className="glass-panel p-5">
      <h3 className="text-base font-semibold text-fm-on-surface mb-1">Portal del cliente</h3>
      <p className="text-sm text-fm-on-surface-variant mb-4">
        Invita a los contactos de este cliente para que accedan a su propio portal.
      </p>

      <form onSubmit={invite} className="flex flex-col md:flex-row gap-2 mb-4">
        <input
          type="email"
          required
          placeholder="email@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Nombre (opcional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-fm-primary text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Enviando\u2026' : 'Invitar'}
        </button>
      </form>

      {msg && <p className="text-sm mb-3 text-fm-on-surface-variant">{msg}</p>}

      <div className="space-y-1.5">
        {users.length === 0 && (
          <p className="text-sm text-fm-outline-variant">A\u00fan no hay contactos con acceso al portal.</p>
        )}
        {users.map((link) => (
          <div key={link.id} className="flex items-center justify-between rounded-lg border border-fm-outline-variant/30 px-3 py-2">
            <div className="text-sm">
              <p className="font-medium text-fm-on-surface">{link.users?.full_name ?? link.users?.email ?? '(sin nombre)'}</p>
              <p className="text-xs text-fm-on-surface-variant">{link.users?.email}</p>
            </div>
            <button
              onClick={() => revoke(link.user_id)}
              disabled={isPending}
              className="text-sm text-fm-error hover:underline disabled:opacity-50"
            >
              Revocar
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 9.2: Integrar en `clients/[id]/page.tsx`.**

Al final de la página (o en la pestaña "Detalles" si aplica), añadir:

```tsx
// En el server component:
import { ClientPortalInvite } from '@/components/clients/ClientPortalInvite'
import { listClientUsers } from '@/app/actions/clientUsers'

// ...luego de obtener appUser:
const isAdmin = appUser?.role === 'admin'
const portalUsers = isAdmin ? await listClientUsers(params.id) : []

// En el JSX, solo si es admin:
{isAdmin && <ClientPortalInvite clientId={params.id} users={portalUsers} />}
```

- [ ] **Step 9.3: Lint + build.**

```bash
npm run lint && npm run build
```

- [ ] **Step 9.4: Commit.**

```bash
git add src/components/clients/ClientPortalInvite.tsx src/app/\(app\)/clients/\[id\]/page.tsx
git commit -m "feat(clients): card de invitaci\u00f3n al portal del cliente"
```

---

## Task 10 — Verificación end-to-end

**Nada de código nuevo.** Solo manual-QA.

- [ ] **Step 10.1: Restart dev server.**

```bash
npm run dev
```

- [ ] **Step 10.2: Como admin, invitar a un email que controles.**

1. Login con `danielmancia111203@gmail.com` / `usuario123`.
2. Ir a `/clients/<algún-cliente>` y encontrar la card "Portal del cliente".
3. Ingresar un email de prueba (gmail con alias `+cliente1` funciona) y clickear "Invitar".
4. Verificar que aparece en la lista "con acceso".

- [ ] **Step 10.3: Abrir el magic link del email.**

1. Fijar contraseña.
2. Confirmar que al loguear redirige a `/portal/dashboard`.

- [ ] **Step 10.4: Test de redirect cruzado.**

1. Como cliente autenticado, navegar manualmente a `/dashboard`. Expected: redirect a `/portal/dashboard`.
2. Cerrar sesión.
3. Login como staff. Navegar a `/portal/dashboard`. Expected: redirect a `/dashboard`.

- [ ] **Step 10.5: Test de RLS.**

En el Supabase Dashboard → SQL Editor, loguearse como el usuario cliente de prueba (con "Impersonate" si está disponible, o ejecutar con el token del cliente). Ejecutar:

```sql
select id, name from public.clients;
-- Esperado: SOLO la(s) marca(s) vinculada(s) al cliente.
select count(*) from public.requirements where client_id = '<otro-client-id>';
-- Esperado: 0
```

- [ ] **Step 10.6: Test de revocación.**

1. Como admin, clickear "Revocar" en la card.
2. Como cliente, refrescar `/portal/dashboard`. Expected: `(portal)/layout.tsx` llega a `ids.length === 0` y redirige a `/auth/signout` → login.

- [ ] **Step 10.7: Lint + build + test.**

```bash
npm run lint
npm run build
npm run test
```

Expected: 0 errores nuevos (baseline 9 react-hooks pre-existentes ok). Tests pasan — 42 previos + 3 nuevos de `permissions.test.ts` = 45.

---

## Siguiente

Fase 1 (Dashboard + Mi Empresa) tiene su propio brainstorm + plan. No abrir en este plan.

**Merge strategy:** al cerrar Fase 0, hacer PR `portal-cliente-fase-0` → `qa-reports-logo-upload`. Revisar que Supabase de producción ya tenga la migración antes de mergear.
