import { initSkillIndex } from './loader'

const CORE_TOOLS = [
  'listSkills',
  'loadSkillBody',
  'askUser',
  'manageSkills',
  'loadSkillReference',
  'searchSkills',
  'encodeDecode',
  'queryGraph',
  'getGraphSchema',
  'getCaptureOverview',
  'queryRelations',
  'getGraphNeighborhood',
  'getWorkflowAround',
  'traceValue',
  'explainReachability',
  'getUntestedWorkarounds',
  'verifyChains',
  'recordEvidence',
  'getDialogEvidence',
  'getRecentChanges',
  'getTargetSummary',
  'getEndpointsWithParams',
  'saveSession',
  'restoreSession',
  'getCapturedHeaders',
  'storeSession',
  'useSession',
  'extractSessionCookie',
  'getResearchStatus',
  'getOastUrlTool',
]

const EXECUTION_TOOLS = [
  'writeFinding',
  'runPrimitive',
  'runCampaign',
  'runRecon',
  'listCapturedRequests',
  'replayCapturedRequest',
  'graphqlIntrospect',
  'jwtDecode',
  'frameworkFingerprint',
  'cloudMetadataProbe',
  'recordOutcome',
  'recordFindingCandidate',
  'assessCandidateReportability',
  'buildResearchMap',
  'planResearchExperiments',
  'compareResearchResponses',
  'evaluateResearchExperiment',
  'detectReactions',
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
]

export function resolveToolsForSkills(skillIds: string[]): string[] {
  const tools = new Set<string>(CORE_TOOLS)
  const index = initSkillIndex()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (!meta) {
      throw new Error(`Skill not found: ${id}`)
    }
    for (const t of meta.toolRefs) {
      tools.add(t)
    }
  }

  return [...tools]
}

export function getCoreTools(): string[] {
  return [...CORE_TOOLS]
}

export function getExecutionTools(): string[] {
  return [...EXECUTION_TOOLS]
}
