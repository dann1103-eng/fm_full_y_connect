export function parseReqShareBody(body: string): { requirementId: string; title: string } | null {
  const trimmed = body.trim()
  if (!trimmed.startsWith('<<<req-share:')) return null
  const m = trimmed.match(/^<<<req-share:([^:]+):(.+)>>>$/)
  if (!m) return null
  return { requirementId: m[1], title: m[2].trim() }
}
