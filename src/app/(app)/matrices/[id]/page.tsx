import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { canManageMatrices } from '@/lib/domain/permissions'
import { TopNav } from '@/components/layout/TopNav'
import { loadMatrixEditorData } from '@/lib/data/matrices'
import { loadBrandProfile } from '@/lib/data/brand'
import { hasUsableBrandProfile } from '@/lib/domain/brand'
import { MatrixEditor } from '@/components/matrices/MatrixEditor'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (!canManageMatrices(ctx.appUser.role)) redirect('/dashboard')
  // Un id que no es UUID haría fallar la consulta (error de sintaxis de uuid en Postgres) y el loader lanzaría.
  if (!UUID_RE.test(id)) redirect('/matrices')

  const supabase = await createClient()
  const data = await loadMatrixEditorData(supabase, id)
  // Redirige en vez de 404: tras borrar la matriz, la revalidación re-renderiza esta página y no debe
  // mostrar un "no encontrado" antes de que el editor navegue a la lista.
  if (!data) redirect('/matrices')

  // Compuerta de "Generar con IA" (bloque 3). Aparte de `loadMatrixEditorData` a propósito: el handler padre
  // llama a ese loader dos veces por corrida y ya lee el perfil por su cuenta. Un fallo al leerlo (sin la
  // migración 0131, o un error de consulta) NO tumba el editor: deja el botón deshabilitado con el motivo.
  const brandReady = await loadBrandProfile(supabase, data.matrix.client_id)
    .then((profile) => hasUsableBrandProfile(profile))
    .catch((e: unknown) => {
      console.error('[matrices/[id]] loadBrandProfile', e)
      return null
    })

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title={data.matrix.title || 'Matriz'} backHref="/matrices" />
      <div className="flex-1 p-3 sm:p-6 max-w-6xl mx-auto w-full">
        {/* key: al navegar a otra matriz (p. ej. tras duplicar) el estado local arranca de cero. */}
        <MatrixEditor key={data.matrix.id} data={data} brandReady={brandReady} />
      </div>
    </div>
  )
}
