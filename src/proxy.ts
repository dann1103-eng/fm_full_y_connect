import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
      // Redirect already-authenticated users away from login
      if (user && pathname.startsWith('/login')) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      return supabaseResponse
    }

    // All other routes require auth
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
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
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|icons/).*)',
  ],
}
