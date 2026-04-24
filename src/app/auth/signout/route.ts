import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

async function handleSignout(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.signOut()
  return response
}

export async function GET(request: NextRequest) {
  return handleSignout(request)
}

export async function POST(request: NextRequest) {
  return handleSignout(request)
}
