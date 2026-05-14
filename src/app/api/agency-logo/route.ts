import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// No cachear en el edge — la imagen puede cambiar cuando el admin actualiza el logo
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Leer el path almacenado en app_settings
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'agency_logo_url')
      .maybeSingle()

    if (!setting?.value) {
      return fallback()
    }

    // Extraer el nombre del archivo desde la URL guardada
    // Formato: https://...supabase.co/storage/v1/object/public/agency-assets/logo.png?v=...
    let filePath: string | null = null
    try {
      const url = new URL(setting.value)
      const match = url.pathname.match(/\/object\/(?:public\/)?agency-assets\/(.+)$/)
      filePath = match?.[1] ?? null
    } catch {
      filePath = null
    }

    if (!filePath) return fallback()

    // Descargar desde el bucket privado usando el service role key
    const { data, error } = await supabase.storage
      .from('agency-assets')
      .download(filePath)

    if (error || !data) return fallback()

    const buffer = await data.arrayBuffer()
    const contentType = data.type || 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        // Cachear 1 hora en el browser; si el admin actualiza el logo tardará max 1h en verse
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    return fallback()
  }
}

/** Redirige al ícono estático de fallback si no hay logo configurado */
function fallback() {
  return NextResponse.redirect(new URL('/icons/icon-192.png', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'))
}
