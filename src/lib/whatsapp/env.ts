// Variables de entorno de la integración con WhatsApp Cloud API.
// Se centralizan aquí para fallar temprano si falta alguna.

export const GRAPH_API_VERSION = 'v22.0'
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export function getWhatsappEnv() {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  const appSecret = process.env.WHATSAPP_APP_SECRET
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const wabaId = process.env.WHATSAPP_WABA_ID ?? null

  const missing: string[] = []
  if (!verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN')
  if (!appSecret) missing.push('WHATSAPP_APP_SECRET')
  if (!token) missing.push('WHATSAPP_TOKEN')
  if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID')

  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno de WhatsApp: ${missing.join(', ')}. ` +
      'Configúralas en Vercel → Settings → Environment Variables.'
    )
  }

  return {
    verifyToken: verifyToken!,
    appSecret: appSecret!,
    token: token!,
    phoneNumberId: phoneNumberId!,
    wabaId,
  }
}
