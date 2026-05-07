'use server'

import { revalidatePath } from 'next/cache'

export async function revalidatePipelineAfterMove(clientId?: string) {
  revalidatePath('/pipeline')
  revalidatePath('/calendario')
  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }
  return { ok: true }
}
