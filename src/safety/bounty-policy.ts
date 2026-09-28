import { getEngagementServices } from '../runtime/engagement-context'
import { getConfig } from '../config'
import type {
  AuthorizationCategory,
  BountyConfig,
  ScopeConfig,
  UltimatrixConfig,
} from '../config'

/**
 * Whether the live bounty profile is active for the current execution context.
 *
 * Engagement-owned first, process config second. The runtime's effective config
 * can be mutated after validation (CLI `--bounty`), so consulting `getConfig()`
 * alone would report the profile as inactive inside tools that gate on it —
 * leaving redaction, proof floors, and policy checks silently disabled during a
 * live run. Legacy callers with no engagement fall back to the loaded config.
 */
export function isBountyProfile(): boolean {
  const owned = getEngagementServices()?.bountyEnabled
  if (owned !== undefined) return owned
  return getConfig().bounty?.enabled === true
}

/** A validated policy that can be installed into an engagement boundary. */
export interface EnforcedBountyPolicy {
  scope: ScopeConfig
  allowedCategories: AuthorizationCategory[]
  authorization: NonNullable<UltimatrixConfig['authorization']>
}

export class BountyPolicyError extends Error {
  constructor(message: string) {
    super(`Bounty policy rejected: ${message}`)
    this.name = 'BountyPolicyError'
  }
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new BountyPolicyError(`${label} is not a valid absolute URL`)
  }
}

function hostAllowed(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase()
  return allowedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase()
    if (domain.startsWith('*.')) {
      const suffix = domain.slice(2)
      return host === suffix || host.endsWith(`.${suffix}`)
    }
    return host === domain
  })
}

/**
 * Resolve the optional live-bounty profile into a fail-closed runtime policy.
 *
 * The normal local/lab profile is unchanged. Once `bounty.enabled` is true,
 * an engagement cannot start without an explicit authorization record, a hard
 * non-empty scope, explicit action categories, and hard budget enforcement.
 */
export function enforceBountyPolicy(
  config: UltimatrixConfig,
  target: string,
  options: { allowAny?: boolean } = {},
): EnforcedBountyPolicy | undefined {
  const bounty: BountyConfig | undefined = config.bounty
  if (!bounty?.enabled) return undefined

  if (options.allowAny === true) {
    throw new BountyPolicyError('allowAny cannot be used with the bounty profile')
  }

  const authorization = config.authorization
  if (!authorization?.confirmed) {
    throw new BountyPolicyError('authorization.confirmed must be true')
  }
  if (!authorization.method || !['bounty', 'pentest-contract', 'written-permission', 'self-owned', 'lab'].includes(authorization.method)) {
    throw new BountyPolicyError('authorization.method is missing or invalid')
  }
  if (!authorization.timestamp) {
    throw new BountyPolicyError('authorization.timestamp is required')
  }
  // YAML parses a bare ISO timestamp into a Date, not a string. Config
  // normalization usually canonicalises this, but the preflight must not depend
  // on that having run (it is also called directly by tests and other callers).
  const rawTimestamp: unknown = authorization.timestamp
  const timestampMs = rawTimestamp instanceof Date
    ? rawTimestamp.getTime()
    : Date.parse(String(rawTimestamp))
  if (Number.isNaN(timestampMs)) {
    throw new BountyPolicyError('authorization.timestamp must be a valid timestamp')
  }

  const targetUrl = parseUrl(target, 'target')
  const authorizedUrl = parseUrl(authorization.target, 'authorization.target')
  if (targetUrl.origin !== authorizedUrl.origin) {
    throw new BountyPolicyError(`target origin ${targetUrl.origin} is outside authorized origin ${authorizedUrl.origin}`)
  }
  const authorizedPath = authorizedUrl.pathname.replace(/\/$/, '')
  if (authorizedPath && authorizedPath !== '/' && targetUrl.pathname !== authorizedPath && !targetUrl.pathname.startsWith(`${authorizedPath}/`)) {
    throw new BountyPolicyError(`target path is outside authorized path ${authorizedPath}`)
  }

  const scope = config.scope
  if (!scope) throw new BountyPolicyError('scope is required')
  if (scope.enforcement !== 'hard') {
    throw new BountyPolicyError('scope.enforcement must be hard')
  }
  if (!Array.isArray(scope.allowedOrigins) || scope.allowedOrigins.length === 0) {
    throw new BountyPolicyError('scope.allowedOrigins must contain the exact authorized origin')
  }
  if (!scope.allowedOrigins.includes(targetUrl.origin)) {
    throw new BountyPolicyError(`target origin ${targetUrl.origin} is not in scope.allowedOrigins`)
  }
  const targetPort = targetUrl.port
    ? Number(targetUrl.port)
    : targetUrl.protocol === 'https:' ? 443 : targetUrl.protocol === 'http:' ? 80 : NaN
  if (scope.allowedPorts && scope.allowedPorts.length > 0 && !scope.allowedPorts.includes(targetPort)) {
    throw new BountyPolicyError(`target port ${targetPort} is not in scope.allowedPorts`)
  }
  if (!Array.isArray(scope.allowedDomains) || scope.allowedDomains.length === 0) {
    throw new BountyPolicyError('scope.allowedDomains must contain at least one domain')
  }
  if (!hostAllowed(targetUrl.hostname, scope.allowedDomains)) {
    throw new BountyPolicyError(`target host ${targetUrl.hostname} is not in scope.allowedDomains`)
  }

  const allowedCategories = bounty.allowedCategories ?? scope.allowedCategories
  if (!Array.isArray(allowedCategories) || allowedCategories.length === 0) {
    throw new BountyPolicyError('explicit bounty.allowedCategories or scope.allowedCategories are required')
  }
  const uniqueCategories = [...new Set(allowedCategories)]
  if (config.externalTools?.enabled) {
    throw new BountyPolicyError('external tools are disabled in the bounty profile until they submit typed replay material and a finding-specific oracle')
  }

  if (config.budgetPolicy?.enforcement !== 'hard') {
    throw new BountyPolicyError('budgetPolicy.enforcement must be hard')
  }
  if (!Number.isFinite(config.rateLimit.requestsPerMinute) || config.rateLimit.requestsPerMinute <= 0) {
    throw new BountyPolicyError('rateLimit.requestsPerMinute must be a positive finite number')
  }
  if (!Number.isFinite(config.rateLimit.maxConcurrent) || config.rateLimit.maxConcurrent <= 0) {
    throw new BountyPolicyError('rateLimit.maxConcurrent must be a positive finite number')
  }

  return {
    scope: {
      ...scope,
      enforcement: 'hard',
      allowedCategories: uniqueCategories,
    },
    allowedCategories: uniqueCategories,
    authorization,
  }
}
