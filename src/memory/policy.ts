/**
 * Memory Policy — the boundary between workflow/project memory and global
 * (cross-engagement) memory.
 *
 * Slice 11. Global memory exists ONLY for safe user preferences and anonymized
 * technique patterns. Target-sensitive content — secrets, target URLs,
 * hostnames, auth state, browser storage values, and request/response payloads
 * — is rerouted to project memory when workflow-scoped, and BLOCKED (fail
 * closed) when someone tries to write it globally.
 *
 * The detector is shape-based (reuses the secret-vault shapes + URL/hostname
 * shape + structural HTTP-record detection), never vocab/substring inference.
 * Policy decisions are recorded to the DecisionLedger for inspectability.
 */

import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { SECRET_NAME } from '../security/secret-vault'

// ─── Public types ───────────────────────────────────────────────────

/** Where a memory write may land. */
export type MemoryScope = 'project' | 'global'

/** What kind of content a memory write carries. */
export type MemoryContentKind =
  | 'preference'
  | 'discovery'
  | 'auth_state'
  | 'target_data'
  | 'technique_pattern'

/** Why content was flagged target-sensitive (shape tags, not prose). */
export type MemorySensitivityTag =
  | 'secret_shape'
  | 'raw_url'
  | 'hostname'
  | 'auth_state'
  | 'storage_value'
  | 'request_payload'

export interface MemoryWriteRequest {
  /** Optional workflow identity — recorded on the decision ledger. */
  workflowId?: string
  /** The scope the caller asked to write to. */
  scope: MemoryScope
  /** What the value is. */
  kind: MemoryContentKind
  /** Content being written. */
  value: unknown
  /** Persistence key for global preferences. */
  key?: string
}

export interface MemorySensitivity {
  sensitive: boolean
  tags: MemorySensitivityTag[]
}

export interface MemoryPolicyResult {
  allowed: boolean
  /** Where the write SHOULD land (may differ from the requested scope). */
  destination: MemoryScope
  /** Human-readable policy reason (inspectable, redacted-safe). */
  reason: string
}

// ─── Shape detection (target-sensitive content classifier) ─────────

const RAW_URL_RE = /https?:\/\/[^\s"'`<>)]+/i
// Bare hostnames (e.g. "example.com", "api.target.io"). Restricted to a known
// TLD set so dotted technique ids like "sql.injection" are not rejected.
const KNOWN_TLDS = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'us', 'eu', 'xyz', 'sh', 'ai', 'gov', 'edu', 'info', 'biz', 'me', 'cloud', 'local', 'internal', 'example', 'test']
const HOSTNAME_RE = new RegExp(
  `(^|[\\s"'\`(]|\\b)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${KNOWN_TLDS.join('|')})(?=[\\s"'\`)/?#]|$)`,
  'i',
)
const JWT_RE = /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}/
const STORAGE_KEYS = new Set(['localstorage', 'sessionstorage', 'cookie', 'cookies', 'cookie-store', 'store'])

/**
 * Is `key` a secret/auth-field name? Matches the shared SECRET_NAME shape
 * (header/field names, not free-text vocab), but SKIPS pluralized collections
 * ("pathTokens", "tokens") so structural shape fields are not false-flagged.
 */
export function isSecretKeyName(key: string): boolean {
  const m = key.match(SECRET_NAME)
  if (!m || m.index === undefined) return false
  const next = key[m.index + m[0].length]
  return next === undefined || next.toLowerCase() !== 's'
}

export interface SensitivityOptions {
  /** Optional target origin — values containing its host are flagged. */
  targetOrigin?: string
  /** Optional field name the top-level value is stored under (e.g. the persistence key). */
  contextKey?: string
}

/** Structural (shape-based) HTTP request/response detection. */
function isRequestPayload(rec: Record<string, unknown>): boolean {
  const keys = new Set(Object.keys(rec).map((k) => k.toLowerCase()))
  const hasUrl = keys.has('url') || keys.has('path') || keys.has('uri')
  const hasMethod = keys.has('method') || keys.has('verb')
  const hasHeaders = keys.has('headers') || keys.has('header')
  const hasStatus = keys.has('status') || keys.has('statuscode')
  const hasBody = keys.has('body') || keys.has('payload') || keys.has('data')
  if (hasMethod && (hasUrl || hasHeaders || hasBody)) return true
  if (hasStatus && (hasBody || hasHeaders)) return true
  return false
}

/**
 * Walk a value tree and classify target-sensitive content. Shape-based only —
 * no vocab/substring matching of free text.
 */
export function detectSensitivity(value: unknown, opts: SensitivityOptions = {}): MemorySensitivity {
  const tags = new Set<MemorySensitivityTag>()
  let targetHost = ''
  if (opts.targetOrigin) {
    try {
      targetHost = new URL(opts.targetOrigin).host
    } catch {
      targetHost = ''
    }
  }

  const walk = (v: unknown, key: string, depth: number): void => {
    if (depth > 8) return
    if (typeof v === 'string') {
      if (JWT_RE.test(v) || BEARER_RE.test(v)) {
        tags.add('secret_shape')
      } else if (isSecretKeyName(key)) {
        tags.add('auth_state')
      }
      if (RAW_URL_RE.test(v)) {
        tags.add('raw_url')
      } else if (HOSTNAME_RE.test(v)) {
        tags.add('hostname')
      }
      if (targetHost && v.includes(targetHost)) tags.add('raw_url')
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key, depth + 1)
      return
    }
    if (v && typeof v === 'object') {
      const rec = v as Record<string, unknown>
      if (isRequestPayload(rec)) tags.add('request_payload')
      for (const [childKey, childValue] of Object.entries(rec)) {
        if (STORAGE_KEYS.has(childKey.toLowerCase())) tags.add('storage_value')
        walk(childValue, childKey, depth + 1)
      }
    }
  }

  walk(value, opts.contextKey ?? '', 0)
  return { sensitive: tags.size > 0, tags: [...tags] }
}

// ─── Policy gate ────────────────────────────────────────────────────

/**
 * Decide where a memory write may land.
 *
 *   project scope:          everything is the workflow-scoped sink (allowed).
 *   global scope:
 *     - auth_state / target_data / discovery → REROUTED to project (workflow
 *       data never belongs in global memory; write is allowed, not lost).
 *     - preference / technique_pattern       → allowed ONLY if not
 *       target-sensitive; otherwise BLOCKED (fail closed).
 */
export function evaluateMemoryWrite(req: MemoryWriteRequest): MemoryPolicyResult {
  if (req.scope === 'project') {
    return { allowed: true, destination: 'project', reason: 'project memory is the workflow-scoped sink' }
  }
  switch (req.kind) {
    case 'auth_state':
    case 'target_data':
    case 'discovery':
      return {
        allowed: true,
        destination: 'project',
        reason: `${req.kind} is workflow-scoped — rerouted to project memory (never global)`,
      }
    case 'preference':
    case 'technique_pattern': {
      const sensitivity = detectSensitivity(req.value, { contextKey: req.key })
      if (sensitivity.sensitive) {
        return {
          allowed: false,
          destination: 'global',
          reason: `blocked: target-sensitive content (${sensitivity.tags.join(', ')})`,
        }
      }
      return { allowed: true, destination: 'global', reason: 'safe: no target-sensitive content detected' }
    }
    default: {
      const kind: string = (req as { kind: string }).kind
      return { allowed: false, destination: req.scope, reason: `unknown memory kind: ${kind}` }
    }
  }
}

/** Convenience alias — same gate, clear intent. */
export const routeMemoryWrite = evaluateMemoryWrite

/**
 * Record a memory-policy decision on the DecisionLedger so the boundary is
 * inspectable after a run. Best-effort — never throws into the write site.
 */
export function recordMemoryPolicyDecision(req: MemoryWriteRequest, result: MemoryPolicyResult): void {
  try {
    getGlobalDecisionLedger().recordDecision({
      workflowId: req.workflowId,
      kind: 'memory.policy',
      reason: result.reason,
      routingReason: `scope=${req.scope} kind=${req.kind} destination=${result.destination} allowed=${result.allowed}`,
      sourceRefs: [],
    })
  } catch {
    // best-effort
  }
}

/** Thrown when a global write is blocked (fail closed). */
export class MemoryPolicyError extends Error {
  readonly result: MemoryPolicyResult
  constructor(result: MemoryPolicyResult) {
    super(result.reason)
    this.name = 'MemoryPolicyError'
    this.result = result
  }
}
