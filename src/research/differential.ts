import type { DifferentialAssertion, DifferentialResult, ResponseLike } from './types'

function shingles(input: string): Set<string> {
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').slice(0, 20000)
  const result = new Set<string>()
  for (let i = 0; i < normalized.length - 4; i += 4) {
    result.add(normalized.slice(i, i + 8))
  }
  return result
}

function similarity(a = '', b = ''): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const left = shingles(a)
  const right = shingles(b)
  if (left.size === 0 && right.size === 0) return 1
  let intersection = 0
  for (const item of left) {
    if (right.has(item)) intersection++
  }
  return intersection / Math.max(1, new Set([...left, ...right]).size)
}

function hasJsonPath(value: unknown, path: string): boolean {
  let current = value
  for (const part of path.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || !(part in current)) return false
    current = (current as Record<string, unknown>)[part]
  }
  return true
}

export function compareResearchResponses(baseline: ResponseLike, mutated: ResponseLike, assertion: DifferentialAssertion = {}): DifferentialResult {
  const sameStatus = baseline.status === mutated.status
  const statusDelta = `${baseline.status} -> ${mutated.status}`
  const bodySimilarity = similarity(baseline.body, mutated.body)
  let parsed: unknown
  try { parsed = JSON.parse(mutated.body ?? '') } catch { parsed = undefined }
  const matchedMarkers = (assertion.markers ?? []).filter(marker => marker.length > 0 && (mutated.body ?? '').includes(marker))
  const matchedFields = (assertion.jsonFields ?? []).filter(path => hasJsonPath(parsed, path))
  const leaked = [...matchedMarkers.map(marker => `marker:${marker}`), ...matchedFields]
  const baselineDenied = [401, 403, 404].includes(baseline.status)
  const mutatedAllowed = mutated.status >= 200 && mutated.status < 300
  const authorizationMismatch = baselineDenied && mutatedAllowed && leaked.length > 0

  const interesting =
    authorizationMismatch ||
    (mutatedAllowed && leaked.length > 0 && bodySimilarity > 0.2)

  const reason = interesting
    ? authorizationMismatch
      ? `Authorization boundary shifted (${statusDelta}) and the mutated response was allowed.`
      : leaked.length > 0
        ? `Mutated response satisfies declared observables: ${leaked.join(', ')}.`
        : `Mutated response satisfies the declared differential.`
    : `No strong differential signal (${statusDelta}, similarity=${bodySimilarity.toFixed(2)}).`

  return {
    sameStatus,
    statusDelta,
    bodySimilarity,
    leakedFields: leaked,
    authorizationMismatch,
    interesting,
    reason,
  }
}
