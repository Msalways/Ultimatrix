/**
 * GlobalMemoryStore — the ONLY write path into global (cross-engagement)
 * preference memory.
 *
 * Slice 11. Every write passes through the memory policy gate:
 *   • safe preference        → persisted to the global preferences file
 *   • workflow-scoped kind   → NOT persisted here; result reroutes to project
 *   • target-sensitive value → MemoryPolicyError (fail closed)
 *
 * Persisted to `output/global/global-preferences.json` — the same global dir
 * as cross-engagement memory, separate from per-target project memory.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'
import {
  evaluateMemoryWrite,
  recordMemoryPolicyDecision,
  MemoryPolicyError,
  type MemoryPolicyResult,
  type MemoryWriteRequest,
} from './policy'

export interface GlobalPreferencesFile {
  version: 1
  updatedAt: string
  preferences: Record<string, unknown>
}

function emptyFile(): GlobalPreferencesFile {
  return { version: 1, updatedAt: new Date().toISOString(), preferences: {} }
}

export class GlobalMemoryStore {
  private readonly path: string
  private loaded = false
  private file: GlobalPreferencesFile = emptyFile()

  constructor(opts?: { path?: string }) {
    this.path = opts?.path ?? resolve(getGlobalWorkspace().getGlobalMemoryDir(), 'global-preferences.json')
  }

  getPath(): string {
    return this.path
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (existsSync(this.path)) {
      try {
        const raw = await readFile(this.path, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<GlobalPreferencesFile>
        this.file = { ...emptyFile(), ...parsed, preferences: parsed.preferences ?? {} }
      } catch {
        this.file = emptyFile()
      }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const dir = resolve(this.path, '..')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    this.file.updatedAt = new Date().toISOString()
    await writeFile(this.path, JSON.stringify(this.file, null, 2), 'utf-8')
  }

  /**
   * Gated global write. Returns the policy result:
   *   - allowed + destination 'global' → persisted here.
   *   - allowed + destination 'project' → NOT persisted (caller routes to
   *     project/working memory).
   *   - blocked → throws MemoryPolicyError (fail closed).
   */
  async write(req: MemoryWriteRequest): Promise<MemoryPolicyResult> {
    const result = evaluateMemoryWrite(req)
    recordMemoryPolicyDecision(req, result)
    if (!result.allowed) throw new MemoryPolicyError(result)
    if (result.destination !== 'global') return result

    await this.ensureLoaded()
    const key = req.key ?? 'value'
    this.file.preferences[key] = req.value
    await this.persist()
    return result
  }

  /** Convenience: write a keyed user preference to global memory. */
  async writePreference(key: string, value: unknown, opts?: { workflowId?: string }): Promise<MemoryPolicyResult> {
    return this.write({ workflowId: opts?.workflowId, scope: 'global', kind: 'preference', key, value })
  }

  /** Read persisted global preferences (for tests / user-facing reads). */
  async readPreferences(): Promise<Record<string, unknown>> {
    await this.ensureLoaded()
    return { ...this.file.preferences }
  }
}
