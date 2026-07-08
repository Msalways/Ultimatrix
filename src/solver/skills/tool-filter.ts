import { loadSkill, getAllSkills, type SkillMeta, type SkillTier } from './loader'

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
  'detectReactions',
  'getDialogEvidence',
  'getRecentChanges',
  'getTargetSummary',
  'getEndpointsWithParams',
  'getTestCoverage',
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
  'addFinding',
  'addAuthFlow',
  'addAttack',
  'saveSession',
  'restoreSession',
  'getCapturedHeaders',
  'storeSession',
  'buildResearchMap',
  'planResearchExperiments',
  'compareResearchResponses',
  'recordFindingCandidate',
  'assessCandidateReportability',
  'getResearchStatus',
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

export function resolveSkillsForInput(userInput: string): SkillMeta[] {
  const input = userInput.toLowerCase()
  const all = getAllSkills()

  const scored = all.map(skill => {
    let score = 0
    
    // Natural language matching on triggers field (highest priority)
    if (skill.triggers.length > 0) {
      const triggerMatches = skill.triggers.filter(trigger => 
        input.includes(trigger.toLowerCase())
      )
      score += triggerMatches.length * 8
      
      // Partial trigger matching
      skill.triggers.forEach(trigger => {
        const triggerWords = trigger.toLowerCase().split(' ')
        const inputWords = input.split(' ')
        
        // Check if any trigger word is in input
        triggerWords.forEach(triggerWord => {
          if (triggerWord.length > 3 && inputWords.includes(triggerWord)) {
            score += 2
          }
        })
      })
    }

    // Exact skill ID match (high priority)
    if (input.includes(skill.id.toLowerCase())) {
      score += 10
    }

    // Description relevance (medium priority)
    const descWords = skill.description.toLowerCase().split(' ')
    descWords.forEach(word => {
      if (word.length > 3 && input.includes(word)) {
        score += 3
      }
    })

    // Skill name relevance (medium priority)
    const nameWords = skill.name.toLowerCase().split(' ')
    nameWords.forEach(word => {
      if (word.length > 3 && input.includes(word)) {
        score += 2
      }
    })

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
