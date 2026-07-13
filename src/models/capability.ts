import type { UltimatrixConfig } from '../config'

/** Minimum context window required to reliably drive a complex (solver/council) goal. */
export const MIN_CONTEXT_FOR_COMPLEX = 16_000

export interface CapabilityCheck {
  ok: boolean
  reason?: string
  contextWindow?: number
  warned: boolean
}

/**
 * Root-cause fix (gap-analysis P0-4): a capability CONTRACT between the model
 * and the task. A complex (solver/council) goal cannot be reliably achieved on a
 * model with a sub-16K context window — it will silently truncate to a handful
 * of conversation messages (see config.ts 4-message cap). Refuse or warn instead
 * of degrading silently.
 */
export function checkModelCapability(
  config: UltimatrixConfig,
  modelId: string,
  opts: { complex: boolean; require?: boolean },
): CapabilityCheck {
  const caps = config.modelCapabilities
  if (!caps || !modelId) return { ok: true, warned: false }

  const cap = caps[modelId] ?? caps[`${config.provider}/${modelId}`]
  if (!cap) return { ok: true, warned: false }
  if (!opts.complex) return { ok: true, warned: false }

  if (cap.contextWindow >= MIN_CONTEXT_FOR_COMPLEX) {
    return { ok: true, warned: false, contextWindow: cap.contextWindow }
  }

  const reason =
    `Model ${modelId} has contextWindow=${cap.contextWindow} (< ${MIN_CONTEXT_FOR_COMPLEX}); ` +
    `too small for complex multi-step goals — it will silently truncate. ` +
    `Use a larger-context model, or set requireCapableModel:false to override.`

  if (opts.require) {
    return { ok: false, reason, contextWindow: cap.contextWindow, warned: false }
  }
  // Warn-only mode: still allow, but surface the risk loudly.
  return { ok: true, reason, contextWindow: cap.contextWindow, warned: true }
}
