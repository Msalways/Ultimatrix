import { loadSkill, getAllSkills, type Skill } from './loader'

const CORE_TOOLS = [
  'updateGraph',
  'writeFinding',
  'readReport',
  'askUser',
  'loadSkillReference',
  'searchSkills',
  'encodeDecode',
  'queryGraph',
  'detectChains',
  'evaluateRendered',
  'findEndpointsInResponse',
  'compareResponses',
  'measureTiming',
  'recordEvidence',
]

export function resolveToolsForSkills(skillIds: string[]): string[] {
  const tools = new Set<string>(CORE_TOOLS)

  for (const id of skillIds) {
    const skill = loadSkill(id)
    if (skill) {
      for (const t of skill.toolRefs) {
        tools.add(t)
      }
    }
  }

  return [...tools]
}

export function resolveSkillsForInput(userInput: string): Skill[] {
  const input = userInput.toLowerCase()
  const all = getAllSkills()

  const scored = all.map(skill => {
    let score = 0
    const id = skill.id.toLowerCase()
    const desc = skill.description.toLowerCase()
    const name = skill.name.toLowerCase()

    if (input.includes(id)) score += 10
    if (id.split('-').some(part => input.includes(part))) score += 6
    if (desc.split(' ').some(w => w.length > 3 && input.includes(w))) score += 3
    if (name.split(' ').some(w => w.length > 3 && input.includes(w))) score += 2

    return { skill, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.skill)
}

export function getCoreTools(): string[] {
  return [...CORE_TOOLS]
}
