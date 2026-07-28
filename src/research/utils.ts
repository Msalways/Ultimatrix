import { createHash } from 'node:crypto'

export function stableId(prefix: string, parts: Array<string | number | undefined>): string {
  const raw = parts.filter(p => p !== undefined && p !== '').join(':')
  const hash = createHash('sha256').update(raw || prefix).digest('hex').slice(0, 12)
  return `${prefix}:${hash}`
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function words(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function inferNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const meaningful = [...segments].reverse().find((s: string) => !/^\d+$/.test(s) && !/^[0-9a-f-]{8,}$/i.test(s))
    return meaningful || parsed.hostname
  } catch {
    const segments = url.split('/').filter(Boolean)
    return [...segments].reverse().find((s: string) => !/^\d+$/.test(s)) || url
  }
}

export function normalizeName(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

export function looksLikeId(value: string): boolean {
  return /^\d+$/.test(value) || /^[0-9a-f]{8,}$/i.test(value) || /^[0-9a-f-]{16,}$/i.test(value)
}
