import { initSkillIndex } from './loader'

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
  'useSession',
  'extractSessionCookie',
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
  const index = initSkillIndex()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (meta) {
      for (const t of meta.toolRefs) {
        tools.add(t)
      }
    }
  }

  return [...tools]
}

export function getCoreTools(): string[] {
  return [...CORE_TOOLS]
}
