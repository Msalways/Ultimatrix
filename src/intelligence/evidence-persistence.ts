/**
 * Evidence Ledger Persistence — save/load evidence items across sessions.
 *
 * Wraps EvidenceLedger with file I/O so evidence survives process restart.
 * Persists to output/evidence/<engagementId>.json.
 *
 * Purpose: Cross-session evidence verification.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { log } from '../utils/logger'
import type { EvidenceItem } from './evidence-ledger'

export interface EvidenceFile {
  version: 1
  engagementId: string
  updatedAt: string
  items: EvidenceItem[]
}

const DEFAULT_DIR = resolve('output', 'evidence')

export function persistEvidence(
  items: EvidenceItem[],
  engagementId: string,
  dir?: string,
): string {
  const baseDir = dir ?? DEFAULT_DIR
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })

  const filePath = resolve(baseDir, `${engagementId}.json`)
  const data: EvidenceFile = {
    version: 1,
    engagementId,
    updatedAt: new Date().toISOString(),
    items,
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  log.dim(`[evidence] persisted ${items.length} items to ${filePath}`)
  return filePath
}

export function loadEvidence(
  engagementId: string,
  dir?: string,
): EvidenceItem[] {
  const baseDir = dir ?? DEFAULT_DIR
  const filePath = resolve(baseDir, `${engagementId}.json`)

  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as EvidenceFile
    log.dim(`[evidence] loaded ${data.items.length} items from ${filePath}`)
    return data.items
  } catch (err) {
    log.warn(`[evidence] failed to load ${filePath}: ${String(err)}`)
    return []
  }
}

export function listEngagements(dir?: string): string[] {
  const baseDir = dir ?? DEFAULT_DIR
  if (!existsSync(baseDir)) return []

  return readdirSync(baseDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
}
