import { loadSkill } from './loader'

const CORE_TOOLS = [
  'listTools',
  'loadTool',
  'writeFinding',
  'askUser',
  'loadSkillReference',
  'searchSkills',
  'encodeDecode',
  'queryGraph',
  'verifyChains',
  'recordEvidence',
  'detectReactions',
  'getDialogEvidence',
  'getRecentChanges',
  'getTargetSummary',
  'getEndpointsWithParams',
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
  'addFinding',
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
  'runPrimitive',
  'getOastUrlTool',
  'recordOutcome',
  'runCampaign',
  'runRecon',
  'graphqlIntrospect',
  'jwtDecode',
  'frameworkFingerprint',
  'cloudMetadataProbe',
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

export function getCoreTools(): string[] {
  return [...CORE_TOOLS]
}
