import type { ScopeConfig } from '../config'
import { log } from '../utils/logger'

let _config: ScopeConfig | null = null

export function setScopeConfig(config: ScopeConfig | null): void {
  _config = config
}

export function getScopeConfig(): ScopeConfig | null {
  return _config
}

export interface ScopeCheckResult {
  allowed: boolean
  reason?: string
}

export function isUrlInScope(url: string, config: ScopeConfig | null = _config): ScopeCheckResult {
  if (!config) return { allowed: true }
  if (!config.allowedDomains || config.allowedDomains.length === 0) {
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

export function assertInScope(url: string, config: ScopeConfig | null = _config): void {
  const result = isUrlInScope(url, config)
  if (!result.allowed && config?.enforcement === 'hard') {
    throw new Error(`Scope violation: ${result.reason}`)
  }
}
