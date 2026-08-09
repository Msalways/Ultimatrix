import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isCategoryAuthorized,
  isActionAuthorized,
  enforceAction,
  isExternalToolEnabled,
  setExternalToolsConfig,
  setScopeConfig,
  getScopeConfig,
  approveScopeOrigin,
  setAllowAny,
} from '../../src/safety/scope-guard'
import type { ScopeConfig, AuthorizationCategory } from '../../src/config'

function resetAmbient(): void {
  setScopeConfig(null)
  setExternalToolsConfig(null)
  setAllowAny(true) // suite default (test/setup.ts)
}

describe('isCategoryAuthorized (pure)', () => {
  it('allows any non-external category when no allowedCategories list is configured', () => {
    expect(isCategoryAuthorized('read')).toBe(true)
    expect(isCategoryAuthorized('execute')).toBe(true)
    expect(isCategoryAuthorized('browser_action')).toBe(true)
    expect(isCategoryAuthorized('delete')).toBe(true)
  })

  it('denies external_tool by default even with no category list', () => {
    expect(isCategoryAuthorized('external_tool')).toBe(false)
  })

  it('gates categories against the allowedCategories whitelist', () => {
    const opts = { allowedCategories: ['read', 'search'] as AuthorizationCategory[] }
    expect(isCategoryAuthorized('read', opts)).toBe(true)
    expect(isCategoryAuthorized('search', opts)).toBe(true)
    expect(isCategoryAuthorized('create', opts)).toBe(false)
    expect(isCategoryAuthorized('delete', opts)).toBe(false)
  })

  it('external_tool requires opt-in even when listed', () => {
    const listed = { allowedCategories: ['external_tool'] as AuthorizationCategory[], externalToolsEnabled: false }
    expect(isCategoryAuthorized('external_tool', listed)).toBe(false)
    expect(isCategoryAuthorized('external_tool', { ...listed, externalToolsEnabled: true })).toBe(true)
  })

  it('external_tool denied when absent from a configured whitelist even if tools enabled', () => {
    const opts = { allowedCategories: ['read'] as AuthorizationCategory[], externalToolsEnabled: true }
    expect(isCategoryAuthorized('external_tool', opts)).toBe(false)
  })
})

describe('ambient authorization gate', () => {
  beforeEach(resetAmbient)
  afterEach(resetAmbient)

  it('external tools denied by default', () => {
    setScopeConfig({ allowedDomains: ['example.com'], enforcement: 'hard' })
    expect(isActionAuthorized('external_tool', { toolId: 'nuclei' })).toBe(false)
    expect(() => enforceAction('external_tool', { toolId: 'sqlmap' })).toThrow(/not authorized/)
  })

  it('non-external categories allowed when no category whitelist', () => {
    setScopeConfig({ allowedDomains: ['example.com'], enforcement: 'hard' })
    expect(isActionAuthorized('read')).toBe(true)
    expect(isActionAuthorized('browser_action')).toBe(true)
  })

  it('allowedCategories gates ambient authorization', () => {
    setScopeConfig({ allowedDomains: ['example.com'], allowedCategories: ['read'], enforcement: 'hard' })
    expect(isActionAuthorized('read')).toBe(true)
    expect(isActionAuthorized('create')).toBe(false)
    expect(() => enforceAction('create')).toThrow(/not authorized/)
  })

  it('external_tool opt-in via externalTools.enabled', () => {
    setScopeConfig({ allowedDomains: ['example.com'], enforcement: 'hard' })
    setExternalToolsConfig({ enabled: true })
    expect(isExternalToolEnabled('nuclei')).toBe(true)
    expect(isActionAuthorized('external_tool', { toolId: 'nuclei' })).toBe(true)
  })

  it('external_tool opt-in can be narrowed per-tool', () => {
    setScopeConfig({ allowedDomains: ['example.com'], enforcement: 'hard' })
    setExternalToolsConfig({ enabled: true, tools: { nuclei: true } })
    expect(isActionAuthorized('external_tool', { toolId: 'nuclei' })).toBe(true)
    expect(isActionAuthorized('external_tool', { toolId: 'sqlmap' })).toBe(false)
  })

  it('external_tool needs BOTH opt-in and whitelist inclusion when a whitelist exists', () => {
    setScopeConfig({ allowedDomains: ['example.com'], allowedCategories: ['read'], enforcement: 'hard' })
    setExternalToolsConfig({ enabled: true, tools: { nuclei: true } })
    expect(isActionAuthorized('external_tool', { toolId: 'nuclei' })).toBe(false)
    setScopeConfig({ allowedDomains: ['example.com'], allowedCategories: ['read', 'external_tool'], enforcement: 'hard' })
    expect(isActionAuthorized('external_tool', { toolId: 'nuclei' })).toBe(true)
  })
})

describe('approveScopeOrigin', () => {
  beforeEach(resetAmbient)
  afterEach(resetAmbient)

  it('merges an approved origin host into the ambient allowedDomains (idempotent)', () => {
    const scope: ScopeConfig = { allowedDomains: ['example.com'], enforcement: 'hard' }
    setScopeConfig(scope)
    approveScopeOrigin('https://cdn.example.net/app.js')
    approveScopeOrigin('https://cdn.example.net/other.js')
    expect(getScopeConfig()?.allowedDomains).toEqual(['example.com', 'cdn.example.net'])
  })

  it('no-ops without ambient config and for invalid urls', () => {
    approveScopeOrigin('https://cdn.example.net/app.js')
    setScopeConfig({ allowedDomains: ['example.com'], enforcement: 'hard' })
    approveScopeOrigin('not-a-url')
    expect(getScopeConfig()?.allowedDomains).toEqual(['example.com'])
  })
})
