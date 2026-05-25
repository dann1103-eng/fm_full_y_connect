'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/require-user'

export async function revalidatePipelineAfterMove(clientId?: string) {
  await requireUser()
  revalidatePath('/pipeline')
  revalidatePath('/calendario')
  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }
  return { ok: true }
}
