/**
 * Capability Gateway (Strix Adaptation Phase H) — three-tier visibility + requestCapability.
 *
 * Three tiers:
 *   discoverable: tool shows in listTools (name + short description only)
 *   describable:  tool's full schema is visible (loadTool returns full inputSchema)
 *   invokable:    tool can actually be called (has valid grant from GrantManager)
 *
 * The gateway sits between the DynamicToolRegistry and the LLM. Tools are
 * always discoverable, but description and invocation require appropriate
 * grants. The brain can call `requestCapability` to escalate from
 * discoverable → describable → invokable.
 */

import { GrantManager, type CapabilityRisk } from './grants'

export type VisibilityTier = 'discoverable' | 'describable' | 'invokable'

export interface ToolVisibility {
  toolId: string
  tier: VisibilityTier
  risk: CapabilityRisk
  description?: string
  grantId?: string
}

export interface CapabilityRequest {
  toolId: string
  reason: string
  risk: CapabilityRisk
}

export interface CapabilityDecision {
  granted: boolean
  toolId: string
  tier: VisibilityTier
  grantId?: string
  reason: string
}

/**
 * Capability Gateway — controls tool visibility and invocation.
 */
export class CapabilityGateway {
  private grants: GrantManager
  /** Map of toolId → current visibility tier */
  private visibility = new Map<string, VisibilityTier>()
  /** Map of toolId → risk classification */
  private riskMap = new Map<string, CapabilityRisk>()
  /** Map of toolId → description */
  private descriptions = new Map<string, string>()

  constructor(grants?: GrantManager) {
    this.grants = grants ?? new GrantManager()
  }

  /**
   * Register a tool with its risk tier and description.
   * All tools start at 'discoverable' tier.
   */
  registerTool(toolId: string, risk: CapabilityRisk, description?: string): void {
    if (!this.visibility.has(toolId)) {
      this.visibility.set(toolId, 'discoverable')
    }
    this.riskMap.set(toolId, risk)
    if (description) this.descriptions.set(toolId, description)
  }

  /**
   * Get the current visibility tier for a tool.
   */
  getTier(toolId: string): VisibilityTier {
    return this.visibility.get(toolId) ?? 'discoverable'
  }

  /**
   * Check if a tool is visible at a given tier.
   */
  isVisible(toolId: string, tier: VisibilityTier): boolean {
    const current = this.getTier(toolId)
    const tierOrder: VisibilityTier[] = ['discoverable', 'describable', 'invokable']
    return tierOrder.indexOf(current) >= tierOrder.indexOf(tier)
  }

  /**
   * Check if a tool is invokable.
   * Low-risk tools (read, network) only need tier='invokable'.
   * High-risk tools (mutate, delegate) also need a valid grant.
   */
  isInvokable(toolId: string, workerId: string): boolean {
    const tier = this.getTier(toolId)
    if (tier !== 'invokable') return false
    const risk = this.riskMap.get(toolId) ?? 'network'

    // Low-risk tools don't require grants — tier check is sufficient
    if (!GrantManager.requiresGrant(risk)) return true

    // High-risk tools need a valid grant
    const result = this.grants.checkCapability(workerId, toolId, risk)
    return result.granted
  }

  /**
   * Process a capability request from the LLM brain.
   * Grants a tier upgrade if the risk is acceptable.
   */
  requestCapability(
    request: CapabilityRequest,
    workerId: string,
    autoApproveLowRisk: boolean = true,
  ): CapabilityDecision {
    const currentTier = this.getTier(request.toolId)
    const risk = this.riskMap.get(request.toolId) ?? request.risk

    // Low-risk tools (read, network) can be auto-approved directly to invokable
    if (autoApproveLowRisk && (risk === 'read' || risk === 'network')) {
      this.visibility.set(request.toolId, 'invokable')
      return {
        granted: true,
        toolId: request.toolId,
        tier: 'invokable',
        reason: `${risk} risk tool auto-invoked`,
      }
    }

    // For mutate/delegate risk, create a grant
    if (GrantManager.requiresGrant(risk)) {
      const grant = this.grants.grant(workerId, request.toolId, risk)
      this.visibility.set(request.toolId, 'invokable')
      return {
        granted: true,
        toolId: request.toolId,
        tier: 'invokable',
        grantId: grant.grantId,
        reason: `Grant created for ${risk} risk tool`,
      }
    }

    // Fallback: describable only
    if (currentTier !== 'invokable') {
      this.visibility.set(request.toolId, 'describable')
    }
    return {
      granted: true,
      toolId: request.toolId,
      tier: 'describable',
      reason: `Escalated to describable`,
    }
  }

  /**
   * Get the tool description (only visible at describable tier or above).
   */
  getDescription(toolId: string): string | undefined {
    if (!this.isVisible(toolId, 'describable')) return undefined
    return this.descriptions.get(toolId)
  }

  /**
   * List all tools at a given visibility level.
   */
  listByTier(tier: VisibilityTier): ToolVisibility[] {
    const result: ToolVisibility[] = []
    for (const [toolId, currentTier] of this.visibility) {
      if (currentTier === tier || (tier === 'discoverable' && currentTier !== undefined)) {
        result.push({
          toolId,
          tier: currentTier,
          risk: this.riskMap.get(toolId) ?? 'network',
          description: this.isVisible(toolId, 'describable') ? this.descriptions.get(toolId) : undefined,
        })
      }
    }
    return result
  }

  /**
   * Reset all visibility to discoverable (for tests).
   */
  reset(): void {
    for (const [key] of this.visibility) {
      this.visibility.set(key, 'discoverable')
    }
  }
}
