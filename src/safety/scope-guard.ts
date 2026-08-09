import type { ScopeConfig, AuthorizationCategory, ExternalToolsConfig } from '../config'
import { log } from '../utils/logger'

let _config: ScopeConfig | null = null
let _allowAny = false
let _externalTools: ExternalToolsConfig | null = null

export function setScopeConfig(config: ScopeConfig | null): void {
  _config = config
}

export function getScopeConfig(): ScopeConfig | null {
  return _config
}

/** Ambient external-tool policy. Opt-in only — deny by default. */
export function setExternalToolsConfig(config: ExternalToolsConfig | null): void {
  _externalTools = config
}

export function getExternalToolsConfig(): ExternalToolsConfig | null {
  return _externalTools
}

/**
 * External-tool opt-in. `externalTools.enabled` is required; a non-empty
 * `externalTools.tools` map further narrows to the explicitly-enabled ids.
 * Without `toolId`, the map is not consulted (the flag alone decides).
 */
export function isExternalToolEnabled(toolId?: string): boolean {
  if (!_externalTools?.enabled) return false
  const tools = _externalTools.tools
  if (!tools || Object.keys(tools).length === 0) return true
  if (!toolId) return true
  return tools[toolId as keyof typeof tools] === true
}

/**
 * Pure authorization predicate — shared by the ambient scope-guard gate and the
 * per-workflow `EngagementBoundary` (both pass their own policy, never the
 * other's mutable state). `allowedCategories` absent/empty = legacy allow-all,
 * EXCEPT `external_tool` which always requires explicit opt-in.
 */
export function isCategoryAuthorized(
  category: AuthorizationCategory,
  opts?: { allowedCategories?: AuthorizationCategory[]; externalToolsEnabled?: boolean },
): boolean {
  const categories = opts?.allowedCategories
  if (category === 'external_tool') {
    if (!opts?.externalToolsEnabled) return false
    if (categories && categories.length > 0 && !categories.includes('external_tool')) return false
    return true
  }
  if (categories && categories.length > 0) return categories.includes(category)
  return true
}

/** Ambient authorization gate — reads the global scope config + external-tools config. */
export function isActionAuthorized(category: AuthorizationCategory, opts?: { toolId?: string }): boolean {
  return isCategoryAuthorized(category, {
    allowedCategories: _config?.allowedCategories,
    externalToolsEnabled: isExternalToolEnabled(opts?.toolId),
  })
}

/** Hard gate — throws when the ambient policy denies the action category. */
export function enforceAction(category: AuthorizationCategory, opts?: { toolId?: string }): void {
  if (!isActionAuthorized(category, opts)) {
    throw new Error(
      `Action not authorized: ${category}${opts?.toolId ? ` (${opts.toolId})` : ''} — enable via config (scope.allowedCategories / externalTools)`,
    )
  }
}

/**
 * Runtime scope expansion — explicit user approval of a proposed origin.
 * Merges the origin's hostname into the ambient scope's allowedDomains so the
 * transport-level gate admits approved URLs. Idempotent; no-op without an
 * ambient scope config.
 */
export function approveScopeOrigin(url: string): void {
  if (!_config) return
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return
  }
  if (!hostname) return
  const domains = _config.allowedDomains ?? (_config.allowedDomains = [])
  if (!domains.includes(hostname)) domains.push(hostname)
}

/** Explicit opt-out (runtime `--allow-any`). Off by default = deny-by-default. */
export function setAllowAny(value: boolean): void {
  _allowAny = value
}

export function isAllowAny(): boolean {
  return _allowAny
}

export interface ScopeCheckResult {
  allowed: boolean
  reason?: string
}

export interface ScopeCheckOptions {
  /**
   * Explicit override of the ambient `--allow-any` flag. `true` always allows;
   * `false` never allows; `undefined` inherits the ambient global flag.
   * Lets callers like the spider runtime classify URLs deterministically from
   * their own explicit input instead of mutable global state.
   */
  allowAny?: boolean
}

export function isUrlInScope(url: string, config: ScopeConfig | null = _config, opts: ScopeCheckOptions = {}): ScopeCheckResult {
  // Explicit opt-out overrides everything.
  if (opts.allowAny ?? _allowAny) return { allowed: true }

  // Scope is OPTIONAL. When no scope policy is configured (or the policy has
  // no allowedDomains), the tool is free-for-all — any URL is permitted.
  // Restriction only applies when the user explicitly lists allowedDomains.
  if (!config || !config.allowedDomains || config.allowedDomains.length === 0) {
    return { allowed: true }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, reason: `Invalid URL: ${url}` }
  }

  const allowedProtocols = config.allowedProtocols ?? ['https', 'http']
  if (!allowedProtocols.includes(parsed.protocol.replace(':', ''))) {
    const msg = `Protocol not in scope: ${parsed.protocol.replace(':', '')} (allowed: ${allowedProtocols.join(', ')})`
    log.warn(`ScopeGuard: ${msg}`)
    return { allowed: false, reason: msg }
  }

  const hostname = parsed.hostname.toLowerCase()
  const domainMatch = config.allowedDomains.some((d) => {
    const domain = d.toLowerCase().trim()
    if (domain.startsWith('*.')) {
      const wildcard = domain.slice(2)
      return hostname === wildcard || hostname.endsWith('.' + wildcard)
    }
    return hostname === domain
  })

  if (!domainMatch) {
    const msg = `Domain not in scope: ${hostname} (allowed: ${config.allowedDomains.join(', ')})`
    log.warn(`ScopeGuard: ${msg}`)
    return { allowed: false, reason: msg }
  }

  if (config.allowedPaths && config.allowedPaths.length > 0) {
    const pathMatch = config.allowedPaths.some((p) => parsed.pathname.startsWith(p))
    if (!pathMatch) {
      const msg = `Path not in scope: ${parsed.pathname} (allowed: ${config.allowedPaths.join(', ')})`
      log.warn(`ScopeGuard: ${msg}`)
      return { allowed: false, reason: msg }
    }
  }

  return { allowed: true }
}

/**
 * Hard gate. Throws on any denied URL (no `enforcement` opt-out) — this is the
 * single transport-level scope enforcer used by HTTP / browser / traditional
 * tools. Deny-by-default makes it safe even when misconfigured.
 */
export function enforceScope(url: string, config: ScopeConfig | null = _config): void {
  const result = isUrlInScope(url, config)
  if (!result.allowed) {
    throw new Error(`Scope violation: ${result.reason}`)
  }
}

export function assertInScope(url: string, config: ScopeConfig | null = _config): void {
  enforceScope(url, config)
}

/**
 * Derive a ScopeConfig from a target URL. Used when no explicit scope is
 * configured — the target's own hostname becomes the sole allowed domain.
 *
 * This is NOT a security relaxation: it scopes the tool to exactly the target
 * the user specified, which is the minimum safe default. Without this, every
 * HTTP/browser tool call is hard-rejected, making the tool unusable out of
 * the box.
 *
 * Returns null if the target URL cannot be parsed (caller should deny).
 */
export function deriveScopeFromTarget(target: string): ScopeConfig | null {
  try {
    const parsed = new URL(target)
    const hostname = parsed.hostname.toLowerCase()
    if (!hostname) return null
    return {
      allowedDomains: [hostname],
      allowedProtocols: [parsed.protocol.replace(':', '')],
      enforcement: 'hard',
    }
  } catch {
    return null
  }
}
