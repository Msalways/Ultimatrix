import { loadConfig, saveProvidersConfig, saveProjectConfig, validateConfig, resetConfigCache, ConfigError, type UltimatrixConfig, type ProviderCredentials } from '../config'

export async function getWebConfig(): Promise<UltimatrixConfig> {
  return loadConfig()
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
 * Masked values must NOT overwrite real keys in providers.yaml.
 */
function isMasked(value: string | undefined): boolean {
  return typeof value === 'string' && /^\*{4}/.test(value)
}

/**
 * Strip masked credential values from creds so we don't overwrite real keys.
 * Only keeps unmasked (user-edited) values.
 */
function stripMaskedCredentials(
  incoming: ProviderCredentials,
  current: ProviderCredentials,
): ProviderCredentials {
  const result: ProviderCredentials = { ...incoming }
  for (const [provider, entry] of Object.entries(result)) {
    if (!entry) continue
    const currentEntry = current[provider]
    if (!currentEntry) continue

    if ('apiKey' in entry && 'apiKey' in currentEntry) {
      if (isMasked(entry.apiKey) && !isMasked(currentEntry.apiKey)) {
        ;(entry as any).apiKey = currentEntry.apiKey
      }
    }
    // Azure
    if ('apiKey' in entry && provider === 'azure' && currentEntry && 'apiKey' in currentEntry) {
      if (isMasked((entry as any).apiKey) && !isMasked((currentEntry as any).apiKey)) {
        ;(entry as any).apiKey = (currentEntry as any).apiKey
      }
    }
    // Bedrock
    if (provider === 'bedrock' && entry && currentEntry) {
      if ('secretAccessKey' in entry && 'secretAccessKey' in currentEntry) {
        if (isMasked((entry as any).secretAccessKey) && !isMasked((currentEntry as any).secretAccessKey)) {
          ;(entry as any).secretAccessKey = (currentEntry as any).secretAccessKey
        }
      }
      if ((entry as any).sessionToken && isMasked((entry as any).sessionToken) && (currentEntry as any).sessionToken && !isMasked((currentEntry as any).sessionToken)) {
        ;(entry as any).sessionToken = (currentEntry as any).sessionToken
      }
      if ((entry as any).apiKey && isMasked((entry as any).apiKey) && (currentEntry as any).apiKey && !isMasked((currentEntry as any).apiKey)) {
        ;(entry as any).apiKey = (currentEntry as any).apiKey
      }
    }
  }
  return result
}

export async function saveWebConfig(updates: Partial<UltimatrixConfig>): Promise<{ ok: boolean; errors?: string[] }> {
  try {
    const current = await loadConfig()

    // Deep merge config (preserves nested objects)
    const merged = deepMerge(current as unknown as Record<string, unknown>, updates as unknown as Record<string, unknown>)

    // Validate merged config — throws ConfigError on failure
    try {
      validateConfig(merged)
    } catch (err) {
      if (err instanceof ConfigError) {
        return { ok: false, errors: [err.message] }
      }
      return { ok: false, errors: [String(err)] }
    }

    // Save credentials to providers.yaml (strip masked values first)
    if (updates.creds) {
      const cleanCreds = stripMaskedCredentials(updates.creds, current.creds)
      await saveProvidersConfig(cleanCreds)
    }

    // Save full project config to ultimatrix.yaml
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
  return masked
}
