import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'agency_logo_url')
    .maybeSingle()

  const agencyLogoUrl = (data?.value as string | null) ?? null

  return <LoginForm agencyLogoUrl={agencyLogoUrl} />
}
