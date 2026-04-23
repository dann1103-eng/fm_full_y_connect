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
          Tu cuenta tiene acceso a varias marcas. Selecciona con cuál deseas trabajar.
        </p>
        <div className="space-y-2">
          {clientes?.map((c) => (
            <form
              key={c.id}
              action={async () => {
                'use server'
                await setActiveClient(c.id)
                redirect('/portal/dashboard')
              }}
            >
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
