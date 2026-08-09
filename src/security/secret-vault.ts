const SECRET_NAME = /(authorization|bearer|token|secret|password|passwd|pwd|api[_-]?key|apikey|session|sid|csrf|xsrf|cookie)/i
const JWT_VALUE = /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g

export function redactSecret(value: string): string {
  if (!value) return '<redacted>'
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '****'
  return `${trimmed.slice(0, 4)}${'*'.repeat(Math.min(12, trimmed.length - 4))}`
}

export function redactHarJson(harJson: string): string {
  const parsed = JSON.parse(harJson)
  return JSON.stringify(redactNode(parsed), null, 2)
}

function redactNode(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (SECRET_NAME.test(key)) return redactSecret(value)
    if (key === 'url') return redactUrl(value)
    return value.replace(JWT_VALUE, (match) => redactSecret(match))
  }
  if (Array.isArray(value)) return value.map((item) => redactNode(item, key))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  if (typeof record.name === 'string' && 'value' in record && SECRET_NAME.test(record.name)) {
    return { ...record, value: typeof record.value === 'string' ? redactSecret(record.value) : '<redacted>' }
  }

  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(record)) {
    out[childKey] = redactNode(childValue, childKey)
  }
  return out
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const name of Array.from(url.searchParams.keys())) {
      if (SECRET_NAME.test(name)) url.searchParams.set(name, redactSecret(url.searchParams.get(name) ?? ''))
    }
    return url.toString().replace(JWT_VALUE, (match) => redactSecret(match))
  } catch {
    return value.replace(JWT_VALUE, (match) => redactSecret(match))
  }
}
