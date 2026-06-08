// Constantes compartidas entre el server action del portal y el helper del
// bot de WhatsApp. Vive fuera del archivo 'use server' (que solo puede
// exportar funciones async) y fuera de un archivo `use client` para que sea
// importable desde ambos contextos.

import type { ContentType } from '@/types/db'

export const ALLOWED_REQUEST_TYPES = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
  'produccion',
  'reunion',
] as const satisfies readonly ContentType[]

export const SCHEDULED_TYPES = ['reunion', 'produccion'] as const satisfies readonly ContentType[]
