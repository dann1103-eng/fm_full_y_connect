import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

// Debe coincidir con IMPERSONATE_COOKIE en src/lib/auth/effective-user.ts
const IMPERSONATE_COOKIE = 'fm_impersonate_user_id'

/** Rutas de cron/servicio con auth por secreto en el handler (una por cada entrada de vercel.json). */
const SECRET_AUTH_API_PREFIXES = [
  '/api/ai-jobs',
  '/api/billing/due-reminders',
  '/api/matrices/convert',
]

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
  // Webhooks de proveedores externos (n1co, etc.) no usan auth de Supabase —
  // se autentican vía firma HMAC dentro del handler. Bypass total del middleware.
  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next({ request })
  }

  // Webhook de WhatsApp Cloud API — verifica token (GET) y firma HMAC (POST)
  // dentro del handler. Meta no sigue redirects ni envía cookies de Supabase.
  if (request.nextUrl.pathname.startsWith('/api/whatsapp/webhook')) {
    return NextResponse.next({ request })
  }

  // Endpoints de cron/servicio: se autentican DENTRO del handler con `Authorization: Bearer
  // $CRON_SECRET` (lo manda Vercel Cron) o `x-trigger-secret`, y no llevan sesión de Supabase.
  // Sin esta salida, el middleware los responde con un 307 a /login: el cron recibe un redirect
  // en vez de un error, Vercel lo da por bueno y el trabajo NUNCA corre, sin un solo log.
  // Al agregar un cron a vercel.json hay que agregarlo también aquí.
  if (startsWithAny(request.nextUrl.pathname, SECRET_AUTH_API_PREFIXES)) {
    return NextResponse.next({ request })
  }

  // Callback público para flujo de pago embebido n1co — n1co redirige el iframe
  // a /n1co-callback y necesita cargarse sin auth (el iframe no tiene cookies).
  if (request.nextUrl.pathname.startsWith('/n1co-callback')) {
    return NextResponse.next({ request })
  }

  try {
    let supabaseResponse = NextResponse.next({ request })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Guard: if env vars are missing, fail safe to login redirect
    if (!supabaseUrl || !supabaseKey) {
      console.error('[proxy] Missing Supabase env vars')
      const { pathname } = request.nextUrl
      if (!pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
        return NextResponse.redirect(new URL('/login', request.url))
      }
      return supabaseResponse
    }

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl

    // Public routes — /login and /auth/* (signout route handler)
    if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
      // Redirect already-authenticated users away from login (role-aware)
      if (user && pathname.startsWith('/login')) {
        const { data: appUser } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
        const dest =
          appUser?.role === 'client' ? '/portal/dashboard' : '/dashboard'
        return NextResponse.redirect(new URL(dest, request.url))
      }
      return supabaseResponse
    }

    // All other routes require auth
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Fetch role for authenticated, non-public requests
    let role: string | null = null
    const { data: appUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    role = appUser?.role ?? null

    // Detectar suplantación: si el real es admin y la cookie apunta a otro
    // user, resolver el rol "efectivo" del usuario suplantado para que las
    // reglas de routing usen ese rol y no el del admin real.
    const impersonateId = request.cookies.get(IMPERSONATE_COOKIE)?.value
    let effectiveRole: string | null = role
    if (impersonateId && impersonateId !== user.id && role === 'admin') {
      const { data: targetUser } = await supabase
        .from('users')
        .select('role')
        .eq('id', impersonateId)
        .maybeSingle()
      // Solo suplantar si el target NO es otro admin
      if (targetUser?.role && targetUser.role !== 'admin') {
        effectiveRole = targetUser.role
      }
    }

    // Rule 2: clientes (reales o suplantados) en rutas staff → portal
    if (effectiveRole === 'client' && startsWithAny(pathname, STAFF_PREFIXES)) {
      return NextResponse.redirect(new URL('/portal/dashboard', request.url))
    }

    // Rule 3: staff (real, no suplantando cliente) en /portal/* → /dashboard
    if (effectiveRole && effectiveRole !== 'client' && pathname.startsWith(PORTAL_PREFIX)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    supabaseResponse.headers.set('x-pathname', pathname)
    return supabaseResponse
  } catch (error) {
    console.error('[proxy] Unhandled error:', error)
    // Fail safe: never crash — redirect to login for protected routes
    const { pathname } = request.nextUrl
    if (!pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next({ request })
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|icons/|mockup-calendario.html|ringtone\\.mp3).*)',
  ],
}
