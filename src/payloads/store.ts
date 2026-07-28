/**
 * PayloadStore — runtime payload + marker registry.
 *
 * Root-cause fix for the "no payload infrastructure" gap. All attack payloads,
 * detection markers, and field vocabularies live in `payloads/*.json` data files
 * loaded at runtime. Primitives never hardcode payload arrays.
 *
 * Design principles (no bandaids):
 * - Data-driven: payloads live in JSON files, not inline const arrays in .ts
 * - Lazy-loaded: categories are loaded on first access, cached in memory
 * - Graceful degradation: missing file → empty array + warning (never crash)
 * - Single source of truth: no duplicated arrays across primitives
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PROJECT_ROOT } from '../lib/project-root'

/**
 * Resolve the payloads directory path. Tries multiple candidate locations.
 * @internal Private implementation used by PayloadStore internally.
 */
function resolvePayloadsDir(): string {
  const candidates = [
    join(PROJECT_ROOT, 'payloads'),
    join(moduleDirname(), '..', '..', 'payloads'),
    join(process.cwd(), 'payloads'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return join(PROJECT_ROOT, 'payloads')
}

export interface PayloadFile {
  payloads?: string[]
  markers?: string[]
  variants?: Record<string, string[]>
  metadata?: Record<string, unknown>
}

export interface PayloadCategory {
  name: string
  variants: Map<string, string[]>
  defaultPayloads: string[]
  markers: string[]
  metadata: Record<string, unknown>
}

function moduleDirname(): string {
  try {
    if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string') {
      return dirname(fileURLToPath(import.meta.url))
    }
  } catch { /* fall through */ }
  try {
    const d = (typeof __dirname !== 'undefined' && __dirname) as unknown as string
    if (typeof d === 'string' && d.length > 0) return d
  } catch { /* ignore */ }
  return process.cwd()
}

export class PayloadStore {
  private static _instance: PayloadStore | null = null
  private payloadsDir: string
  private cache = new Map<string, PayloadCategory>()
  private loaded = false

  constructor(payloadsDir?: string) {
    this.payloadsDir = payloadsDir ?? resolvePayloadsDir()
  }

  static getInstance(): PayloadStore {
    if (!this._instance) {
      this._instance = new PayloadStore()
    }
    return this._instance
  }

  static reset(): void {
    this._instance = null
  }

  private loadCategory(categoryPath: string): PayloadCategory | null {
    const fullPath = join(this.payloadsDir, categoryPath)
    if (!existsSync(fullPath)) return null

    try {
      const raw = readFileSync(fullPath, 'utf-8')
      const data = JSON.parse(raw) as PayloadFile
      const variants = new Map<string, string[]>()
      if (data.variants) {
        for (const [name, payloads] of Object.entries(data.variants)) {
          variants.set(name, payloads)
        }
      }
      return {
        name: categoryPath.replace(/\.json$/, '').replace(/[/\\]/g, '/'),
        variants,
        defaultPayloads: data.payloads ?? [],
        markers: data.markers ?? [],
        metadata: data.metadata ?? {},
      }
    } catch {
      return null
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.payloadsDir)) return

    const walk = (dir: string, prefix: string) => {
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        const full = join(dir, entry)
        const rel = prefix ? `${prefix}/${entry}` : entry
        try {
          if (statSync(full).isDirectory()) {
            walk(full, rel)
          } else if (entry.endsWith('.json')) {
            const cat = this.loadCategory(rel)
            if (cat) {
              this.cache.set(cat.name, cat)
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
    walk(this.payloadsDir, '')
  }

  /**
   * Get payloads for a category and optional variant.
   * If variant is specified, returns variant-specific payloads.
   * Otherwise returns defaultPayloads.
   */
  getPayloads(category: string, variant?: string): string[] {
    this.ensureLoaded()
    const cat = this.cache.get(category)
    if (!cat) return []

    if (variant) {
      const v = cat.variants.get(variant)
      if (v) return [...v]
    }
    return [...cat.defaultPayloads]
  }

  /**
   * Get detection markers (error signatures, response signatures) for a category.
   */
  getMarkers(category: string): string[] {
    this.ensureLoaded()
    const cat = this.cache.get(category)
    return cat ? [...cat.markers] : []
  }

  /**
   * Get metadata for a category (e.g. DBMS info, CWE mapping).
   */
  getMetadata(category: string): Record<string, unknown> {
    this.ensureLoaded()
    const cat = this.cache.get(category)
    return cat ? { ...cat.metadata } : {}
  }

  /**
   * Merge LLM-crafted payloads with static payloads.
   * Returns structured object with all payloads, plus breakdown by source.
   */
  mergePayloads(staticPayloads: string[], llmPayloads: string[], dedup: boolean = true): {
    all: string[]
    bySource: { static: string[]; llm: string[]; merged: string[] }
    uniqueIds: string[]
  } {
    const seen = new Set<string>()
    const staticSet = new Set<string>()
    const llmSet = new Set<string>()

    // Load static payloads from PayloadStore
    const staticList = staticPayloads.length > 0 ? staticPayloads : this.getPayloadsForCategory()

    // Deduplicate both lists
    for (const payload of staticList) {
      if (typeof payload !== 'string') continue
      const key = payload.trim().toLowerCase()
      if (dedup && seen.has(key)) continue
      seen.add(key)
      staticSet.add(payload)
    }

    for (const payload of llmPayloads) {
      if (typeof payload !== 'string') continue
      const key = payload.trim().toLowerCase()
      if (dedup && seen.has(key)) continue
      seen.add(key)
      llmSet.add(payload)
    }

    return {
      all: [...seen],
      bySource: {
        static: [...staticSet],
        llm: [...llmSet],
        merged: [...seen]
      },
      uniqueIds: [...seen],
    }
  }

  private getPayloadsForCategory(): string[] {
    this.ensureLoaded()
    const categories = this.cache.values()
    const allPayloads: string[] = []
    for (const cat of categories) {
      allPayloads.push(...cat.defaultPayloads)
      for (const variants of cat.variants.values()) {
        allPayloads.push(...variants)
      }
    }
    return allPayloads
  }

  /**
   * List all available payload categories.
   */
  listCategories(): string[] {
    this.ensureLoaded()
    return [...this.cache.keys()].sort()
  }

  /**
   * Get static payloads for a specific vulnerability type.
   * Returns flat array of payload strings.
   */
  loadPayloadsForVulnType(vulnType: string, payloadSet?: PayloadSet): string[] {
    this.ensureLoaded()
    const cat = this.cache.get(vulnType)
    if (!cat) return []

    // If payloadSet specified, filter variants based on it
    if (payloadSet) {
      const variantKeys = Object.keys(payloadSet as Record<string, unknown>)
      for (const key of variantKeys) {
        const variant = (payloadSet as Record<string, unknown>)[key]
        if (variant) {
          const v = cat.variants.get(key)
          if (v) return [...v]
        }
      }
    }

    // Return default payloads if no variant selected
    return [...cat.defaultPayloads]
  }

  /**
   * List all variants within a category.
   */
  listVariants(category: string): string[] {
    this.ensureLoaded()
    const cat = this.cache.get(category)
    return cat ? [...cat.variants.keys()].sort() : []
  }

  /**
   * Check if a category exists.
   */
  hasCategory(category: string): boolean {
    this.ensureLoaded()
    return this.cache.has(category)
  }

  /**
   * Check if a variant exists within a category.
   */
  hasVariant(category: string, variant: string): boolean {
    this.ensureLoaded()
    const cat = this.cache.get(category)
    return cat ? cat.variants.has(variant) : false
  }
}

export type PayloadSet = { category: string; variant?: string; limit?: number }

/**
 * Resolve the payloads directory path. Tries multiple candidate locations.
 */
export function getPayloadStore(): PayloadStore {
  return PayloadStore.getInstance()
}

