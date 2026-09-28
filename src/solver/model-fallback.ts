/**
 * Model fallback — shared turn-survivability policy for every solver entry
 * point (`solve` CLI, `interact` REPL, web engine).
 *
 * Two responsibilities live here so they cannot drift apart again:
 *
 * 1. `isRecoverableModelFailure` — provider-neutral classification of a
 *    `model_failed` turn that is worth retrying (transport stalls, rate
 *    limits, overload, failover-worthy routing errors). It keys on
 *    transport/status-code vocabulary, never on vendor or model names.
 * 2. `nextConfiguredModel` — walks the *configured* tier ladder
 *    (brain tier → fast → balanced → powerful → explicit roles →
 *    capabilities → credential-file defaults) and returns the first
 *    model that has not been attempted yet.
 * 3. `resolveProgressTimeoutMs` — the inter-chunk watchdog budget. Slow
 *    reasoning providers legitimately pause between stream chunks; the
 *    budget scales with the turn budget instead of a fixed 60s cap, while
 *    the overall turn remains bounded by `maxDurationMs`.
 */

export interface ModelFailureDescriptor {
  reason?: string;
  error?: string;
}

/** Max brain-model attempts per turn (initial + one tier-escalated retry). */
export const MAX_MODEL_ATTEMPTS = 2;

/**
 * Canonical `provider/model` key. Model ids in YAML are often already
 * namespaced (`nvidia/nemotron-...`) while `provider` carries the same
 * prefix — naive `${provider}/${model}` template strings then produce
 * `nvidia/nvidia/...`, and attempted-set dedup silently stops matching.
 * Every attempted-model bookkeeping site must go through this function.
 */
export function modelKey(provider: unknown, rawModel: unknown): string {
  const value = String(rawModel ?? '').trim()
  const configuredProvider = String(provider ?? '').trim()
  if (configuredProvider && value.startsWith(`${configuredProvider}/`)) {
    return value
  }
  if (!value) return configuredProvider
  return configuredProvider ? `${configuredProvider}/${value}` : value
}

export function isRecoverableModelFailure(result: ModelFailureDescriptor): boolean {
  if (result.reason !== 'model_failed') return false
  const message = `${result.error ?? ''}`.toLowerCase()
  // Route on provider-neutral transport/model failures. Do not key this on
  // vendor names: any configured adapter may return these conditions.
  const status = message.match(/\b(400|404|408|409|429|500|502|503|504)\b/)?.[1]
  return Boolean(status)
    || message.includes('service_unavailable')
    || message.includes('temporarily overloaded')
    || message.includes('rate limit')
    || message.includes('quota')
    || message.includes('cannot connect')
    || message.includes('connection refused')
    || message.includes('headers timeout')
    || message.includes('fetch failed')
    || message.includes('socket hang up')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('network')
    || message.includes('stream startup timed out')
    || message.includes('progress stalled')
    || message.includes('provider returned error')
    || message.includes('model not found')
    || message.includes('unsupported model')
}

export function nextConfiguredModel(
  config: any,
  current: any,
  attempted: Set<string>,
  /**
   * Optional budget gate: return true when a provider must not receive more
   * traffic (quota exhausted / cooling down). Exhausted providers are
   * skipped so a retry never burns a doomed turn. Absent = no filtering
   * (every call still passes through the per-call quota/rate-limit gates).
   */
  isProviderExhausted?: (provider: string) => boolean,
): { provider: string; model: string } | undefined {
  const normalize = (provider: unknown, rawModel: unknown) => {
    const value = String(rawModel ?? '').trim()
    if (!value) return undefined
    const configuredProvider = String(provider ?? '').trim()
    // Provider model IDs (notably OpenRouter's `org/model`) legitimately
    // contain a slash. Only split a slash when it is the configured provider
    // prefix; otherwise preserve the model ID verbatim.
    const hasProviderPrefix = configuredProvider && value.startsWith(`${configuredProvider}/`)
    const resolvedProvider = configuredProvider || (value.includes('/') ? value.slice(0, value.indexOf('/')) : String(config.provider))
    // The wire form is ALWAYS the raw configured value: NIM-style providers
    // 404 when the namespace is stripped (`nemotron-3-super-...` dies while
    // `nvidia/nemotron-3-super-...` serves). Dedup compares on the
    // normalized key below, never on this field.
    const model = value
    const key = modelKey(resolvedProvider, hasProviderPrefix ? value.slice(configuredProvider.length + 1) : value)
    return { provider: resolvedProvider, model, key }
  }
  const candidates: Array<{ provider: string; model: string; key: string }> = []
  const add = (provider: unknown, model: unknown) => {
    const candidate = normalize(provider, model)
    if (candidate && !candidates.some(existing => existing.key === candidate.key)) candidates.push(candidate)
  }
  const addTier = (tier: unknown) => {
    const value = config.modelTiers?.[String(tier)]
    if (typeof value === 'string') add(config.provider, value)
    else if (value && typeof value === 'object') add(value.provider, value.model)
  }

  // Tier routing is the live authority. Put the brain's configured tier first
  // so configured role routing is a real failover rather than an ignored setting.
  addTier(config.modelRoleTiers?.brain ?? 'fast')
  add(config.modelRoles?.brain?.provider, config.modelRoles?.brain?.model)
  addTier('fast')
  addTier('balanced')
  addTier('powerful')
  for (const role of Object.values(config.modelRoles ?? {})) {
    if (role && typeof role === 'object' && 'provider' in role) add((role as any).provider, (role as any).model)
  }
  for (const key of Object.keys(config.modelCapabilities ?? {})) add(config.provider, key)
  // Provider credential files may declare a provider-local default model. This
  // is a generic failover source; it does not assume vendor names or model
  // prefixes and only considers credentials already loaded by config.
  for (const [provider, credentials] of Object.entries(config.creds ?? {})) {
    if (credentials && typeof credentials === 'object' && 'model' in credentials) {
      add(provider, (credentials as { model?: unknown }).model)
    }
  }

  const currentProvider = current?.provider ?? config.provider
  const currentModel = normalize(currentProvider, current?.model ?? config.model)?.key
  const exhausted = (provider: string): boolean => {
    try {
      return isProviderExhausted?.(provider) ?? false
    } catch {
      // A broken gate must fail open to per-call enforcement, never block
      // failover entirely: the call path still enforces quota/rate limits.
      return false
    }
  }
  return candidates.find(candidate =>
    candidate.key !== currentModel &&
    !attempted.has(candidate.key) &&
    !exhausted(candidate.provider))
}

/**
 * Resolve the inter-chunk stream watchdog budget.
 *
 * - An explicit positive `overrideMs` (from `solver.progressTimeoutMs`) is
 *   honored, floored at 15s so a misconfiguration cannot spin hot.
 * - Otherwise the budget scales with the turn budget: a quarter of
 *   `maxDurationMs`, floored at 60s (previous behavior for short turns) and
 *   capped at 180s per gap. A truly dead stream still fails fast enough to
 *   retry; a slow reasoning provider is no longer killed mid-thought. The
 *   overall turn remains bounded by `maxDurationMs` regardless.
 */
export function resolveProgressTimeoutMs(maxDurationMs: number, overrideMs?: number): number {
  if (typeof overrideMs === 'number' && overrideMs > 0) {
    return Math.max(15_000, Math.floor(overrideMs))
  }
  const budget = typeof maxDurationMs === 'number' && maxDurationMs > 0 ? maxDurationMs : 300_000
  return Math.max(60_000, Math.min(180_000, Math.floor(budget / 4)))
}
