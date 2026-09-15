/**
 * Mistake Tracking — cross-session error fingerprinting.
 *
 * Adapted from PWN's mistakes.json system:
 *   - Fingerprint errors by tool + normalized error pattern
 *   - Track occurrences across sessions
 *   - Tag [REPEATING] / [REGRESSED]
 *   - Inject KNOWN MISTAKES into brain prompt
 *
 * Purpose: Don't repeat the same mistake twice.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { createHash } from 'crypto'
import { log } from '../utils/logger'

// ─── Types ──────────────────────────────────────────────────────────

export type MistakeTag = 'repeating' | 'regressed'

export interface Mistake {
  /** SHA-256 of (toolName + normalizedError) */
  fingerprint: string
  /** Tool that produced the error */
  toolName: string
  /** Normalized error description */
  errorPattern: string
  /** Number of times this error occurred */
  occurrences: number
  /** ISO timestamp of first occurrence */
  firstSeen: string
  /** ISO timestamp of most recent occurrence */
  lastSeen: string
  /** What worked last time to fix this */
  fix?: string
  /** Whether the fix has been confirmed working */
  resolved: boolean
  /** Tags: repeating (same session) or regressed (was fixed, broke again) */
  tags: MistakeTag[]
}

export interface MistakesFile {
  version: 1
  updatedAt: string
  mistakes: Record<string, Mistake>
}

// ─── Fingerprinting ─────────────────────────────────────────────────

/**
 * Normalize an error string for fingerprinting.
 * Strips timestamps, UUIDs, numbers, and path-specific info.
 */
function normalizeError(error: string): string {
  return error
    // Strip timestamps (ISO) — BEFORE toLowerCase so T/Z are uppercase
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[Z]?\.\d*/g, 'TIMESTAMP')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[Z]?/g, 'TIMESTAMP')
    .toLowerCase()
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
    // Strip numeric IDs
    .replace(/\b\d{4,}\b/g, 'NUM')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

function computeFingerprint(toolName: string, normalizedError: string): string {
  return createHash('sha256')
    .update(`${toolName}:${normalizedError}`)
    .digest('hex')
    .slice(0, 16)
}

// ─── Mistake Manager ────────────────────────────────────────────────

const DEFAULT_PATH = resolve('output', 'mistakes.json')

export class MistakeManager {
  private data: MistakesFile
  private filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH
    this.data = this.load()
  }

  private load(): MistakesFile {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        return JSON.parse(raw) as MistakesFile
      }
    } catch (err) {
      log.warn(`[mistakes] Failed to load ${this.filePath}: ${String(err)}`)
    }
    return { version: 1, updatedAt: new Date().toISOString(), mistakes: {} }
  }

  private save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    this.data.updatedAt = new Date().toISOString()
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  /** Record a mistake. Returns the fingerprint. */
  record(toolName: string, error: string, fix?: string): string {
    const normalized = normalizeError(error)
    const fingerprint = computeFingerprint(toolName, normalized)
    const now = new Date().toISOString()

    const existing = this.data.mistakes[fingerprint]
    if (existing) {
      // Check for regression (was resolved, now reappearing)
      if (existing.resolved && !existing.tags.includes('regressed')) {
        existing.tags.push('regressed')
        log.warn(`[mistakes] REGRESSED: ${toolName} — ${normalized}`)
      }

      existing.occurrences++
      existing.lastSeen = now
      if (fix) existing.fix = fix
    } else {
      this.data.mistakes[fingerprint] = {
        fingerprint,
        toolName,
        errorPattern: normalized,
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        fix,
        resolved: false,
        tags: [],
      }
    }

    this.save()
    return fingerprint
  }

  /** Mark a mistake as resolved (fix confirmed working). */
  resolve(fingerprint: string): void {
    const mistake = this.data.mistakes[fingerprint]
    if (mistake) {
      mistake.resolved = true
      mistake.tags = mistake.tags.filter(t => t !== 'regressed')
      this.save()
    }
  }

  /** Get all active (unresolved) mistakes. */
  getActiveMistakes(): Mistake[] {
    return Object.values(this.data.mistakes).filter(m => !m.resolved)
  }

  /** Get all mistakes (including resolved). */
  getAllMistakes(): Mistake[] {
    return Object.values(this.data.mistakes)
  }

  /** Get mistakes for a specific tool. */
  getByTool(toolName: string): Mistake[] {
    return Object.values(this.data.mistakes).filter(m => m.toolName === toolName)
  }

  /** Get a specific mistake by fingerprint. */
  get(fingerprint: string): Mistake | undefined {
    return this.data.mistakes[fingerprint]
  }

  /** Generate the KNOWN MISTAKES prompt block for the brain. */
  getMistakesPromptBlock(): string {
    const active = this.getActiveMistakes()
    if (active.length === 0) return ''

    const lines = ['## KNOWN MISTAKES (avoid these)', '']
    for (const m of active) {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : ''
      const fix = m.fix ? ` → Fix: ${m.fix}` : ''
      lines.push(`- **${m.toolName}**: ${m.errorPattern} (×${m.occurrences})${tags}${fix}`)
    }

    return lines.join('\n')
  }

  /** Clear all mistakes (fresh start). */
  clear(): void {
    this.data = { version: 1, updatedAt: new Date().toISOString(), mistakes: {} }
    this.save()
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let _instance: MistakeManager | null = null

export function getMistakeManager(filePath?: string): MistakeManager {
  if (!_instance) {
    _instance = new MistakeManager(filePath)
  }
  return _instance
}
