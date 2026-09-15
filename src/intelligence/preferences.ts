/**
 * Preference Pairs — (rejected, chosen) pair recording for DPO foundation.
 *
 * Records when:
 *   - User corrects an action (rejected: what LLM did, chosen: what user wanted)
 *   - Exploit proof fails vs succeeds
 *   - Outcome feedback marks a technique as accepted vs rejected
 *
 * Purpose: Foundation for future DPO fine-tuning (data collection only now).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { randomBytes } from 'crypto'
import { log } from '../utils/logger'

export interface PreferencePair {
  id: string
  source: 'user_correction' | 'exploit_proof' | 'outcome_feedback'
  rejected: { action: string; reason: string }
  chosen: { action: string; reason: string }
  context: string
  timestamp: string
  engagementId?: string
}

export interface PreferencesFile {
  version: 1
  updatedAt: string
  pairs: PreferencePair[]
}

const DEFAULT_PATH = resolve('output', 'preferences.json')

export class PreferencesManager {
  private data: PreferencesFile
  private filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH
    this.data = this.load()
  }

  private load(): PreferencesFile {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf-8')) as PreferencesFile
      }
    } catch (err) {
      log.warn(`[preferences] Failed to load: ${String(err)}`)
    }
    return { version: 1, updatedAt: new Date().toISOString(), pairs: [] }
  }

  private save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.data.updatedAt = new Date().toISOString()
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  /** Record a preference pair. */
  record(
    source: PreferencePair['source'],
    rejected: PreferencePair['rejected'],
    chosen: PreferencePair['chosen'],
    context: string,
    engagementId?: string,
  ): PreferencePair {
    const pair: PreferencePair = {
      id: randomBytes(8).toString('hex'),
      source,
      rejected,
      chosen,
      context,
      timestamp: new Date().toISOString(),
      engagementId,
    }
    this.data.pairs.push(pair)
    this.save()
    return pair
  }

  /** Get all preference pairs. */
  getAll(): PreferencePair[] {
    return this.data.pairs
  }

  /** Get pairs for a specific context (endpoint/technique). */
  getByContext(context: string): PreferencePair[] {
    return this.data.pairs.filter(p => p.context.includes(context))
  }

  /** Get pairs by source type. */
  getBySource(source: PreferencePair['source']): PreferencePair[] {
    return this.data.pairs.filter(p => p.source === source)
  }

  /** Export as DPO format for fine-tuning. */
  exportDPO(): Array<{ rejected: string; chosen: string; context: string }> {
    return this.data.pairs.map(p => ({
      rejected: `${p.rejected.action} (${p.rejected.reason})`,
      chosen: `${p.chosen.action} (${p.chosen.reason})`,
      context: p.context,
    }))
  }

  /** Get count. */
  count(): number {
    return this.data.pairs.length
  }
}

let _instance: PreferencesManager | null = null

export function getPreferencesManager(filePath?: string): PreferencesManager {
  if (!_instance) _instance = new PreferencesManager(filePath)
  return _instance
}
