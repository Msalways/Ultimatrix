/**
 * Live Model Registry (Phase 9).
 *
 * Layered model profile resolution: bundled seed -> disk cache -> live provider metadata.
 * Fallback policy: live unavailable -> last-known cache -> bundled seed.
 * Never erases previously valid provider data because one refresh failed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

// --- Model Profile ---

export interface ModelProfile {
  provider: string
  modelId: string
  contextWindow?: number
  maxOutputTokens?: number
  toolCalling?: boolean
  structuredOutput?: boolean
  vision?: boolean
  reasoningClass?: 'small' | 'medium' | 'strong'
  costClass?: 'low' | 'medium' | 'high'
  latencyClass?: 'low' | 'medium' | 'high'
  source: 'seed' | 'cache' | 'live'
}

// --- Bundled Seed Data ---

const BUNDLED_SEEDS: ModelProfile[] = [
  { provider: 'groq', modelId: 'llama3-8b-8192', contextWindow: 8192, maxOutputTokens: 2048, toolCalling: true, reasoningClass: 'small', costClass: 'low', latencyClass: 'low', source: 'seed' },
  { provider: 'groq', modelId: 'llama3-70b-8192', contextWindow: 8192, maxOutputTokens: 2048, toolCalling: true, reasoningClass: 'medium', costClass: 'low', latencyClass: 'low', source: 'seed' },
  { provider: 'groq', modelId: 'llama-3.3-70b-versatile', contextWindow: 131072, maxOutputTokens: 32768, toolCalling: true, reasoningClass: 'strong', costClass: 'low', latencyClass: 'low', source: 'seed' },
  { provider: 'groq', modelId: 'llama-3.1-8b-instant', contextWindow: 131072, maxOutputTokens: 8192, toolCalling: true, reasoningClass: 'small', costClass: 'low', latencyClass: 'low', source: 'seed' },
  { provider: 'openai', modelId: 'gpt-4o', contextWindow: 128000, maxOutputTokens: 16384, toolCalling: true, structuredOutput: true, vision: true, reasoningClass: 'strong', costClass: 'high', latencyClass: 'medium', source: 'seed' },
  { provider: 'openai', modelId: 'gpt-4o-mini', contextWindow: 128000, maxOutputTokens: 16384, toolCalling: true, structuredOutput: true, vision: true, reasoningClass: 'medium', costClass: 'low', latencyClass: 'medium', source: 'seed' },
  { provider: 'anthropic', modelId: 'claude-3-5-sonnet', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, vision: true, reasoningClass: 'strong', costClass: 'high', latencyClass: 'medium', source: 'seed' },
  { provider: 'anthropic', modelId: 'claude-3-opus', contextWindow: 200000, maxOutputTokens: 4096, toolCalling: true, vision: true, reasoningClass: 'strong', costClass: 'high', latencyClass: 'medium', source: 'seed' },
  { provider: 'google', modelId: 'gemini-2.0-flash', contextWindow: 1048576, maxOutputTokens: 8192, toolCalling: true, vision: true, reasoningClass: 'medium', costClass: 'low', latencyClass: 'low', source: 'seed' },
  { provider: 'google', modelId: 'gemini-2.5-pro', contextWindow: 1048576, maxOutputTokens: 8192, toolCalling: true, vision: true, reasoningClass: 'strong', costClass: 'medium', latencyClass: 'medium', source: 'seed' },
  { provider: 'nvidia', modelId: 'nemotron-3-ultra-550b', contextWindow: 131072, maxOutputTokens: 4096, toolCalling: true, reasoningClass: 'strong', costClass: 'medium', latencyClass: 'medium', source: 'seed' },
  { provider: 'nvidia', modelId: 'nemotron-3-ultra-550b-a55b', contextWindow: 1000000, maxOutputTokens: 32768, toolCalling: true, structuredOutput: false, reasoningClass: 'strong', costClass: 'low', latencyClass: 'medium', source: 'seed' },
  { provider: 'nvidia', modelId: 'nemotron-3-super-120b-a12b', contextWindow: 1000000, maxOutputTokens: 32768, toolCalling: true, structuredOutput: false, reasoningClass: 'strong', source: 'seed' },
  { provider: 'nvidia', modelId: 'nemotron-3.5-lightning-30b-a3b', contextWindow: 1000000, maxOutputTokens: 32768, toolCalling: true, reasoningClass: 'strong', costClass: 'low', latencyClass: 'low', source: 'seed' },
  // OpenRouter's free route publishes its own context/output limits and uses a
  // nested upstream slug. Keep the route profile so safe dispatch can resolve
  // `openrouter` + `nvidia/...:free` without guessing from the suffix.
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', contextWindow: 1000000, maxOutputTokens: 65536, toolCalling: true, structuredOutput: false, reasoningClass: 'strong', costClass: 'low', latencyClass: 'medium', source: 'seed' },
]

// --- Registry ---

export class LiveModelRegistry {
  private profiles: Map<string, ModelProfile> = new Map()
  private cachePath: string | undefined
  private lastRefresh = 0
  private readonly REFRESH_INTERVAL_MS = 3600_000 // 1 hour

  constructor(cachePath?: string) {
    this.cachePath = cachePath
    this.loadSeeds()
    this.loadCache()
  }

  private loadSeeds(): void {
    for (const profile of BUNDLED_SEEDS) {
      const key = `${profile.provider}/${profile.modelId}`
      this.profiles.set(key, profile)
    }
  }

  private loadCache(): void {
    if (!this.cachePath) return
    try {
      if (!existsSync(this.cachePath)) return
      const raw = readFileSync(this.cachePath, 'utf-8')
      const cached = JSON.parse(raw) as ModelProfile[]
      for (const profile of cached) {
        const key = `${profile.provider}/${profile.modelId}`
        const existing = this.profiles.get(key)
        if (!existing || existing.source === 'seed') {
          this.profiles.set(key, { ...profile, source: 'cache' })
        }
      }
    } catch {
      // Cache corruption is non-fatal; seed data remains valid
    }
  }

  private saveCache(): void {
    if (!this.cachePath) return
    try {
      const dir = dirname(this.cachePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const profiles = Array.from(this.profiles.values())
      writeFileSync(this.cachePath, JSON.stringify(profiles, null, 2), 'utf-8')
    } catch {
      // Best-effort cache write
    }
  }

  /**
   * Refresh from live provider metadata. On failure, last-known cache
   * and seed data are never erased.
   */
  async refresh(providerEndpoints?: Record<string, () => Promise<Partial<ModelProfile>[]>>): Promise<{ refreshed: number; failed: string[] }> {
    if (!providerEndpoints) return { refreshed: 0, failed: [] }

    let refreshed = 0
    const failed: string[] = []

    for (const [provider, fetcher] of Object.entries(providerEndpoints)) {
      try {
        const models = await fetcher()
        for (const model of models) {
          if (!model.modelId) continue
          const key = `${provider}/${model.modelId}`
          const existing = this.profiles.get(key)
          const merged: ModelProfile = {
            provider,
            modelId: model.modelId,
            contextWindow: model.contextWindow ?? existing?.contextWindow,
            maxOutputTokens: model.maxOutputTokens ?? existing?.maxOutputTokens,
            toolCalling: model.toolCalling ?? existing?.toolCalling,
            structuredOutput: model.structuredOutput ?? existing?.structuredOutput,
            vision: model.vision ?? existing?.vision,
            reasoningClass: model.reasoningClass ?? existing?.reasoningClass,
            costClass: model.costClass ?? existing?.costClass,
            latencyClass: model.latencyClass ?? existing?.latencyClass,
            source: 'live',
          }
          this.profiles.set(key, merged)
          refreshed++
        }
        this.lastRefresh = Date.now()
      } catch {
        failed.push(provider)
      }
    }

    if (refreshed > 0) this.saveCache()
    return { refreshed, failed }
  }

  /** Get a model profile by provider/modelId key */
  getProfile(provider: string, modelId: string): ModelProfile | undefined {
    const key = `${provider}/${modelId}`
    return this.profiles.get(key)
  }

  /** Get all known profiles, optionally filtered by provider */
  listProfiles(provider?: string): ModelProfile[] {
    const all = Array.from(this.profiles.values())
    if (provider) return all.filter(p => p.provider === provider)
    return all
  }

  /** Check if a refresh is needed */
  needsRefresh(): boolean {
    return Date.now() - this.lastRefresh > this.REFRESH_INTERVAL_MS
  }

  /** Get profiles matching a reasoning class */
  getByReasoningClass(cls: 'small' | 'medium' | 'strong'): ModelProfile[] {
    return this.listProfiles().filter(p => p.reasoningClass === cls)
  }

  /** Check if a model supports a required capability */
  supportsCapability(provider: string, modelId: string, cap: 'toolCalling' | 'structuredOutput' | 'vision'): boolean {
    const profile = this.getProfile(provider, modelId)
    if (!profile) return false
    return profile[cap] === true
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.profiles.clear()
    this.loadSeeds()
    this.lastRefresh = 0
  }
}

// --- Singleton ---

let globalRegistry: LiveModelRegistry | undefined

export function getGlobalModelRegistry(cachePath?: string): LiveModelRegistry {
  if (!globalRegistry) {
    globalRegistry = new LiveModelRegistry(cachePath)
  }
  return globalRegistry
}

export function resetGlobalModelRegistry(): void {
  globalRegistry = undefined
}
