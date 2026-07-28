/**
 * Persona Loader — reads .md persona files with YAML frontmatter.
 *
 * No external YAML dependency. Parses simple key: value frontmatter between
 * --- delimiters. Supports string, string[], and nested object values.
 *
 * Files are cached after first load (they don't change at runtime).
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function moduleDirname(): string {
  try {
    if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string') {
      return dirname(fileURLToPath(import.meta.url))
    }
  } catch {
    /* fall through */
  }
  try {
    const d = typeof __dirname !== 'undefined' ? (__dirname as unknown as string) : undefined
    if (typeof d === 'string' && d.length > 0) return d
  } catch {
    /* __dirname not defined in ESM — ignore */
  }
  return process.cwd()
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PersonaMetadata {
  id: string
  name: string
  role?: string
  tier?: string
  description?: string
  toolRestrictions?: string | string[]
  expertise?: string[]
  constraints?: string[]
  authority?: string
  backstory?: string
  perspective?: string
  debateBehavior?: string
  [key: string]: unknown
}

export interface LoadedPersona {
  metadata: PersonaMetadata
  prompt: string
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new Map<string, LoadedPersona>()
let personasDir: string | null = null

function getPersonasDir(): string {
  if (!personasDir) {
    // Resolve relative to this file's location: src/council/persona-loader.ts → src/council/personas/
    personasDir = resolve(moduleDirname(), 'personas')
  }
  return personasDir
}

// ─── YAML frontmatter parser (no dependency) ────────────────────────────────

/**
 * Parse simple YAML frontmatter from a markdown file.
 * Handles: strings, string arrays (YAML block or inline), nested objects.
 * Does NOT handle: anchors, aliases, multi-document, complex nesting.
 * This is sufficient for persona metadata.
 */
function parseFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, body: content }
  }

  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) {
    return { metadata: {}, body: content }
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const body = trimmed.slice(endIndex + 3).trim()

  const metadata: Record<string, unknown> = {}
  let currentKey: string | null = null
  let currentArray: string[] | null = null
  let inBlockScalar = false
  let blockValue = ''

  for (const rawLine of yamlBlock.split('\n')) {
    const line = rawLine.replace(/\r$/, '')

    // Block scalar start (key: >)
    if (currentKey && !inBlockScalar && /^>\s*$/.test(line.trim())) {
      inBlockScalar = true
      blockValue = ''
      continue
    }

    if (inBlockScalar) {
      if (line.trim() === '' || line.startsWith('  ')) {
        blockValue += (blockValue ? ' ' : '') + line.trim()
      } else {
        // End of block scalar
        if (currentKey) {
          metadata[currentKey] = blockValue
        }
        inBlockScalar = false
        currentKey = null
        currentArray = null
        // Fall through to process this line normally
      }
      if (inBlockScalar) continue
    }

    // New key: value pair
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kvMatch) {
      // Save previous array
      if (currentKey && currentArray) {
        metadata[currentKey] = currentArray
        currentArray = null
      }
      // Save previous scalar
      if (currentKey && !currentArray && !(currentKey in metadata)) {
        // already handled by inline
      }

      const [, key, value] = kvMatch

      const trimmedValue = value.trim()
      if (trimmedValue === '>' || trimmedValue === '|') {
        // Block scalar — start collecting continuation lines
        inBlockScalar = true
        blockValue = ''
        currentKey = key
        currentArray = null
      } else if (trimmedValue === '') {
        // Could be start of array — check next lines
        currentArray = []
        currentKey = key
      } else if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
        // Inline array: [a, b, c]
        metadata[key] = trimmedValue.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        currentKey = null
      } else {
        // Scalar value
        metadata[key] = stripQuotes(trimmedValue)
        currentKey = key
        currentArray = null
      }
      continue
    }

    // Array item (- value)
    const arrMatch = line.match(/^\s+-\s+(.+)$/)
    if (arrMatch && currentKey) {
      if (!currentArray) {
        currentArray = []
      }
      currentArray.push(stripQuotes(arrMatch[1].trim()))
      continue
    }

    // Nested object (key: value on indented line after array)
    const nestedMatch = line.match(/^\s{2}(\w[\w-]*):\s+(.+)$/)
    if (nestedMatch && currentKey) {
      if (!currentArray) {
        currentArray = []
      }
      currentArray.push(`${nestedMatch[1]}: ${nestedMatch[2].trim()}`)
      continue
    }
  }

  // Flush remaining
  if (currentKey && currentArray) {
    metadata[currentKey] = currentArray
  }
  if (currentKey && inBlockScalar) {
    metadata[currentKey] = blockValue
  }

  return { metadata, body }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

// ─── Loader ─────────────────────────────────────────────────────────────────

function loadFile(filename: string): LoadedPersona {
  if (cache.has(filename)) return cache.get(filename)!

  const filePath = resolve(getPersonasDir(), filename)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(`Persona file not found: ${filePath}`)
  }

  const { metadata, body } = parseFrontmatter(raw)
  const persona: LoadedPersona = {
    metadata: metadata as PersonaMetadata,
    prompt: body,
  }

  cache.set(filename, persona)
  return persona
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Load a role persona by role name. */
export function loadPersonaFile(role: string): LoadedPersona {
  return loadFile(`${role}.md`)
}

/** Load the shared team charter. */
export function loadCharter(): LoadedPersona {
  return loadFile('charter.md')
}

/** Load the debate protocol. */
export function loadDebateProtocol(): LoadedPersona {
  return loadFile('debate-protocol.md')
}

/** Load the output contract. */
export function loadOutputContract(): LoadedPersona {
  return loadFile('output-contract.md')
}

/** Get metadata for a role (cached). */
export function personaMetadata(role: string): PersonaMetadata {
  return loadPersonaFile(role).metadata
}

/** Clear the file cache (for tests). */
export function clearPersonaCache(): void {
  cache.clear()
}
