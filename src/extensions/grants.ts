/**
 * Grant Manager — per-worker capability grants with risk classification.
 *
 * Part of the Strix Adaptation (Phase C). Grants control what capabilities
 * a worker can invoke. Each grant carries a risk tier, optional expiry,
 * and can be revoked. The Capability Gateway (Phase H) rechecks grants
 * on every invocation.
 */

import { randomUUID } from 'node:crypto'

export type CapabilityRisk = 'read' | 'network' | 'mutate' | 'delegate'

export interface CapabilityGrant {
  grantId: string
  capabilityId: string
  workerId: string
  risk: CapabilityRisk
  grantedAt: number
  expiresAt?: number
  revokedAt?: number
}

export interface GrantOptions {
  /** TTL in ms. Undefined = no expiry. */
  ttlMs?: number
}

const RISK_HIERARCHY: Record<CapabilityRisk, number> = {
  read: 0,
  network: 1,
  mutate: 2,
  delegate: 3,
}

export class GrantManager {
  private grants = new Map<string, CapabilityGrant>()

  /** Create a new grant for a worker to invoke a capability. */
  grant(
    workerId: string,
    capabilityId: string,
    risk: CapabilityRisk,
    options?: GrantOptions,
  ): CapabilityGrant {
    const now = Date.now()
    const grant: CapabilityGrant = {
      grantId: `grant-${randomUUID()}`,
      capabilityId,
      workerId,
      risk,
      grantedAt: now,
      ...(options?.ttlMs ? { expiresAt: now + options.ttlMs } : {}),
    }
    this.grants.set(grant.grantId, grant)
    return grant
  }

  /** Revoke a grant by ID. Subsequent checks will fail. */
  revoke(grantId: string): boolean {
    const grant = this.grants.get(grantId)
    if (!grant) return false
    grant.revokedAt = Date.now()
    return true
  }

  /** Revoke all grants for a worker. */
  revokeAllForWorker(workerId: string): number {
    let count = 0
    const now = Date.now()
    for (const grant of this.grants.values()) {
      if (grant.workerId === workerId && !grant.revokedAt) {
        grant.revokedAt = now
        count++
      }
    }
    return count
  }

  /** Check if a grant is currently valid. */
  check(grantId: string): { valid: boolean; reason?: string } {
    const grant = this.grants.get(grantId)
    if (!grant) return { valid: false, reason: 'grant not found' }
    if (grant.revokedAt) return { valid: false, reason: 'grant revoked' }
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      return { valid: false, reason: 'grant expired' }
    }
    return { valid: true }
  }

  /** Check if a worker has a valid grant for a specific capability. */
  checkCapability(
    workerId: string,
    capabilityId: string,
    minimumRisk?: CapabilityRisk,
  ): { granted: boolean; grant?: CapabilityGrant; reason?: string } {
    for (const grant of this.grants.values()) {
      if (grant.workerId !== workerId) continue
      if (grant.capabilityId !== capabilityId) continue
      if (grant.revokedAt) continue
      if (grant.expiresAt && Date.now() > grant.expiresAt) continue

      // Check risk level
      if (minimumRisk) {
        const grantLevel = RISK_HIERARCHY[grant.risk] ?? 0
        const requiredLevel = RISK_HIERARCHY[minimumRisk] ?? 0
        if (grantLevel < requiredLevel) {
          return { granted: false, reason: `grant risk ${grant.risk} below required ${minimumRisk}` }
        }
      }

      return { granted: true, grant }
    }
    return { granted: false, reason: 'no valid grant found' }
  }

  /** List all grants for a worker. */
  listForWorker(workerId: string): CapabilityGrant[] {
    return [...this.grants.values()].filter(g => g.workerId === workerId)
  }

  /** List all active (non-revoked, non-expired) grants. */
  listActive(): CapabilityGrant[] {
    const now = Date.now()
    return [...this.grants.values()].filter(
      g => !g.revokedAt && (!g.expiresAt || now <= g.expiresAt),
    )
  }

  /** Clear all grants. */
  clear(): void {
    this.grants.clear()
  }

  /** Check if a risk tier requires explicit grant. */
  static requiresGrant(risk: CapabilityRisk): boolean {
    return risk === 'mutate' || risk === 'delegate'
  }

  /** Compare two risk tiers. Returns negative if a < b, positive if a > b, 0 if equal. */
  static compareRisk(a: CapabilityRisk, b: CapabilityRisk): number {
    return (RISK_HIERARCHY[a] ?? 0) - (RISK_HIERARCHY[b] ?? 0)
  }
}
