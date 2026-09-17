/**
 * Capability Facade (Phase 6).
 *
 * Wraps the compiler output into Mastra-ready tool sets. Provides typed
 * access to compiled tools, scoped primitives, and evidence policy.
 * Bridges the Capability Compiler into the existing WorkerFactory.
 */

import type { CompiledCapabilitySet, EvidencePolicy } from './types'
import { TOKENS_PER_TOOL } from './types'
import { createRunPrimitiveTool } from '../primitives/index'

/**
 * A facade over a compiled capability set, ready to pass to createAgent().
 * Owns the scoped runPrimitive tool if primitives are declared.
 */
export class CapabilityFacade {
  readonly tools: string[]
  readonly primitives: string[]
  readonly evidencePolicy: EvidencePolicy
  readonly estimatedTokens: number

  /** Scoped runPrimitive tool (null if skill has no primitives) */
  readonly scopedRunPrimitive: ReturnType<typeof createRunPrimitiveTool> | null

  constructor(readonly compiled: CompiledCapabilitySet) {
    this.tools = compiled.tools
    this.primitives = compiled.primitives
    this.evidencePolicy = compiled.evidencePolicy
    this.estimatedTokens = compiled.estimatedTokens

    // Create scoped runPrimitive if skill declares primitives
    if (compiled.primitives.length > 0) {
      this.scopedRunPrimitive = createRunPrimitiveTool(compiled.primitives)
    } else {
      this.scopedRunPrimitive = null
    }
  }

  /** Get the tool ID list suitable for createAgent({ toolIds }) */
  getToolIds(): string[] {
    return [...this.tools]
  }

  /** Get extraTools map to pass to createAgent({ extraTools }) */
  getExtraTools(): Record<string, any> {
    const extra: Record<string, any> = {}
    if (this.scopedRunPrimitive) {
      extra.runPrimitive = this.scopedRunPrimitive
    }
    return extra
  }

  /** Check if a specific tool is in the compiled set */
  hasTool(toolId: string): boolean {
    return this.tools.includes(toolId)
  }

  /** Check if a specific primitive is authorized */
  hasPrimitive(primitiveId: string): boolean {
    return this.primitives.includes(primitiveId)
  }

  /** Get a summary for logging/debugging */
  summary(): string {
    return [
      `tools: ${this.tools.length}`,
      `primitives: ${this.primitives.length}`,
      `evidence: auto=${this.evidencePolicy.autoCapture}, manual=${this.evidencePolicy.manualEvidenceAllowed}`,
      `tokens: ~${this.estimatedTokens}`,
    ].join(', ')
  }
}

/**
 * Create a CapabilityFacade from compiler input.
 * Convenience wrapper around compileCapabilities() + new CapabilityFacade().
 */
export function createCapabilityFacade(input: import('./types').CompilerInput): CapabilityFacade {
  const { compileCapabilities } = require('./compiler')
  const compiled = compileCapabilities(input)
  return new CapabilityFacade(compiled)
}
