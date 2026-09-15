import { loadConfig, saveProjectConfig, saveProvidersConfig, validateConfig, resetConfigCache, ConfigError, type UltimatrixConfig, type ProviderCredentials } from '../config'

export async function getWebConfig(): Promise<UltimatrixConfig> {
  return loadConfig({ requireCredentials: false })
}

/**
 * Deep merge source into target. Objects are recursively merged.
 * Arrays are replaced (not merged) — intentional for mcp[], plugins[], etc.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key]
    const tgtVal = result[key]
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      (result as any)[key] = deepMerge(tgtVal as any, srcVal as any)
    } else if (srcVal !== undefined) {
      (result as any)[key] = srcVal
    }
  }
  return result
}

/**
 * Detect masked credential values (****xxxx pattern).
 * Masked values must not overwrite real keys in providers.yaml.
 */
function isMasked(value: string | undefined): boolean {
  return typeof value === 'string' && value.includes('****')
}

/**
 * Strip masked credential values from creds so we don't overwrite real keys.
 * Only keeps unmasked (user-edited) values.
 */
function stripMaskedCredentials(
  incoming: ProviderCredentials,
  current: ProviderCredentials,
): ProviderCredentials {
  const result: ProviderCredentials = Object.fromEntries(
    Object.entries(incoming).map(([provider, entry]) => [
      provider,
      entry && typeof entry === 'object' ? { ...entry } : entry,
    ]),
  ) as ProviderCredentials
  for (const [provider, entry] of Object.entries(result)) {
    if (!entry || typeof entry !== 'object') continue
    const currentEntry = current[provider]
    if (!currentEntry || typeof currentEntry !== 'object') continue

    for (const [field, value] of Object.entries(entry)) {
      const currentValue = (currentEntry as unknown as Record<string, unknown>)[field]
      if (typeof value === 'string' && isMasked(value) && typeof currentValue === 'string' && !isMasked(currentValue)) {
        ;(entry as unknown as Record<string, unknown>)[field] = currentValue
      }
    }
  }
  return result
}

function restoreMaskedTestCredentials(
  incoming: Record<string, { email: string; password: string }>,
  current: Record<string, { email: string; password: string }> = {},
): Record<string, { email: string; password: string }> {
  return Object.fromEntries(Object.entries(incoming).map(([role, entry]) => {
    const password = isMasked(entry.password) ? current[role]?.password ?? entry.password : entry.password
    return [role, { ...entry, password }]
  }))
}

export async function saveWebConfig(updates: Partial<UltimatrixConfig>): Promise<{ ok: boolean; errors?: string[] }> {
  try {
    const current = await loadConfig({ requireCredentials: false })

    const safeUpdates = { ...updates }
    if (updates.creds) {
      safeUpdates.creds = stripMaskedCredentials(updates.creds, current.creds)
    }
    if (updates.providerKeys) {
      safeUpdates.providerKeys = stripMaskedCredentials(
        updates.providerKeys,
        current.providerKeys ?? {},
      ) as Record<string, { apiKey: string; baseUrl?: string }>
    }
    if (updates.credentials) {
      safeUpdates.credentials = restoreMaskedTestCredentials(updates.credentials, current.credentials)
    }

    // Deep merge config (preserves nested objects). Credentials AND model
    // maps are a complete replacement so deleting a provider or model
    // cannot be undone by the merge re-adding omitted keys.
    const merged = deepMerge(current as unknown as Record<string, unknown>, safeUpdates as unknown as Record<string, unknown>)
    if (safeUpdates.creds) merged.creds = safeUpdates.creds
    if (safeUpdates.providerKeys) merged.providerKeys = safeUpdates.providerKeys
    if (safeUpdates.credentials) merged.credentials = safeUpdates.credentials
    if (safeUpdates.modelTiers) merged.modelTiers = safeUpdates.modelTiers
    if (safeUpdates.modelCapabilities) merged.modelCapabilities = safeUpdates.modelCapabilities
    if (safeUpdates.modelRoles) merged.modelRoles = safeUpdates.modelRoles
    if (safeUpdates.modelRoleTiers) merged.modelRoleTiers = safeUpdates.modelRoleTiers

    // Validate merged config — throws ConfigError on failure
    try {
      validateConfig(merged)
    } catch (err) {
      if (err instanceof ConfigError) {
        return { ok: false, errors: [err.message] }
      }
      return { ok: false, errors: [String(err)] }
    }

    saveProvidersConfig((merged as unknown as UltimatrixConfig).creds)
    await saveProjectConfig(merged as unknown as UltimatrixConfig)
    resetConfigCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, errors: [String(err)] }
  }
}

export function maskCredentials(config: UltimatrixConfig): Record<string, unknown> {
  const masked = { ...config } as Record<string, unknown>
  if (masked.creds && typeof masked.creds === 'object') {
    const creds = { ...(masked.creds as Record<string, Record<string, unknown>>) }
    for (const [provider, providerCreds] of Object.entries(creds)) {
      if (providerCreds && typeof providerCreds === 'object') {
        const maskedProvider = { ...providerCreds }
        for (const key of Object.keys(maskedProvider)) {
          if (/key|secret|token|password/i.test(key) && typeof maskedProvider[key] === 'string') {
            const val = maskedProvider[key] as string
            maskedProvider[key] = val.length > 8
              ? val.slice(0, 4) + '****' + val.slice(-4)
              : '****'
          }
        }
        creds[provider] = maskedProvider
      }
    }
    masked.creds = creds
  }
  if (masked.providerKeys && typeof masked.providerKeys === 'object') {
    const providerKeys = { ...(masked.providerKeys as Record<string, Record<string, unknown>>) }
    for (const [provider, entry] of Object.entries(providerKeys)) {
      if (!entry || typeof entry !== 'object') continue
      const copy = { ...entry }
      if (typeof copy.apiKey === 'string') {
        const value = copy.apiKey
        copy.apiKey = value.length > 8 ? value.slice(0, 4) + '****' + value.slice(-4) : '****'
      }
      providerKeys[provider] = copy
    }
    masked.providerKeys = providerKeys
  }
  if (masked.credentials && typeof masked.credentials === 'object') {
    const credentials = { ...(masked.credentials as Record<string, { email: string; password: string }>) }
    for (const [role, entry] of Object.entries(credentials)) {
      credentials[role] = { ...entry, password: '****' }
    }
    masked.credentials = credentials
  }
  return masked
}
