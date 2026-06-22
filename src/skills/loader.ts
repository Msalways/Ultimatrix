import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { load } from 'js-yaml'

export interface Skill {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  instructions: string
  references: string[]
  scripts: string[]
  toolRefs: string[]
  mitreAttack?: string[]
}

export function parseFrontmatter(content: string): { frontmatter: unknown; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  return { frontmatter: load(match[1]), body: match[2] }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).map(f => join(dir, f))
  } catch {
    return []
  }
}

export function loadSkill(skillPath: string): Skill {
  const content = readFileSync(skillPath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)

  const dir = dirname(skillPath)
  const id = basename(dir)
  const fm = frontmatter as Record<string, any>

  return {
    id,
    name: fm.name || id,
    description: fm.description || '',
    version: fm.version || '1.0.0',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    instructions: body.trim(),
    references: listFiles(join(dir, 'references')),
    scripts: listFiles(join(dir, 'scripts')),
    toolRefs: Array.isArray(fm.toolRefs) ? fm.toolRefs : [],
    mitreAttack: fm.mitre_attack
      ? String(fm.mitre_attack).split(',').map((s: string) => s.trim())
      : undefined,
  }
}

export function loadSkillsFromDirectory(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  const skills: Skill[] = []
  for (const entry of readdirSync(dir)) {
    const subPath = join(dir, entry)
    const stat = statSync(subPath)
    if (stat.isDirectory()) {
      const skillFile = join(subPath, 'SKILL.md')
      if (existsSync(skillFile)) {
        skills.push(loadSkill(skillFile))
      } else {
        skills.push(...loadSkillsFromDirectory(subPath))
      }
    }
  }
  return skills
}

export function loadAllSkills(baseDir: string = './skills'): Skill[] {
  return loadSkillsFromDirectory(baseDir)
}
