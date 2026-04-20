/** Redes sociales soportadas en handles de cliente. */
export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin'

const BASE_URLS: Record<SocialNetwork, string> = {
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  tiktok: 'https://tiktok.com/@',
  youtube: 'https://youtube.com/',
  linkedin: 'https://linkedin.com/in/',
}

/** Construye una URL completa desde un handle o devuelve la URL si ya lo es.
 *  Acepta:
 *  - URLs completas (`https://...`) → se devuelven tal cual.
 *  - Handles con o sin `@` (`@fm`, `fm`) → se prefija con la base de la red.
 *  - LinkedIn con path (`company/fm`) → se respeta el path.
 *  - YouTube sin prefijo de canal → se prefija con `@`. */
export function socialUrl(network: SocialNetwork, handle: string): string {
  const h = handle.trim()
  if (/^https?:\/\//i.test(h)) return h
  const cleaned = h.replace(/^@/, '')
  if (network === 'linkedin' && cleaned.includes('/')) {
    return `https://linkedin.com/${cleaned}`
  }
  if (network === 'youtube' && !cleaned.startsWith('@') && !cleaned.startsWith('c/') && !cleaned.startsWith('channel/')) {
    return `https://youtube.com/@${cleaned}`
  }
  return BASE_URLS[network] + cleaned
}
