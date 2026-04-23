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

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
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

    // Rule 2: clients trying to access staff prefixes → /portal/dashboard
    if (role === 'client' && startsWithAny(pathname, STAFF_PREFIXES)) {
      return NextResponse.redirect(new URL('/portal/dashboard', request.url))
    }

    // Rule 3: staff trying to access /portal/* → /dashboard
    if (role && role !== 'client' && pathname.startsWith(PORTAL_PREFIX)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

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
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|icons/|mockup-calendario.html).*)',
  ],
}
