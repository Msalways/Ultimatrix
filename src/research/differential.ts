import type { DifferentialResult, ResponseLike } from './types'

const SENSITIVE_FIELD_PATTERNS = [
  /"?(email|phone|address|token|secret|api[_-]?key|password|role|permission|billing|ssn|dob)"?\s*[:=]/ig,
]

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

function leakedFields(body = ''): string[] {
  const fields = new Set<string>()
  for (const pattern of SENSITIVE_FIELD_PATTERNS) {
    for (const match of body.matchAll(pattern)) {
      fields.add(match[1])
    }
  }
  return [...fields]
}

export function compareResearchResponses(baseline: ResponseLike, mutated: ResponseLike): DifferentialResult {
  const sameStatus = baseline.status === mutated.status
  const statusDelta = `${baseline.status} -> ${mutated.status}`
  const bodySimilarity = similarity(baseline.body, mutated.body)
  const leaked = leakedFields(mutated.body)
  const baselineDenied = [401, 403, 404].includes(baseline.status)
  const mutatedAllowed = mutated.status >= 200 && mutated.status < 300
  const authorizationMismatch = baselineDenied && mutatedAllowed || (!sameStatus && mutatedAllowed && leaked.length > 0)

  const interesting =
    authorizationMismatch ||
    (mutatedAllowed && leaked.length > 0 && bodySimilarity > 0.2) ||
    (!sameStatus && mutatedAllowed && bodySimilarity > 0.5)

  const reason = interesting
    ? authorizationMismatch
      ? `Authorization boundary shifted (${statusDelta}) and the mutated response was allowed.`
      : leaked.length > 0
        ? `Mutated response contains sensitive-looking fields: ${leaked.join(', ')}.`
        : `Mutated response is allowed and similar enough to baseline (${bodySimilarity.toFixed(2)}).`
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
