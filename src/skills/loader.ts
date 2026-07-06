import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { load as yamlLoad } from 'js-yaml'

export interface Reference {
  id: string
  title: string
  content: string
}

export type SkillTier = 'fast' | 'balanced' | 'powerful'

export interface Skill {
  id: string
  name: string
  category: 'core' | 'specialized'
  tier: SkillTier
  description: string
  instructions: string
  references: Reference[]
  toolRefs: string[]
  triggers: string[]
}

// ESM: import.meta.dirname (Node 21.2+). CJS: tsup shims import.meta, falls back to __dirname.
const _dir = import.meta.dirname || __dirname

// After build: _dir = dist/ → ../skills reaches package root
// During dev (tsx): _dir = src/skills/ → ../../skills reaches package root
// The check verifies the directory actually contains .md skill files, not just an empty dir.
const _candidate = join(_dir, '..')
const _root = existsSync(join(_candidate, 'skills', 'core'))
  && readdirSync(join(_candidate, 'skills', 'core')).some(f => f.endsWith('.md'))
  ? _candidate
  : join(_dir, '..', '..')
const SKILLS_DIR = join(_root, 'skills')
const ANALYSIS_SKILLS_DIR = join(_root, 'skills', 'analysis')

let skillCache: Map<string, Skill> | null = null

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  try {
    const meta = yamlLoad(match[1]) as Record<string, unknown>
    return { meta: meta || {}, body: match[2] }
  } catch {
    return { meta: {}, body: raw }
  }
}

function parseSkillFile(filePath: string, category: 'core' | 'specialized'): Skill | null {
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

    const rawTier = typeof meta.tier === 'string' ? meta.tier.toLowerCase() : 'balanced'
    const tier: SkillTier = (['fast', 'balanced', 'powerful'] as string[]).includes(rawTier) ? rawTier as SkillTier : 'balanced'

    return {
      id,
      name,
      category,
      tier,
      description,
      instructions: body,
      references: [],
      toolRefs,
      triggers,
    }
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

function loadAllSkills(): Map<string, Skill> {
  if (skillCache) return skillCache

  const cache = new Map<string, Skill>()

  const loadDir = (dir: string, category: 'core' | 'specialized') => {
    if (!existsSync(dir)) return
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const skill = parseSkillFile(join(dir, file), category)
        if (skill) {
          skill.references = loadReferences(join(dir, basename(file)))
          cache.set(skill.id, skill)
        }
      }
    } catch {}
  }

  loadDir(join(SKILLS_DIR, 'core'), 'core')
  loadDir(join(SKILLS_DIR, 'specialized'), 'specialized')
  loadDir(ANALYSIS_SKILLS_DIR, 'specialized')

  skillCache = cache
  return cache
}

export function loadSkill(id: string): Skill | null {
  const skills = loadAllSkills()
  return skills.get(id) || null
}

export function getAllSkills(): Skill[] {
  return [...loadAllSkills().values()]
}

export function searchSkills(query: string): Skill[] {
  const q = query.toLowerCase()
  const all = getAllSkills()

  const scored = all.map(skill => {
    let score = 0
    if (skill.id.toLowerCase().includes(q)) score += 10
    if (skill.name.toLowerCase().includes(q)) score += 8
    if (skill.description.toLowerCase().includes(q)) score += 5
    if (skill.instructions.toLowerCase().includes(q)) score += 2
    if (skill.toolRefs.some(t => t.toLowerCase().includes(q))) score += 3
    if (skill.triggers.some(t => t.toLowerCase().includes(q))) score += 6
    return { skill, score }
  })

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.skill)
}

export function loadReference(skillId: string, referenceId: string): string | null {
  const skill = loadSkill(skillId)
  if (!skill) return null
  const ref = skill.references.find(r => r.id === referenceId)
  return ref ? ref.content : null
}

export function listReferences(skillId: string): Reference[] {
  const skill = loadSkill(skillId)
  return skill ? skill.references : []
}

export function resetSkillCache(): void {
  skillCache = null
}
