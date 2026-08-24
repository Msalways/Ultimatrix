/**
 * Skill Import Validation Gate (Phase D, spec 04 D5).
 *
 * Structural lesson from the P0 stripped-skills audit made enforceable:
 * imported skills must be COMPLETE before they can enter the index.
 *
 * Checks (fail-closed, precise errors):
 * - YAML frontmatter present and parseable
 * - required fields: name, description
 * - folder/file name === frontmatter name (loader identity rule)
 * - toolRefs ⊆ TOOL_IDS (drift guard)
 * - primitives ⊆ primitive registry (drift guard)
 * - non-empty fenced code blocks (a payload-stripped skill is rejected)
 * - BOM stripped before parsing (known gotcha)
 * - size caps (DoS guard for web/CLI imports)
 */

import { readFileSync } from 'fs'
import { load as yamlLoad } from 'js-yaml'
import { TOOL_IDS } from '../../mastra/tools'
import { listPrimitives } from '../../primitives/index'

export interface SkillValidationResult {
  valid: boolean
  meta?: {
    name: string
    description: string
    toolRefs: string[]
    primitives: string[]
    triggers: string[]
  }
  errors: string[]
}

const MAX_SKILL_BYTES = 256 * 1024

export function validateSkillMarkdown(markdown: string, expectedName?: string): SkillValidationResult {
  const errors: string[] = []

  if (!markdown || markdown.trim().length === 0) {
    return { valid: false, errors: ['skill file is empty'] }
  }
  if (Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_BYTES) {
    return { valid: false, errors: [`skill exceeds ${MAX_SKILL_BYTES} bytes`] }
  }

  const clean = markdown.charCodeAt(0) === 0xFEFF ? markdown.slice(1) : markdown
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { valid: false, errors: ['missing YAML frontmatter block (--- ... ---)'] }
  }

  let meta: Record<string, unknown>
  try {
    meta = (yamlLoad(match[1]) ?? {}) as Record<string, unknown>
  } catch (err) {
    return { valid: false, errors: [`frontmatter YAML parse error: ${err instanceof Error ? err.message : String(err)}`] }
  }

  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''
  if (!name) errors.push('frontmatter missing required field: name')
  if (!description) errors.push('frontmatter missing required field: description')
  if (expectedName && name && name !== expectedName.replace(/\.md$/i, '')) {
    errors.push(`folder/file name "${expectedName}" does not match frontmatter name "${name}"`)
  }

  const toolRefs = Array.isArray(meta.toolRefs) ? meta.toolRefs.filter((t): t is string => typeof t === 'string') : []
  const registry = new Set(TOOL_IDS as readonly string[])
  for (const ref of toolRefs) {
    if (!registry.has(ref)) errors.push(`toolRefs references unknown tool: ${ref}`)
  }

  const primitives = Array.isArray(meta.primitives) ? meta.primitives.filter((p): p is string => typeof p === 'string') : []
  let primitiveIds: Set<string>
  try {
    primitiveIds = new Set(listPrimitives().map(p => p.id))
  } catch {
    primitiveIds = new Set()
  }
  for (const p of primitives) {
    if (primitiveIds.size > 0 && !primitiveIds.has(p)) errors.push(`primitives references unknown primitive: ${p}`)
  }

  // Non-empty fenced blocks required — the P0 audit's stripped-payload defect
  // is rejected at the door.
  const fenceRe = /^```/gm
  let open = -1
  let blockCount = 0
  let emptyBlocks = 0
  let hasContent = false
  const lines = clean.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) {
      if (open === -1) {
        open = i
        hasContent = false
      } else {
        blockCount++
        if (!hasContent) emptyBlocks++
        open = -1
      }
    } else if (open !== -1 && lines[i].trim() !== '') {
      hasContent = true
    }
  }
  if (open !== -1) errors.push('unclosed code fence — every ``` must be closed')
  if (emptyBlocks > 0) errors.push(`${emptyBlocks} empty fenced block(s) — payload-stripped skills are rejected`)

  if (blockCount === 0) {
    // Not every skill needs code fences, but attack skills without a single
    // payload/example block are exactly the stripped-corpus failure mode.
    errors.push('no fenced content blocks found — an operational skill carries payloads/examples')
  }

  const triggers = Array.isArray(meta.triggers) ? meta.triggers.filter((t): t is string => typeof t === 'string') : []

  return {
    valid: errors.length === 0,
    meta: errors.length === 0 ? { name, description, toolRefs, primitives, triggers } : undefined,
    errors,
  }
}

/** Validate a file on disk. */
export function validateSkillFile(path: string, expectedName?: string): SkillValidationResult {
  try {
    return validateSkillMarkdown(readFileSync(path, 'utf-8'), expectedName)
  } catch (err) {
    return { valid: false, errors: [`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`] }
  }
}
