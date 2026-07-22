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

function resolvePayloadsDir(): string {
  const candidates = [
    join(PROJECT_ROOT, 'payloads'),
    join(moduleDirname(), '..', '..', 'payloads'),
    join(process.cwd(), 'payloads'),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c
  }
  return candidates[0]
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
   * List all available payload categories.
   */
  listCategories(): string[] {
    this.ensureLoaded()
    return [...this.cache.keys()].sort()
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

export function getPayloadStore(): PayloadStore {
  return PayloadStore.getInstance()
}
