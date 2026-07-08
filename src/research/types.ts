import type {
  RiskLevel,
  Severity,
  HypothesisStatus,
  ExperimentStatus,
  CandidateFindingStatus,
  HttpMethod,
} from '../types/shared'

export type { RiskLevel }

export type HypothesisKind =
  | 'idor'
  | 'broken_access_control'
  | 'mass_assignment'
  | 'workflow_bypass'
  | 'information_disclosure'
  | 'replay'
  | 'state_confusion'
  | 'client_side_only_validation'
  | 'race_condition'

export interface ResearchWorkflow {
  id: string
  name: string
  entryUrl?: string
  steps: Array<{ action: string; url?: string; endpointId?: string; method?: string }>
  relatedEndpoints: string[]
  requiredAuth?: boolean
  inputFields: string[]
  stateChanges: string[]
  observedRoles: string[]
  confidence: number
}

export interface ResearchEntity {
  id: string
  name: string
  ids: string[]
  endpoints: string[]
  ownerFields: string[]
  roleFields: string[]
  sensitiveFields: string[]
  lifecycleStates: string[]
  confidence: number
}

export interface ResearchHypothesis {
  id: string
  title: string
  kind: HypothesisKind
  reason: string
  targetEndpoints: string[]
  relatedWorkflowIds: string[]
  relatedEntityIds: string[]
  requiredSetup: string[]
  risk: RiskLevel
  confidence: number
  status: HypothesisStatus
}

export interface ReplayableRequest {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface ResearchExperiment {
  id: string
  hypothesisId: string
  title: string
  setup: string[]
  baselineRequest?: ReplayableRequest
  mutation: string
  expectedSecureBehavior: string
  insecureSignal: string
  requiredActors: string[]
  tools: string[]
  status: ExperimentStatus
  resultSummary?: string
  differential?: DifferentialResult
}

export interface ResponseLike {
  status: number
  headers?: Record<string, string>
  body?: string
  url?: string
}

export interface DifferentialResult {
  sameStatus: boolean
  statusDelta: string
  bodySimilarity: number
  leakedFields: string[]
  authorizationMismatch: boolean
  interesting: boolean
  reason: string
}

export interface FindingCandidate {
  id: string
  title: string
  signalType: string
  endpoint: string
  evidence: string[]
  experimentIds: string[]
  confidence: number
  nextVerificationSteps: string[]
  blockers: string[]
  status: CandidateFindingStatus
  severity: Severity
}

export interface ResearchSnapshot {
  workflows: ResearchWorkflow[]
  entities: ResearchEntity[]
  hypotheses: ResearchHypothesis[]
  experiments: ResearchExperiment[]
  candidates: FindingCandidate[]
}
