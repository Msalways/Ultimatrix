const SECRET_NAME = /(authorization|bearer|token|secret|password|passwd|pwd|api[_-]?key|apikey|session|sid|csrf|xsrf|cookie)/i
const JWT_VALUE = /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g
const BEARER_SHAPE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}/g

export function redactValue(value: string): string {
  if (!value) return '<redacted>'
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '****'
  return `${trimmed.slice(0, 4)}${'*'.repeat(Math.min(12, trimmed.length - 4))}`
}

export const redactSecret = redactValue

/** Redact secret-shaped values (JWT, Bearer/Basic tokens) embedded in free-form text. */
export function redactString(text: string): string {
  return text
    .replace(JWT_VALUE, (match) => redactValue(match))
    .replace(BEARER_SHAPE, (match) => {
      const [scheme, token] = match.split(/\s+/)
      return `${scheme} ${redactValue(token)}`
    })
}

/** Redact sensitive HTTP header values (by header name + embedded JWT/token shapes). */
export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_NAME.test(name) ? redactValue(value) : redactString(value)
  }
  return out
}

export function redactHarJson(harJson: string): string {
  const parsed = JSON.parse(harJson)
  return JSON.stringify(redactObject(parsed), null, 2)
}

/** Deep-redact any structured value: key-named secrets, URLs, and embedded token shapes. */
export function redactObject(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (SECRET_NAME.test(key)) return redactValue(value)
    if (key === 'url') return redactUrl(value)
    return redactString(value)
  }
  if (Array.isArray(value)) return value.map((item) => redactObject(item, key))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  if (typeof record.name === 'string' && 'value' in record && SECRET_NAME.test(record.name)) {
    return { ...record, value: typeof record.value === 'string' ? redactValue(record.value) : '<redacted>' }
  }

  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(record)) {
    out[childKey] = redactObject(childValue, childKey)
  }
  return out
}

/** Redact artifact metadata (paths, contexts, labels) before durable persistence. */
export function redactArtifactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'path' || k === 'url' || k === 'context' || k === 'description' || k === 'label') {
      out[k] = typeof v === 'string' ? redactString(v) : v
    } else {
      out[k] = redactObject(v, k)
    }
  }
  return out
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const name of Array.from(url.searchParams.keys())) {
      if (SECRET_NAME.test(name)) url.searchParams.set(name, redactValue(url.searchParams.get(name) ?? ''))
    }
    return url.toString().replace(JWT_VALUE, (match) => redactValue(match))
  } catch {
    return value.replace(JWT_VALUE, (match) => redactValue(match))
  }
}
