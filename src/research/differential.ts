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

/** Case-insensitive header lookup (transports vary in case preservation). */
function responseHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

/**
 * Normalize the mutated body modulo the declared input change before shape
 * comparison: query values that differ between the baseline and mutated
 * request URLs are the challenge surface, so the mutated value is mapped
 * back to the baseline value. A true echo then reads as "same page"
 * regardless of body size, while an unrelated page that happens to contain
 * the marker still reads as different. When the URLs carry no differing
 * query values this is the identity transform.
 */
function normalizeMutatedParams(baselineUrl?: string, mutatedUrl?: string, body?: string): string {
  try {
    if (!baselineUrl || !mutatedUrl || !body) return body ?? ''
    const baselineQuery = new URL(baselineUrl).searchParams
    const mutatedQuery = new URL(mutatedUrl).searchParams
    let out = body
    for (const name of new Set([...baselineQuery.keys(), ...mutatedQuery.keys()])) {
      const before = baselineQuery.get(name) ?? ''
      const after = mutatedQuery.get(name) ?? ''
      if (before && after && before !== after) out = out.split(after).join(before)
    }
    return out
  } catch {
    return body ?? ''
  }
}

export function compareResearchResponses(baseline: ResponseLike, mutated: ResponseLike, assertion: DifferentialAssertion = {}): DifferentialResult {
  const sameStatus = baseline.status === mutated.status
  const statusDelta = `${baseline.status} -> ${mutated.status}`
  const bodySimilarity = similarity(baseline.body, normalizeMutatedParams(baseline.url, mutated.url, mutated.body))
  let parsed: unknown
  try { parsed = JSON.parse(mutated.body ?? '') } catch { parsed = undefined }
  const matchedMarkers = (assertion.markers ?? []).filter(marker => marker.length > 0 && (mutated.body ?? '').includes(marker))
  const matchedFields = (assertion.jsonFields ?? []).filter(path => hasJsonPath(parsed, path))
  // Declared markers are also matched against the redirect target: a marker
  // URL landing verbatim in Location is the redirect analogue of a body
  // echo. Only fresh appearances count — a marker already present in the
  // baseline Location is not evidence of anything the mutation caused.
  const baselineLocation = responseHeader(baseline.headers, 'location') ?? ''
  const mutatedLocation = responseHeader(mutated.headers, 'location') ?? ''
  const locationMarkers = (assertion.markers ?? []).filter(marker =>
    marker.length > 0 && mutatedLocation.includes(marker) && !baselineLocation.includes(marker))
  const leaked = [...matchedMarkers.map(marker => `marker:${marker}`), ...matchedFields, ...locationMarkers.map(marker => `location:${marker}`)]
  const baselineDenied = [401, 403, 404].includes(baseline.status)
  const mutatedAllowed = mutated.status >= 200 && mutated.status < 300
  const authorizationMismatch = baselineDenied && mutatedAllowed && leaked.length > 0
  const locationEcho = sameStatus && locationMarkers.length > 0

  const interesting =
    authorizationMismatch ||
    locationEcho ||
    (mutatedAllowed && leaked.length > 0 && bodySimilarity > 0.2)

  const reason = interesting
    ? authorizationMismatch
      ? `Authorization boundary shifted (${statusDelta}) and the mutated response was allowed.`
      : locationEcho
        ? `Redirect target reflects declared marker: ${locationMarkers.map(m => `location:${m}`).join(', ')}.`
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

/**
 * A replay check has different semantics from a payload differential: the
 * exact same state-changing request is sent twice, so two successful
 * responses are a candidate signal that must be checked against the
 * resulting business state. A rejection on replay is expected secure
 * behavior, not a finding.
 */
export function compareStatefulReplayResponses(baseline: ResponseLike, replay: ResponseLike): DifferentialResult {
  const compared = compareResearchResponses(baseline, replay)
  const baselineAccepted = baseline.status >= 200 && baseline.status < 300
  const replayAccepted = replay.status >= 200 && replay.status < 300
  const interesting = baselineAccepted && replayAccepted

  return {
    ...compared,
    interesting,
    reason: interesting
      ? 'The exact state-changing request was accepted twice; verify the resulting business state before reporting.'
      : !baselineAccepted
        ? `The initial state-changing request was not accepted (${baseline.status}); replay behavior is inconclusive.`
        : `The replay was rejected with status ${replay.status}; this matches expected one-time behavior.`,
  }
}
