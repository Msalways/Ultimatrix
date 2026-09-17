/**
 * Registry-drift guard: every tool ID referenced by the skill-driven tool
 * filtering (CORE_TOOLS + each skill's toolRefs) MUST exist in the canonical
 * tool registry (TOOL_IDS). This catches the getOastUrl / getOastUrlTool
 * class of bugs where a worker is silently filtered to a non-existent tool.
 */
import { describe, it, expect } from 'vitest'
import { getCoreTools, getExecutionTools, resolveToolsForSkills, resolveToolsForSkillsWorker, getWorkerUniversal } from '../../src/solver/skills/tool-filter'
import { getAllSkills } from '../../src/solver/skills/loader'
import { TOOL_IDS } from '../../src/mastra/tools'

describe('skill→tool wiring drift guard', () => {
  const registry = new Set<string>(TOOL_IDS as readonly string[])

  it('every CORE_TOOLS entry is a real registry tool', () => {
    const missing = getCoreTools().filter(id => !registry.has(id))
    expect(missing, `CORE_TOOLS references missing tools: ${missing.join(', ')}`).toEqual([])
  })

  it('every execution-tool marker is a real registry tool', () => {
    const missing = getExecutionTools().filter(id => !registry.has(id))
    expect(missing, `execution-tool markers reference missing tools: ${missing.join(', ')}`).toEqual([])
  })

  it('every skill toolRefs entry is a real registry tool', () => {
    const skills = getAllSkills()
    expect(skills.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const skill of skills) {
      for (const ref of skill.toolRefs) {
        if (!registry.has(ref)) {
          missing.push(`${skill.id}:${ref}`)
        }
      }
    }
    expect(missing, `skill toolRefs reference missing tools: ${missing.join(', ')}`).toEqual([])
  })

  it('resolveToolsForSkills only returns real registry tools', () => {
    const skills = getAllSkills()
    const skillIds = skills.map(s => s.id)
    const resolved = resolveToolsForSkills(skillIds)
    const missing = resolved.filter(id => !registry.has(id))
    expect(missing, `resolveToolsForSkills returned missing tools: ${missing.join(', ')}`).toEqual([])
  })

  it('every WORKER_UNIVERSAL entry is a real registry tool', () => {
    const missing = getWorkerUniversal().filter(id => !registry.has(id))
    expect(missing, `WORKER_UNIVERSAL references missing tools: ${missing.join(', ')}`).toEqual([])
  })

  it('resolveToolsForSkillsWorker only returns real registry tools', () => {
    const skills = getAllSkills()
    const skillIds = skills.map(s => s.id)
    const resolved = resolveToolsForSkillsWorker(skillIds)
    const missing = resolved.filter(id => !registry.has(id))
    expect(missing, `resolveToolsForSkillsWorker returned missing tools: ${missing.join(', ')}`).toEqual([])
  })
})
