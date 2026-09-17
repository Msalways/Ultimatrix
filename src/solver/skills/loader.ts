import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
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

// ─── Skill Contract types (Strix Adaptation Phase A) ────────────────────────

/** A single stage in a skill's execution procedure. */
export interface ProcedureStage {
  id: string
  goal: string
}

/** A coverage requirement declared by a skill's verification contract. */
export interface CoverageRequirement {
  id: string
  required: boolean
}

/** Declares what the skill produces (output schema). */
export interface SkillOutput {
  schema: string
}

/**
 * Structured Skill Contract — machine-readable execution contract.
 *
 * Skills that declare a contract enable the Capability Compiler to validate
 * coverage and produce a narrowed worker surface. Skills without a contract
 * fall back to the legacy toolRefs + primitives resolution.
 */
export interface SkillContract {
  /** Semantic capability IDs (e.g. "network.request", "primitive.execute") */
  capabilities: string[]
  /** Execution procedure stages (ordered) */
  procedure: ProcedureStage[]
  /** Required coverage outcomes for task acceptance */
  coverage: CoverageRequirement[]
  /** Output schema name */
  output: SkillOutput
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
  /** Primitive ids (see src/primitives) this skill drives via the execution seam. */
  primitives: string[]
  triggers: string[]
  contextBoosts: string[]
  toolChains: ToolChain[]
  compositionRules: CompositionRule
  mitreAttack: string[]
  owaspRefs: string[]
  /** Structured Skill Contract (Strix Adaptation). Present when the skill declares
   *  requires/procedure/verification/output in YAML frontmatter. Undefined for
   *  legacy skills that rely on toolRefs + primitives only. */
  contract?: SkillContract
}

/** Full skill with instructions body (loaded on demand). */
export interface Skill extends SkillMeta {
  instructions: string
  references: Reference[]
  /** Knowledge fragments — focused subsections split from the main body.
   *  Each fragment is a standalone .md file in the skill's subfolder.
   *  Empty array when no fragments exist (backward compat). */
  fragments: Reference[]
}

let metaCache: Map<string, SkillMeta> | null = null
let fullCache: Map<string, Skill> | null = null

/** Phase 7.1 â€” additional user-provided skill directories and exclusions. */
let extraSkillDirs: string[] = []
let excludedSkillIds = new Set<string>()
/** id â†’ absolute file path, so namespaced `user/<id>` skills resolve correctly. */
let idToPath = new Map<string, string>()

export function configureSkillSources(dirs: string[] = [], exclude: string[] = []): void {
  extraSkillDirs = dirs
  excludedSkillIds = new Set(exclude)
  resetSharedSkillIndex()
}

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
    const primitives = Array.isArray(meta.primitives) ? meta.primitives.filter((p): p is string => typeof p === 'string') : []
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

    // Parse Skill Contract (Strix Adaptation Phase A)
    // Contract fields: requires.capabilities, procedure.stages, verification.coverage, output.schema
    let contract: SkillContract | undefined
    const rawRequires = meta.requires && typeof meta.requires === 'object' && !Array.isArray(meta.requires)
      ? meta.requires as Record<string, unknown>
      : null
    const rawProcedure = meta.procedure && typeof meta.procedure === 'object' && !Array.isArray(meta.procedure)
      ? meta.procedure as Record<string, unknown>
      : null
    const rawVerification = meta.verification && typeof meta.verification === 'object' && !Array.isArray(meta.verification)
      ? meta.verification as Record<string, unknown>
      : null
    const rawOutput = meta.output && typeof meta.output === 'object' && !Array.isArray(meta.output)
      ? meta.output as Record<string, unknown>
      : null

    // Only build a contract if at least one contract field is present
    if (rawRequires || rawProcedure || rawVerification || rawOutput) {
      const capabilities = rawRequires && Array.isArray(rawRequires.capabilities)
        ? rawRequires.capabilities.filter((c): c is string => typeof c === 'string')
        : []

      const stages = rawProcedure && Array.isArray(rawProcedure.stages)
        ? rawProcedure.stages
            .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
            .map(s => ({
              id: typeof s.id === 'string' ? s.id : 'unnamed',
              goal: typeof s.goal === 'string' ? s.goal : '',
            }))
        : []

      const coverage = rawVerification && Array.isArray(rawVerification.coverage)
        ? rawVerification.coverage
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
            .map(c => ({
              id: typeof c.id === 'string' ? c.id : 'unnamed',
              required: c.required === true,
            }))
        : []

      const outputSchema = rawOutput && typeof rawOutput.schema === 'string' ? rawOutput.schema : ''

      contract = {
        capabilities,
        procedure: stages,
        coverage,
        output: { schema: outputSchema },
      }
    }

    return {
      id, name, domain, category: (typeof meta.category === 'string' ? meta.category : domain), tier, description,
      toolRefs, primitives, triggers, contextBoosts, toolChains, compositionRules,
      mitreAttack, owaspRefs,
      ...(contract ? { contract } : {}),
    }
  } catch {
    return null
  }
}

function parseSkillBody(filePath: string, meta: SkillMeta): Skill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const { body } = parseFrontmatter(raw)

    // Auto-discover knowledge fragments from the skill's subfolder
    const skillDir = dirname(filePath)
    const fragmentDir = join(skillDir, meta.id)
    const fragments: Reference[] = []
    if (existsSync(fragmentDir) && statSync(fragmentDir).isDirectory()) {
      try {
        const files = readdirSync(fragmentDir).filter(f => f.endsWith('.md'))
        for (const file of files) {
          try {
            const content = readFileSync(join(fragmentDir, file), 'utf-8')
            const titleMatch = content.match(/^#\s+(.+)/m)
            fragments.push({
              id: basename(file, '.md'),
              title: titleMatch ? titleMatch[1].trim() : basename(file, '.md'),
              content,
            })
          } catch {}
        }
      } catch {}
    }

    return { ...meta, instructions: body, references: [], fragments }
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

// ─── Phase 5: Knowledge fragment loading ───────────────────────────────────

/**
 * Load knowledge fragments for a skill from its subfolder.
 *
 * Fragments are standalone .md files in `<skill-dir>/<skill-name>/` that
 * contain focused subsections split from the main body (e.g., "jwt-attacks.md",
 * "idor-automation.md"). Fragment ID = filename sans .md.
 *
 * When `fragmentIds` is provided, only those fragments are loaded (on-demand).
 * When omitted, ALL fragments are loaded.
 *
 * Backward compat: returns [] when no subfolder or fragments exist.
 */
export function loadSkillFragments(skillId: string, fragmentIds?: string[]): Reference[] {
  const filePath = resolveSkillPath(skillId)
  if (!filePath) return []

  const skillDir = dirname(filePath)
  const fragmentDir = join(skillDir, skillId)

  if (!existsSync(fragmentDir) || !statSync(fragmentDir).isDirectory()) return []

  const refs: Reference[] = []
  try {
    const files = readdirSync(fragmentDir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const id = basename(file, '.md')

      // If specific fragment IDs requested, skip non-matching
      if (fragmentIds && !fragmentIds.includes(id)) continue

      try {
        const content = readFileSync(join(fragmentDir, file), 'utf-8')
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

/**
 * List available fragment IDs for a skill (without loading content).
 * Useful for the brain to discover what fragments exist.
 */
export function listSkillFragments(skillId: string): string[] {
  const filePath = resolveSkillPath(skillId)
  if (!filePath) return []

  const skillDir = dirname(filePath)
  const fragmentDir = join(skillDir, skillId)

  if (!existsSync(fragmentDir) || !statSync(fragmentDir).isDirectory()) return []

  try {
    return readdirSync(fragmentDir)
      .filter(f => f.endsWith('.md'))
      .map(f => basename(f, '.md'))
  } catch {
    return []
  }
}

/** Resolve the file path for a skill by ID (uses the index built at init). */
function resolveSkillPath(id: string): string | null {
  return idToPath.get(id) ?? null
}

function scanSkillDir(dir: string, namespace: string | null): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const filePath = join(dir, file)
      const baseId = basename(file, '.md')
      const id = namespace ? `${namespace}/${baseId}` : baseId
      const meta = parseSkillMeta(filePath, namespace ?? dir)
      if (meta) {
        meta.id = id
        idToPath.set(id, filePath)
        if (!excludedSkillIds.has(id)) initSkillIndexImplCache.set(id, meta)
      }
    }
    // Folder-per-skill layout (agentskills.io standard): <dir>/<name>/SKILL.md
    // plus optional refs/. Subdirectories take precedence over nothing â€” ids
    // derive from the FOLDER name so refs/ resolution works via dirname.
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const entryPath = join(dir, entry)
      let entryStat: ReturnType<typeof statSync>
      try {
        entryStat = statSync(entryPath)
      } catch {
        continue
      }
      if (!entryStat.isDirectory()) continue
      const skllFile = join(entryPath, 'SKILL.md')
      void skllFile
      const skillFile = join(entryPath, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const meta = parseSkillMeta(skillFile, namespace ?? dir)
      if (meta) {
        meta.id = namespace ? `${namespace}/${entry}` : entry
        idToPath.set(meta.id, skillFile)
        if (!excludedSkillIds.has(meta.id)) initSkillIndexImplCache.set(meta.id, meta)
      }
    }
  } catch {}
}

let initSkillIndexImplCache = new Map<string, SkillMeta>()

function initSkillIndexImpl(): Map<string, SkillMeta> {
  initSkillIndexImplCache = new Map<string, SkillMeta>()
  idToPath = new Map()

  // Bundled skills (no namespace)
  if (existsSync(SKILLS_DIR)) {
    try {
      for (const entry of readdirSync(SKILLS_DIR)) {
        const entryPath = join(SKILLS_DIR, entry)
        if (!statSync(entryPath).isDirectory()) continue
        scanSkillDir(entryPath, null)
      }
    } catch {}
  }

  // Phase7.1 â€” user-provided skill directories, namespaced as `user/<id>`
  for (const dir of extraSkillDirs) {
    scanSkillDir(dir, 'user')
  }

  return initSkillIndexImplCache
}

/**
 * Shared skill index singleton. Both the REPL (session.ts via tool-filter) and
 * the worker pool (WorkerPool â†’ SkillRegistry) must resolve skills from ONE
 * index so a skill added/observed at runtime is visible to every component.
 */
let sharedMetaCache: Map<string, SkillMeta> | null = null

export function getSharedSkillIndex(): Map<string, SkillMeta> {
  if (!sharedMetaCache) {
    sharedMetaCache = initSkillIndexImpl()
  }
  return sharedMetaCache
}

/** Reset the shared index (used by tests or when skills change at runtime). */
export function resetSharedSkillIndex(): void {
  sharedMetaCache = null
  metaCache = null
  fullCache = null
  idToPath = new Map()
  initSkillIndexImplCache = new Map()
}

/**
 * Phase 1: Scan all domain directories, parse ONLY frontmatter.
 * Fast init â€” ~80 lines of metadata for 16 skills.
 */
export function initSkillIndex(): Map<string, SkillMeta> {
  if (metaCache) return metaCache
  metaCache = getSharedSkillIndex()
  return metaCache
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
    // Load references if they exist in a refs/ subdirectory next to the skill file
    const skillDir = dirname(filePath)
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

export function searchSkillMetadata(skills: Iterable<SkillMeta>, query: string): SkillMeta[] {
  // F5 FIX: Tokenize query into words for better multi-word matching.
  // "sql injection" matches skills containing "sql" OR "injection" individually,
  // with exact-phrase match scoring highest.
  const q = query.toLowerCase()
  const words = q.split(/\s+/).filter(w => w.length > 1)
  const hasMultiWord = words.length > 1

  return [...skills]
    .map((skill) => {
      let score = 0
      const idLower = skill.id.toLowerCase()
      const nameLower = skill.name.toLowerCase()
      const descLower = skill.description.toLowerCase()
      const toolRefsLower = skill.toolRefs.map(t => t.toLowerCase())
      const triggersLower = (skill.triggers ?? []).map(t => t.toLowerCase())

      // Exact phrase match (highest signal)
      if (idLower.includes(q)) score += 20
      if (nameLower.includes(q)) score += 16
      if (descLower.includes(q)) score += 10

      // Per-word matching (for multi-word queries like "sql injection")
      for (const word of words) {
        if (idLower.includes(word)) score += 5
        if (nameLower.includes(word)) score += 4
        if (descLower.includes(word)) score += 3
        if (toolRefsLower.some(t => t.includes(word))) score += 2
        if (triggersLower.some(t => t.includes(word))) score += 3
      }

      // Bonus: all words present in any field (multi-word coherence)
      if (hasMultiWord && words.every(w => idLower.includes(w) || nameLower.includes(w) || descLower.includes(w))) {
        score += 8
      }

      return { skill, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ skill }) => skill)
}

/**
 * Search skills by query. Uses metadata only (no body scanning).
 */
export function searchSkills(query: string): SkillMeta[] {
  return searchSkillMetadata(getAllSkills(), query)
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
