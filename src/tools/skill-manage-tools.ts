/**
 * manageSkills â€” runtime skill management (Phase D, spec 04 D7).
 *
 * Lets the brain (and through it, the user in conversation) list imported
 * skills, add one from pasted markdown or a file path, remove an imported
 * one, and hot-reload the shared index. Every write goes through the
 * validation gate (validateSkillMarkdown) â€” nothing partial lands.
 *
 * Imported skills live in the FIRST configured skillsDir (or
 * workspace/skills-user/) under their own folder, namespaced `user/<id>` by
 * the loader.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { getGlobalWorkspace } from '../workspace'
import { validateSkillMarkdown, validateSkillFile } from '../solver/skills/validate'
import { configureSkillSources, getAllSkills } from '../solver/skills/loader'

function importedRoot(): string {
  if (overrideRoot) return overrideRoot
  const workspace = getGlobalWorkspace()
  return resolve(workspace.getTargetDir(workspace.getCurrentTarget() ?? 'global'), 'skills-user')
}

/** Test seam: pin the imported-skills root (mirrors resetGlobalBotHandler style). */
let overrideRoot: string | null = null
export function setImportedSkillsRoot(dir: string | null): void {
  overrideRoot = dir
}

/**
 * Ensure the imported-skills root is registered as a loader source
 * (namespaced user/<id>) and the shared index is rebuilt. Union with any
 * configured skillsDirs so imports never shadow config-provided sources.
 */
function registerAndReload(): void {
  let configured: string[] = []
  let exclude: string[] = []
  try {
    const { getConfig } = require('../config') as { getConfig: () => { skillsDirs?: string[]; skills?: { exclude?: string[] } } }
    const cfg = getConfig()
    configured = cfg.skillsDirs ?? []
    exclude = cfg.skills?.exclude ?? []
  } catch {
    /* config unavailable — imported dir alone */
  }
  const root = importedRoot()
  const dirs = configured.includes(root) ? configured : [...configured, root]
  configureSkillSources(dirs, exclude)
}



export const manageSkills = createTool({
  id: 'manageSkills',
  description:
    'Manage imported skills at runtime: list what is installed (bundled vs imported), add a skill from markdown text or a file path (validated: frontmatter, tool refs, primitive ids, non-empty payload blocks), remove an imported skill, or hot-reload the index. Adding a skill makes it immediately discoverable to search.',
  inputSchema: z.object({
    action: z.enum(['list', 'add', 'remove', 'reload']),
    /** Markdown content for add (preferred over path). */
    markdown: z.string().optional(),
    /** File path for add (alternative to markdown). */
    path: z.string().optional(),
    /** Skill id for remove. */
    id: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string().optional(),
    errors: z.array(z.string()).optional(),
    skills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      source: z.string().optional(),
      primitives: z.array(z.string()).optional(),
      toolRefs: z.array(z.string()).optional(),
    })).optional(),
  }),
  execute: async ({ action, markdown, path, id }) => {
    if (action === 'list') {
      return {
        ok: true,
        skills: getAllSkills().map((s) => ({
          id: s.id,
          name: s.name,
          source: s.id.startsWith('user/') ? 'imported' : 'bundled',
          primitives: s.primitives ?? [],
          toolRefs: s.toolRefs ?? [],
        })),
      }
    }

    if (action === 'reload') {
      registerAndReload()
      return { ok: true, message: `skill index reloaded (${getAllSkills().length} skills)` }
    }

    if (action === 'remove') {
      if (!id) return { ok: false, errors: ['remove requires id'] }
      const clean = id.startsWith('user/') ? id.slice('user/'.length) : id
      const dir = join(importedRoot(), clean)
      const file = dir.endsWith('.md') ? dir : `${dir}.md`
      let removed = false
      if (existsSync(file)) {
        rmSync(file)
        removed = true
      } else if (existsSync(dir)) {
        rmSync(dir, { recursive: true })
        removed = true
      }
      if (!removed) return { ok: false, errors: [`no imported skill found at ${clean}`] }
      registerAndReload()
      return { ok: true, message: `removed imported skill ${clean}; index reloaded` }
    }

    // action === 'add'
    const root = importedRoot()
    if (!existsSync(root)) mkdirSync(root, { recursive: true })

    if (markdown !== undefined) {
      const validation = validateSkillMarkdown(markdown)
      if (!validation.valid || !validation.meta) {
        return { ok: false, errors: validation.errors }
      }
      const dir = join(root, validation.meta.name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), markdown.replace(/^\uFEFF/, ''), 'utf8')
      registerAndReload()
      return { ok: true, message: `skill '${validation.meta.name}' imported as user/${validation.meta.name} and index reloaded` }
    }

    if (path !== undefined) {
      try {
        const stat = statSync(path)
        if (stat.isDirectory()) {
          // Directory import: SKILL.md (+ optional refs/) validated as a unit.
          const skillFile = join(path, 'SKILL.md')
          const expected = path.split(/[\\/]/).filter(Boolean).pop()
          const validation = validateSkillFile(skillFile, expected)
          if (!validation.valid || !validation.meta) return { ok: false, errors: validation.errors }
          const dest = join(root, validation.meta.name)
          if (existsSync(dest)) rmSync(dest, { recursive: true })
          mkdirSync(dest, { recursive: true })
          writeFileSync(join(dest, 'SKILL.md'), readFileSync(skillFile, 'utf8').replace(/^\uFEFF/, ''), 'utf8')
          const refsDir = join(path, 'refs')
          if (existsSync(refsDir)) {
            const destRefs = join(dest, 'refs')
            mkdirSync(destRefs, { recursive: true })
            for (const f of readdirSync(refsDir)) {
              if (f.endsWith('.md')) writeFileSync(join(destRefs, f), readFileSync(join(refsDir, f), 'utf8'), 'utf8')
            }
          }
          registerAndReload()
          return { ok: true, message: `skill directory imported as user/${validation.meta.name} and index reloaded` }
        }
        const expected = path.split(/[\\/]/).pop()
        const validation = validateSkillFile(path, expected)
        if (!validation.valid || !validation.meta) return { ok: false, errors: validation.errors }
        const fileName = (expected ?? validation.meta.name + '.md').replace(/\.md$/i, '')
        writeFileSync(join(root, `${fileName}.md`), readFileSync(path, 'utf8').replace(/^\uFEFF/, ''), 'utf8')
        registerAndReload()
        return { ok: true, message: `skill imported as user/${fileName} and index reloaded` }
      } catch (err) {
        return { ok: false, errors: [`path import failed: ${err instanceof Error ? err.message : String(err)}`] }
      }
    }

    return { ok: false, errors: ['add requires markdown or path'] }
  },
})
