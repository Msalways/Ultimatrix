/**
 * Resource Claim Registry — Phase F4 (Base Architecture Contracts).
 *
 * D4 fix: three escalation paths (exploitation loop, playbook, campaign) plus
 * parallel swarms previously selected work independently — nothing prevented
 * two paths firing against the same endpoint unaware of each other.
 *
 * The registry is deliberately SIMPLE: an in-process check-and-set map with
 * TTL expiry. It coordinates intent, not truth — the graph remains the source
 * of record for what actually happened. Single-process semantics only.
 */

export interface ResourceClaim {
  resourceKey: string
  owner: string
  purpose: string
  claimedAt: number
  expiresAt: number
}

export interface ClaimResult {
  claimed: boolean
  holder?: string
}

const DEFAULT_TTL_MS = 10 * 60 * 1000

class ClaimRegistryImpl {
  private claims = new Map<string, ResourceClaim>()

  private sweep(): void {
    const now = Date.now()
    for (const [key, claim] of this.claims) {
      if (now >= claim.expiresAt) this.claims.delete(key)
    }
  }

  /**
   * Check-and-set. `claimed:false` with the current holder when the resource
   * is actively claimed by someone else.
   */
  tryClaim(resourceKey: string, owner: string, purpose: string, ttlMs = DEFAULT_TTL_MS): ClaimResult {
    if (!resourceKey || !owner) return { claimed: false, holder: '(invalid claim arguments)' }
    this.sweep()
    const existing = this.claims.get(resourceKey)
    if (existing && existing.owner !== owner) {
      return { claimed: false, holder: `${existing.owner} (${existing.purpose})` }
    }
    const claim: ResourceClaim = { resourceKey, owner, purpose, claimedAt: Date.now(), expiresAt: Date.now() + ttlMs }
    this.claims.set(resourceKey, claim)
    return { claimed: true }
  }

  /** Owner releases its own claim (completion or failure). */
  release(resourceKey: string, owner: string): void {
    const existing = this.claims.get(resourceKey)
    if (existing && existing.owner === owner) this.claims.delete(resourceKey)
  }

  /** Re-claiming your own claim refreshes it (multi-step work). */
  refresh(resourceKey: string, owner: string, ttlMs = DEFAULT_TTL_MS): boolean {
    const existing = this.claims.get(resourceKey)
    if (!existing || existing.owner !== owner) return false
    existing.expiresAt = Date.now() + ttlMs
    return true
  }

  isClaimed(resourceKey: string): boolean {
    this.sweep()
    return this.claims.has(resourceKey)
  }

  get size(): number {
    this.sweep()
    return this.claims.size
  }

  clear(): void {
    this.claims.clear()
  }
}

const singleton = new ClaimRegistryImpl()

/** Canonical endpoint/resource key used by every escalation path. */
export function endpointResourceKey(method: string | undefined, url: string): string {
  let path = url
  try {
    const u = new URL(url)
    path = `${u.host}${u.pathname}`
  } catch {
    /* relative/opaque keys still coordinate within the session */
  }
  return `${(method ?? 'GET').toUpperCase()}:${path}`
}

export type ClaimRegistry = ClaimRegistryImpl

export function getClaimRegistry(): ClaimRegistryImpl {
  return singleton
}

export function resetClaimRegistry(): void {
  singleton.clear()
}

/**
 * Run `fn` under an endpoint claim. Returns fn's value when the claim was
 * acquired; otherwise returns the skip sentinel without executing.
 */
export async function withEndpointClaim<T>(
  opts: { method?: string; url: string; owner: string; purpose: string },
  fn: () => Promise<T>,
): Promise<{ executed: true; value: T } | { executed: false; holder: string }> {
  const key = endpointResourceKey(opts.method, opts.url)
  const claim = getClaimRegistry().tryClaim(key, opts.owner, opts.purpose)
  if (!claim.claimed) return { executed: false, holder: claim.holder ?? 'unknown' }
  try {
    return { executed: true, value: await fn() }
  } finally {
    getClaimRegistry().release(key, opts.owner)
  }
}
