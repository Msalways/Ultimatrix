import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { load as yamlLoad } from 'js-yaml'
import { SKILLS_DIR } from '../../lib/project-root'

export interface Reference {
  id: string
  title: string
  content: string
}

export type SkillTier = 'fast' | 'balanced' | 'powerful'

/** Ordered tool sequence for skill-triggered workflows. */
export interface ToolChain {
  name: string
  description: string
  steps: string[]
}

/** How skills compose together for multi-stage attacks. */
export interface CompositionRule {
  /** Skills that MUST be loaded before this skill (prerequisites) */
  requires?: string[]
  /** Skills that benefit from loading this skill alongside them */
  enhances?: string[]
  /** Skills that conflict and should not run in parallel */
  conflicts?: string[]
}

/** Lightweight metadata loaded at init (frontmatter only). */
export interface SkillMeta {
  id: string
  name: string
  domain: string
  category: string
  tier: SkillTier
  description: string
  toolRefs: string[]
  triggers: string[]
  contextBoosts: string[]
  toolChains: ToolChain[]
  compositionRules: CompositionRule
  mitreAttack: string[]
  owaspRefs: string[]
}

/** Full skill with instructions body (loaded on demand). */
export interface Skill extends SkillMeta {
  instructions: string
  references: Reference[]
}

let metaCache: Map<string, SkillMeta> | null = null
let fullCache: Map<string, Skill> | null = null

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  // Strip BOM if present
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: clean }
  try {
    const meta = yamlLoad(match[1]) as Record<string, unknown>
    return { meta: meta || {}, body: match[2] }
  } catch {
    return { meta: {}, body: raw }
  }
}

function parseSkillMeta(filePath: string, domain: string): SkillMeta | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const id = basename(filePath, '.md')
    const { meta, body } = parseFrontmatter(raw)

    const name = (typeof meta.name === 'string' ? meta.name : null)
      || (body.match(/^#\s+(.+)/m)?.[1]?.trim()) || id

    const description = (typeof meta.description === 'string' ? meta.description : null)
      || (body.match(/(?:^|\n)##?\s*Description\s*\n([\s\S]*?)(?=\n##?\s|\n*$)/i)?.[1]?.trim())
      || name

    const toolRefs = Array.isArray(meta.toolRefs) ? meta.toolRefs.filter((t): t is string => typeof t === 'string') : []
    const triggers = Array.isArray(meta.triggers) ? meta.triggers.filter((t): t is string => typeof t === 'string') : []
    const contextBoosts = Array.isArray(meta.contextBoosts) ? meta.contextBoosts.filter((b): b is string => typeof b === 'string') : []

    const rawTier = typeof meta.tier === 'string' ? meta.tier.toLowerCase() : 'balanced'
    const tier: SkillTier = (['fast', 'balanced', 'powerful'] as string[]).includes(rawTier) ? rawTier as SkillTier : 'balanced'

    // Parse toolChains: array of { name, description, steps }
    const rawChains = Array.isArray(meta.toolChains) ? meta.toolChains : []
    const toolChains: ToolChain[] = rawChains
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map(c => ({
        name: typeof c.name === 'string' ? c.name : 'unnamed',
        description: typeof c.description === 'string' ? c.description : '',
        steps: Array.isArray(c.steps) ? c.steps.filter((s): s is string => typeof s === 'string') : [],
      }))

    // Parse compositionRules: { requires?, enhances?, conflicts? }
    const rawComp = meta.compositionRules && typeof meta.compositionRules === 'object' && !Array.isArray(meta.compositionRules)
      ? meta.compositionRules as Record<string, unknown>
      : {}
    const compositionRules: CompositionRule = {
      requires: Array.isArray(rawComp.requires) ? rawComp.requires.filter((r): r is string => typeof r === 'string') : [],
      enhances: Array.isArray(rawComp.enhances) ? rawComp.enhances.filter((e): e is string => typeof e === 'string') : [],
      conflicts: Array.isArray(rawComp.conflicts) ? rawComp.conflicts.filter((c): c is string => typeof c === 'string') : [],
    }

    // Parse MITRE ATT&CK IDs
    const mitreAttack = Array.isArray(meta.mitreAttack) ? meta.mitreAttack.filter((m): m is string => typeof m === 'string') : []

    // Parse OWASP references
    const owaspRefs = Array.isArray(meta.owaspRefs) ? meta.owaspRefs.filter((o): o is string => typeof o === 'string') : []

    return {
      id, name, domain, category: domain, tier, description,
      toolRefs, triggers, contextBoosts, toolChains, compositionRules,
      mitreAttack, owaspRefs,
    }
  } catch {
    return null
  }
}

function parseSkillBody(filePath: string, meta: SkillMeta): Skill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const { body } = parseFrontmatter(raw)
    return { ...meta, instructions: body, references: [] }
  } catch {
    return null
  }
}

function loadReferences(skillDir: string): Reference[] {
  const refs: Reference[] = []
  const refsDir = join(skillDir, 'refs')
  if (!existsSync(refsDir) || !statSync(refsDir).isDirectory()) return refs

  try {
    const files = readdirSync(refsDir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      try {
        const content = readFileSync(join(refsDir, file), 'utf-8')
        const id = basename(file, '.md')
        const titleMatch = content.match(/^#\s+(.+)/m)
        refs.push({
          id,
          title: titleMatch ? titleMatch[1].trim() : id,
          content,
        })
      } catch {}
    }
  } catch {}

  return refs
}

/** Resolve the file path for a skill by ID (across all domain directories). */
function resolveSkillPath(id: string): string | null {
  if (!existsSync(SKILLS_DIR)) return null
  try {
    for (const entry of readdirSync(SKILLS_DIR)) {
      const entryPath = join(SKILLS_DIR, entry)
      if (!statSync(entryPath).isDirectory()) continue
      const skillPath = join(entryPath, `${id}.md`)
      if (existsSync(skillPath)) return skillPath
    }
  } catch {}
  return null
}

/**
 * Phase 1: Scan all domain directories, parse ONLY frontmatter.
 * Fast init — ~80 lines of metadata for 16 skills.
 */
export function initSkillIndex(): Map<string, SkillMeta> {
  if (metaCache) return metaCache

  const cache = new Map<string, SkillMeta>()

  if (!existsSync(SKILLS_DIR)) {
    metaCache = cache
    return cache
  }

  try {
    for (const entry of readdirSync(SKILLS_DIR)) {
      const entryPath = join(SKILLS_DIR, entry)
      if (!statSync(entryPath).isDirectory()) continue

      try {
        const files = readdirSync(entryPath).filter(f => f.endsWith('.md'))
        for (const file of files) {
          const meta = parseSkillMeta(join(entryPath, file), entry)
          if (meta) cache.set(meta.id, meta)
        }
      } catch {}
    }
  } catch {}

  metaCache = cache
  return cache
}

/**
 * Phase 2: Load full skill body on demand (called when agent selects a skill).
 */
export function loadSkillBody(id: string): Skill | null {
  // Check full cache first
  if (fullCache?.has(id)) return fullCache.get(id)!

  const metaCache = initSkillIndex()
  const meta = metaCache.get(id)
  if (!meta) return null

  const filePath = resolveSkillPath(id)
  if (!filePath) return null

  const skill = parseSkillBody(filePath, meta)
  if (skill) {
    // Load references if they exist in a refs/ subdirectory
    const skillDir = join(SKILLS_DIR, meta.domain, id)
    skill.references = loadReferences(skillDir)

    // Cache the full skill
    if (!fullCache) fullCache = new Map()
    fullCache.set(id, skill)
  }

  return skill
}

/**
 * Legacy: Load full skill by ID. Backward-compatible with existing consumers.
 * Internally uses progressive disclosure.
 */
export function loadSkill(id: string): Skill | null {
  return loadSkillBody(id)
}

/**
 * Return all skills metadata (lightweight). Body is NOT loaded.
 * Use loadSkill(id) to get full instructions.
 */
export function getAllSkills(): SkillMeta[] {
  return [...initSkillIndex().values()]
}

/**
 * Search skills by query. Uses metadata only (no body scanning).
 */
export function searchSkills(query: string): SkillMeta[] {
  const q = query.toLowerCase()
  const all = getAllSkills()

  const scored = all.map(skill => {
    let score = 0
    if (skill.id.toLowerCase().includes(q)) score += 10
    if (skill.name.toLowerCase().includes(q)) score += 8
    if (skill.description.toLowerCase().includes(q)) score += 5
    if (skill.toolRefs.some(t => t.toLowerCase().includes(q))) score += 3
    if (skill.triggers.some(t => t.toLowerCase().includes(q))) score += 6
    return { skill, score }
  })

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.skill)
}

export function loadReference(skillId: string, referenceId: string): string | null {
  const skill = loadSkillBody(skillId)
  if (!skill) return null
  const ref = skill.references.find(r => r.id === referenceId)
  return ref ? ref.content : null
}

export function listReferences(skillId: string): Reference[] {
  const skill = loadSkillBody(skillId)
  return skill ? skill.references : []
}

export function resetSkillCache(): void {
  metaCache = null
  fullCache = null
}
