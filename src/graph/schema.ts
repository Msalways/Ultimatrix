import type {
  Severity,
  EvidenceLevel,
  FindingLifecycleStatus,
  AuthFlowType,
  HypothesisStatus,
  ExperimentStatus,
  CandidateFindingStatus,
} from '../types/shared'

export enum NodeType {
  PAGE = 'Page',
  ACTION = 'Action',
  INPUT = 'Input',
  ENDPOINT = 'Endpoint',
  TEST = 'Test',
  FINDING = 'Finding',
  AUTH_FLOW = 'AuthFlow',
  RBAC_ROLE = 'RBACRole',
  ATTACK = 'Attack',
  FACT = 'Fact',
  INTENT = 'Intent',
  REFLEXION = 'Reflexion',
  WORKFLOW = 'Workflow',
  ENTITY = 'Entity',
  HYPOTHESIS = 'Hypothesis',
  EXPERIMENT = 'Experiment',
  CANDIDATE_FINDING = 'CandidateFinding',
  HEADER_SEMANTIC = 'HeaderSemantic',
  AUTH_SCHEME = 'AuthScheme',
  OUTCOME_FEEDBACK = 'OutcomeFeedback',
}

export enum EdgeType {
  HAS_ACTION = 'HAS_ACTION',
  HAS_INPUT = 'HAS_INPUT',
  HAS_TEST = 'HAS_TEST',
  FOUND_ON = 'FOUND_ON',
  REQUIRES_AUTH = 'REQUIRES_AUTH',
  CHAINED_FROM = 'CHAINED_FROM',
  TARGETS = 'TARGETS',
  PRODUCED = 'PRODUCED',
  HAS_ROLE = 'HAS_ROLE',
  PERMISSION = 'PERMISSION',
  BUILT_ON = 'BUILT_ON',
  PRODUCED_BY = 'PRODUCED_BY',
  VALUE_ORIGIN = 'VALUE_ORIGIN',
  REQUIRES_ROLE = 'REQUIRES_ROLE',
  CHAINS_TO = 'CHAINS_TO',
}

export interface GraphNodeData {
  id: string
  type: NodeType
  label: string
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface GraphEdgeData {
  id: string
  fromId: string
  toId: string
  type: EdgeType
  properties: Record<string, unknown>
  createdAt: number
}

export interface PageNode extends GraphNodeData {
  type: NodeType.PAGE
  properties: {
    url: string
    method?: string
    contentType?: string
    status?: number
    tags?: string[]
    bodyPreview?: string
    requiresAuth?: boolean
  }
}

export interface ActionNode extends GraphNodeData {
  type: NodeType.ACTION
  properties: {
    actionType: string
    selector?: string
    url?: string
    value?: string
    naturalLanguage?: string
  }
}

export interface InputNode extends GraphNodeData {
  type: NodeType.INPUT
  properties: {
    selector: string
    inputType: string
    name?: string
    placeholder?: string
    required?: boolean
    maxLength?: number
  }
}

export interface EndpointNode extends GraphNodeData {
  type: NodeType.ENDPOINT
  properties: {
    url: string
    method: string
    description?: string
    params: Array<{ name: string; type: string; in: string; required?: boolean }>
    headers?: Record<string, string>
    bodySchema?: Record<string, unknown>
    authRequired?: boolean
    authType?: string
    tags?: string[]
    source?: string
    useCase?: string
    preconditions?: string[]
  }
}

export interface FindingNode extends GraphNodeData {
  type: NodeType.FINDING
  properties: {
    severity: Severity
    technique: string
    endpoint: string
    evidence: string[]
    screenshots?: string[]
    remediation?: string
    cwe?: string
    impact?: string
    confidence: number
    lifecycleStatus: FindingLifecycleStatus
    evidenceLevel: EvidenceLevel
    findingId: string
    verifiedAt?: string
    verificationNote?: string
  }
}

export interface AuthFlowNode extends GraphNodeData {
  type: NodeType.AUTH_FLOW
  properties: {
    flowType: AuthFlowType
    steps: Array<{ action: string; url?: string; selector?: string; value?: string }>
    reusable: boolean
    credentialHash?: string
  }
}

export interface RBACRoleNode extends GraphNodeData {
  type: NodeType.RBAC_ROLE
  properties: {
    roleName: string
    accessibleEndpoints: string[]
    inaccessibleEndpoints: string[]
    visibleUIElements: string[]
  }
}

export interface TestNode extends GraphNodeData {
  type: NodeType.TEST
  properties: {
    testType: string
    status: string
    endpoint: string
    technique: string
    payload: string
    tags?: string[]
    expectedResult?: string
    actualResult?: string
  }
}

export interface AttackNode extends GraphNodeData {
  type: NodeType.ATTACK
  properties: {
    technique: string
    payload: string
    vulnerable: boolean
    confidence: number
    timestamp: number
  }
}

export interface FactNode extends GraphNodeData {
  type: NodeType.FACT
  properties: {
    description: string
    source: string
    confidence: number
    relatedIntents?: string[]
  }
}

export interface IntentNode extends GraphNodeData {
  type: NodeType.INTENT
  properties: {
    description: string
    status: 'open' | 'exploring' | 'concluded' | 'abandoned'
    fromFacts?: string[]
    resultFact?: string
    attackPath?: string
    note?: string
  }
}

export interface ReflexionNode extends GraphNodeData {
  type: NodeType.REFLEXION
  properties: {
    workerId: string
    vulnType: string
    failureCategory: string
    escalationLevel: number
    failedPaths: string[]
    hints: string[]
    targetOrigin?: string
  }
}

export interface WorkflowNode extends GraphNodeData {
  type: NodeType.WORKFLOW
  properties: {
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
}

export interface EntityNode extends GraphNodeData {
  type: NodeType.ENTITY
  properties: {
    name: string
    ids: string[]
    endpoints: string[]
    ownerFields: string[]
    roleFields: string[]
    sensitiveFields: string[]
    lifecycleStates: string[]
    confidence: number
  }
}

export interface HypothesisNode extends GraphNodeData {
  type: NodeType.HYPOTHESIS
  properties: {
    title: string
    kind: string
    reason: string
    targetEndpoints: string[]
    relatedWorkflowIds: string[]
    relatedEntityIds: string[]
    requiredSetup: string[]
    risk: Severity
    confidence: number
    status: HypothesisStatus
    origin?: 'human' | 'llm'
  }
}

export interface ExperimentNode extends GraphNodeData {
  type: NodeType.EXPERIMENT
  properties: {
    hypothesisId: string
    title: string
    setup: string[]
    baselineRequest?: Record<string, unknown>
    mutation: string
    expectedSecureBehavior: string
    insecureSignal: string
    requiredActors: string[]
    tools: string[]
    status: ExperimentStatus
    resultSummary?: string
    differential?: Record<string, unknown>
  }
}

export interface CandidateFindingNode extends GraphNodeData {
  type: NodeType.CANDIDATE_FINDING
  properties: {
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
}

export type AuthScheme =
  | 'basic'
  | 'base64'
  | 'jwt'
  | 'bearer'
  | 'api-key'
  | 'custom'
  | 'cookie'

export interface HeaderSemanticNode extends GraphNodeData {
  type: NodeType.HEADER_SEMANTIC
  properties: {
    header: string
    role: 'identity' | 'required' | 'static' | 'anti-bot' | 'correlation'
    endpoint?: string
    confidence?: number
  }
}

export interface OutcomeFeedbackNode extends GraphNodeData {
  type: NodeType.OUTCOME_FEEDBACK
  properties: {
    findingId: string
    techniqueId: string
    accepted?: boolean
    fixed?: boolean
    retestHeld?: boolean
    severityAdjusted?: string
    note?: string
    targetOrigin?: string
    timestamp: string
  }
}

export interface AuthSchemeNode extends GraphNodeData {
  type: NodeType.AUTH_SCHEME
  properties: {
    scheme: 'basic' | 'base64' | 'jwt' | 'bearer' | 'api-key' | 'custom' | 'cookie'
    decoded?: boolean
    reusedAcross?: string[]
    maskedCredential?: string
  }
}

export type AnyNodeData = GraphNodeData | PageNode | ActionNode | InputNode | EndpointNode | TestNode | FindingNode | AuthFlowNode | RBACRoleNode | AttackNode | FactNode | IntentNode | ReflexionNode | WorkflowNode | EntityNode | HypothesisNode | ExperimentNode | CandidateFindingNode | HeaderSemanticNode | AuthSchemeNode | OutcomeFeedbackNode

export const NODE_PROPERTIES: Record<NodeType, string[]> = {
  [NodeType.PAGE]: ['url', 'method', 'contentType', 'status', 'tags', 'bodyPreview', 'requiresAuth'],
  [NodeType.ACTION]: ['actionType', 'selector', 'url', 'value', 'naturalLanguage'],
  [NodeType.INPUT]: ['selector', 'inputType', 'name', 'placeholder', 'required', 'maxLength'],
  [NodeType.ENDPOINT]: ['url', 'method', 'description', 'params', 'headers', 'bodySchema', 'authRequired', 'authType', 'tags', 'source'],
  [NodeType.TEST]: ['testType', 'status', 'endpoint', 'technique', 'payload', 'tags', 'expectedResult', 'actualResult'],
  [NodeType.FINDING]: ['severity', 'technique', 'endpoint', 'evidence', 'screenshots', 'remediation', 'cwe', 'impact', 'confidence', 'lifecycleStatus', 'evidenceLevel', 'findingId', 'verifiedAt', 'verificationNote'],
  [NodeType.AUTH_FLOW]: ['flowType', 'steps', 'reusable', 'credentialHash'],
  [NodeType.RBAC_ROLE]: ['roleName', 'accessibleEndpoints', 'inaccessibleEndpoints', 'visibleUIElements'],
  [NodeType.ATTACK]: ['technique', 'payload', 'vulnerable', 'confidence', 'timestamp'],
  [NodeType.FACT]: ['description', 'source', 'confidence', 'relatedIntents'],
  [NodeType.INTENT]: ['description', 'status', 'fromFacts', 'resultFact', 'attackPath', 'note'],
  [NodeType.REFLEXION]: ['workerId', 'vulnType', 'failureCategory', 'escalationLevel', 'failedPaths', 'hints', 'targetOrigin'],
  [NodeType.WORKFLOW]: ['name', 'entryUrl', 'steps', 'relatedEndpoints', 'requiredAuth', 'inputFields', 'stateChanges', 'observedRoles', 'confidence'],
  [NodeType.ENTITY]: ['name', 'ids', 'endpoints', 'ownerFields', 'roleFields', 'sensitiveFields', 'lifecycleStates', 'confidence'],
  [NodeType.HYPOTHESIS]: ['title', 'kind', 'reason', 'targetEndpoints', 'relatedWorkflowIds', 'relatedEntityIds', 'requiredSetup', 'risk', 'confidence', 'status'],
  [NodeType.EXPERIMENT]: ['hypothesisId', 'title', 'setup', 'baselineRequest', 'mutation', 'expectedSecureBehavior', 'insecureSignal', 'requiredActors', 'tools', 'status', 'resultSummary', 'differential'],
  [NodeType.CANDIDATE_FINDING]: ['title', 'signalType', 'endpoint', 'evidence', 'experimentIds', 'confidence', 'nextVerificationSteps', 'blockers', 'status', 'severity'],
  [NodeType.HEADER_SEMANTIC]: ['header', 'role', 'endpoint', 'confidence'],
  [NodeType.AUTH_SCHEME]: ['scheme', 'decoded', 'reusedAcross', 'maskedCredential'],
  [NodeType.OUTCOME_FEEDBACK]: ['findingId', 'techniqueId', 'accepted', 'fixed', 'retestHeld', 'severityAdjusted', 'note', 'targetOrigin', 'timestamp'],
}
