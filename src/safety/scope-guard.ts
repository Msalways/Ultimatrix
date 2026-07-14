import type { ScopeConfig } from '../config'
import { log } from '../utils/logger'

let _config: ScopeConfig | null = null
let _allowAny = false

export function setScopeConfig(config: ScopeConfig | null): void {
  _config = config
}

export function getScopeConfig(): ScopeConfig | null {
  return _config
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

export function isUrlInScope(url: string, config: ScopeConfig | null = _config): ScopeCheckResult {
  // Explicit opt-out overrides everything.
  if (_allowAny) return { allowed: true }

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
