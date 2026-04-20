import type { ContentType } from '@/types/db'

/** Mapa central de iconos (Material Symbols) por tipo de contenido.
 *  Usado en dashboard, ficha de cliente, historial, y modales. */
export const CONTENT_ICONS: Record<ContentType, string> = {
  historia: 'smartphone',
  estatico: 'image',
  video_corto: 'movie',
  reel: 'videocam',
  short: 'slideshow',
  produccion: 'video_camera_front',
  reunion: 'groups',
  matriz_contenido: 'grid_view',
}
