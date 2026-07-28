import type {
  Severity,
  EvidenceLevel,
  FindingLifecycleStatus,
  AuthFlowType,
  HypothesisStatus,
  ExperimentStatus,
  CandidateFindingStatus,
} from '../types/shared'
import { z } from 'zod'

export const FindingSchema = z.object({
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  technique: z.string(),
  endpoint: z.string(),
  evidence: z.array(z.string()),
  screenshots: z.array(z.string()).optional(),
  remediation: z.string().optional(),
  cwe: z.string().optional(),
  impact: z.string().optional(),
  confidence: z.number().min(0).max(1),
  lifecycleStatus: z.enum(['new', 'triaged', 'confirmed', 'mitigated', 'disproven', 'pending_verification', 'verified']),
  evidenceLevel: z.enum(['L1', 'L2', 'L3']),
  findingId: z.string().uuid(),
  verifiedAt: z.string().datetime().optional(),
  verificationNote: z.string().optional(),
})

export const EndpointSchema = z.object({
  url: z.string().url(),
  method: z.string(),
  endpointKey: z.string().optional(),
  description: z.string().optional(),
  params: z.array(z.object({ name: z.string(), type: z.string(), in: z.string(), required: z.boolean().optional() })).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodySchema: z.record(z.string(), z.unknown()).optional(),
  authRequired: z.boolean().optional(),
  authType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  useCase: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  origin: z.enum(['target', 'self']).optional(),
})

export const ActionSchema = z.object({
  actionType: z.string(),
  selector: z.string().optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  naturalLanguage: z.string().optional(),
})

export const InputSchema = z.object({
  selector: z.string(),
  inputType: z.string(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  maxLength: z.number().optional(),
})

export const PageSchema = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  contentType: z.string().optional(),
  status: z.number().optional(),
  tags: z.array(z.string()).optional(),
  bodyPreview: z.string().optional(),
  requiresAuth: z.boolean().optional(),
})

export const TestSchema = z.object({
  testType: z.string(),
  status: z.string(),
  endpoint: z.string(),
  technique: z.string(),
  payload: z.string(),
  tags: z.array(z.string()).optional(),
  expectedResult: z.string().optional(),
  actualResult: z.string().optional(),
})

export const AuthFlowSchema = z.object({
  flowType: z.enum(['login', 'oauth', 'saml', 'mfa', 'api-key', 'logout', 'refresh', 'jwt-forgery', 'default-creds', 'session-reuse', 'form-fill', 'navigation', 'custom']),
  steps: z.array(z.object({ action: z.string(), url: z.string().optional(), selector: z.string().optional(), value: z.string().optional() })),
  reusable: z.boolean(),
  credentialHash: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  target: z.string().optional(),
  startUrl: z.string().optional(),
  cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.string(), expires: z.number().optional() })).optional(),
  savedAt: z.string().optional(),
  localStorage: z.record(z.string(), z.string()).optional(),
  actionNodeIds: z.array(z.string()).optional(),
})

export const RBACRoleSchema = z.object({
  roleName: z.string(),
  accessibleEndpoints: z.array(z.string()),
  inaccessibleEndpoints: z.array(z.string()),
  visibleUIElements: z.array(z.string()),
})

export const AttackSchema = z.object({
  technique: z.string(),
  payload: z.string(),
  vulnerable: z.boolean(),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
})

export const FactSchema = z.object({
  description: z.string(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  relatedIntents: z.array(z.string()).optional(),
})

export const IntentSchema = z.object({
  description: z.string(),
  status: z.enum(['open', 'exploring', 'concluded', 'abandoned']),
  fromFacts: z.array(z.string()).optional(),
  resultFact: z.string().optional(),
  attackPath: z.string().optional(),
  note: z.string().optional(),
})

export const ReflexionSchema = z.object({
  workerId: z.string(),
  vulnType: z.string(),
  failureCategory: z.string(),
  escalationLevel: z.number().int().min(0).max(4),
  failedPaths: z.array(z.string()),
  hints: z.array(z.string()),
  targetOrigin: z.string().optional(),
})

export const WorkflowSchema = z.object({
  name: z.string(),
  entryUrl: z.string().url().optional(),
  steps: z.array(z.object({ action: z.string(), url: z.string().optional(), endpointId: z.string().optional(), method: z.string().optional() })),
  relatedEndpoints: z.array(z.string()).optional(),
  requiredAuth: z.boolean().optional(),
  inputFields: z.array(z.string()),
  stateChanges: z.array(z.string()),
  observedRoles: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})

export const EntitySchema = z.object({
  name: z.string(),
  ids: z.array(z.string()),
  endpoints: z.array(z.string()),
  ownerFields: z.array(z.string()),
  roleFields: z.array(z.string()),
  sensitiveFields: z.array(z.string()),
  lifecycleStates: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})

export const HypothesisSchema = z.object({
  title: z.string(),
  kind: z.string(),
  reason: z.string(),
  targetEndpoints: z.array(z.string()),
  relatedWorkflowIds: z.array(z.string()).optional(),
  relatedEntityIds: z.array(z.string()).optional(),
  requiredSetup: z.array(z.string()).optional(),
  risk: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  status: z.enum(['open', 'testing', 'confirmed', 'rejected']),
  origin: z.enum(['human', 'llm']).optional(),
})

export const ExperimentSchema = z.object({
  hypothesisId: z.string().uuid(),
  title: z.string(),
  setup: z.array(z.string()),
  baselineRequest: z.record(z.string(), z.unknown()).optional(),
  mutation: z.string(),
  expectedSecureBehavior: z.string(),
  insecureSignal: z.string(),
  requiredActors: z.array(z.string()),
  tools: z.array(z.string()),
  status: z.enum(['planned', 'running', 'completed', 'failed']),
  resultSummary: z.string().optional(),
  differential: z.record(z.string(), z.unknown()).optional(),
})

export const CandidateFindingSchema = z.object({
  title: z.string(),
  signalType: z.string(),
  endpoint: z.string(),
  evidence: z.array(z.string()),
  experimentIds: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1),
  nextVerificationSteps: z.array(z.string()),
  blockers: z.array(z.string()),
  status: z.enum(['new', 'triaged', 'testing', 'confirmed', 'rejected', 'mitigated']),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
})

export const HeaderSemanticSchema = z.object({
  header: z.string(),
  role: z.enum(['identity', 'required', 'static', 'anti-bot', 'correlation']),
  endpoint: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const OutcomeFeedbackSchema = z.object({
  findingId: z.string().uuid(),
  techniqueId: z.string(),
  accepted: z.boolean().optional(),
  fixed: z.boolean().optional(),
  retestHeld: z.boolean().optional(),
  severityAdjusted: z.string().optional(),
  note: z.string().optional(),
  targetOrigin: z.string().optional(),
  timestamp: z.string().datetime(),
})

export const AuthSchemeSchema = z.object({
  scheme: z.enum(['basic', 'base64', 'jwt', 'bearer', 'api-key', 'custom', 'cookie']),
  decoded: z.boolean().optional(),
  reusedAcross: z.array(z.string()).optional(),
  maskedCredential: z.string().optional(),
})

export const RenderedElementSchema = z.object({
  url: z.string().url().optional(),
  method: z.string().optional(),
  selector: z.string(),
  tag: z.string(),
  name: z.string().optional(),
  inputType: z.string().optional(),
  value: z.string().optional(),
  isFormField: z.boolean().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  text: z.string().optional(),
  payloadHit: z.boolean().optional(),
})

export const CouncilDebateSchema = z.object({
  goal: z.string(),
  round: z.number().int().positive(),
  members: z.array(z.string()),
  summary: z.string(),
  proposedTasks: z.number().int().nonnegative(),
  newEvidence: z.number().int().nonnegative(),
  complete: z.boolean(),
})

export const ExploitProofSchema = z.object({
  findingId: z.string().uuid(),
  title: z.string(),
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  expectedVulnerableResponse: z.string().optional(),
  reproSteps: z.array(z.string()),
  replayable: z.boolean(),
  status: z.enum(['proposed', 'agreed', 'replayed', 'confirmed', 'rejected']),
  resultSummary: z.string().optional(),
  actorNote: z.string().optional(),
  scenario: z.string().optional(),
  relation: z.string().optional(),
  request: z.string().optional(),
  response: z.string().optional(),
  impact: z.string().optional(),
})

export const ThreatModelSchema = z.object({
  findingId: z.string().uuid(),
  assetsAtRisk: z.array(z.string()),
  trustBoundary: z.string(),
  nextTarget: z.string().optional(),
  businessImpact: z.string().optional(),
})

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
  RENDERED_ELEMENT = 'RenderedElement',
  COUNCIL_DEBATE = 'CouncilDebate',
  EXPLOIT_PROOF = 'ExploitProof',
  THREAT_MODEL = 'ThreatModel',
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
  RENDERED_ON = 'RENDERED_ON',
  REINGESTS = 'REINGESTS',
  ORDERED_BEFORE = 'ORDERED_BEFORE',
  PROVES = 'PROVES',
  SESSION_REACHES = 'SESSION_REACHES',
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
    title?: string
    contentLength?: number
    sessionId?: string
    timestamp?: number
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
    endpointKey?: string
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
    origin?: 'target' | 'self'
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
    description?: string
    tags?: string[]
  }
}

export interface AuthFlowNode extends GraphNodeData {
  type: NodeType.AUTH_FLOW
  properties: {
    flowType: AuthFlowType
    steps: Array<{ action: string; url?: string; selector?: string; value?: string }>
    reusable: boolean
    credentialHash?: string
    name?: string
    description?: string
    target?: string
    startUrl?: string
    cookies?: Array<{ name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean; sameSite: string; expires?: number }>
    savedAt?: string
    localStorage?: Record<string, string>
    actionNodeIds?: string[]
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
    endpointId?: string
    response?: string
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

export interface RenderedElementNode extends GraphNodeData {
  type: NodeType.RENDERED_ELEMENT
  properties: {
    url?: string
    method?: string
    selector: string
    tag: string
    name?: string
    inputType?: string
    value?: string
    isFormField?: boolean
    attributes?: Record<string, string>
    text?: string
    payloadHit?: boolean
  }
}

export interface CouncilDebateNode extends GraphNodeData {
  type: NodeType.COUNCIL_DEBATE
  properties: {
    goal: string
    round: number
    members: string[]
    summary: string
    proposedTasks: number
    newEvidence: number
    complete: boolean
  }
}

export interface ExploitProofNode extends GraphNodeData {
  type: NodeType.EXPLOIT_PROOF
  properties: {
    findingId: string
    title: string
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    expectedVulnerableResponse?: string
    reproSteps: string[]
    replayable: boolean
    status: 'proposed' | 'agreed' | 'replayed' | 'confirmed' | 'rejected'
    resultSummary?: string
    actorNote?: string
    /** The business-logic scenario class the proof demonstrates (LLM-defined). */
    scenario?: string
    /** The relation type this proof exploits (e.g. REINGESTS). */
    relation?: string
    /** The exact request that achieves the exploit. */
    request?: string
    /** The exact response proving impact. */
    response?: string
    /** Concrete impact achieved. */
    impact?: string
  }
}

/**
 * W0.5 — a threat-model node for a confirmed finding's flow. Typed fields only:
 * the assets at risk, the trust boundary crossed, and the highest-impact next
 * target are LLM/relation-derived (no frozen vocab). Linked to the source
 * finding via a PROVES/CHAINS_TO edge by the caller.
 */
export interface ThreatModelNode extends GraphNodeData {
  type: NodeType.THREAT_MODEL
  properties: {
    findingId: string
    /** In-scope assets reachable from the compromised flow (endpoint ids/urls). */
    assetsAtRisk: string[]
    /** The trust boundary the exploit crosses (e.g. auth, tenant, role). */
    trustBoundary: string
    /** Highest-impact next target the loop should pivot to (in-scope). */
    nextTarget?: string
    /** Concrete business impact if the chain completes. */
    businessImpact?: string
  }
}

export type AnyNodeData = GraphNodeData | PageNode | ActionNode | InputNode | EndpointNode | TestNode | FindingNode | AuthFlowNode | RBACRoleNode | AttackNode | FactNode | IntentNode | ReflexionNode | WorkflowNode | EntityNode | HypothesisNode | ExperimentNode | CandidateFindingNode | HeaderSemanticNode | AuthSchemeNode | OutcomeFeedbackNode | RenderedElementNode | CouncilDebateNode | ExploitProofNode | ThreatModelNode

export const NODE_PROPERTIES: Record<NodeType, string[]> = {
  [NodeType.PAGE]: ['url', 'method', 'contentType', 'status', 'tags', 'bodyPreview', 'requiresAuth'],
  [NodeType.ACTION]: ['actionType', 'selector', 'url', 'value', 'naturalLanguage'],
  [NodeType.INPUT]: ['selector', 'inputType', 'name', 'placeholder', 'required', 'maxLength'],
  [NodeType.ENDPOINT]: ['url', 'method', 'description', 'params', 'headers', 'bodySchema', 'authRequired', 'authType', 'tags', 'source', 'origin'],
  [NodeType.TEST]: ['testType', 'status', 'endpoint', 'technique', 'payload', 'tags', 'expectedResult', 'actualResult'],
  [NodeType.FINDING]: ['severity', 'technique', 'endpoint', 'evidence', 'screenshots', 'remediation', 'cwe', 'impact', 'confidence', 'lifecycleStatus', 'evidenceLevel', 'findingId', 'verifiedAt', 'verificationNote', 'description', 'tags'],
  [NodeType.AUTH_FLOW]: ['flowType', 'steps', 'reusable', 'credentialHash', 'name', 'description', 'target', 'startUrl', 'cookies', 'savedAt', 'localStorage', 'actionNodeIds'],
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
  [NodeType.RENDERED_ELEMENT]: ['url', 'method', 'selector', 'tag', 'name', 'inputType', 'value', 'isFormField', 'attributes', 'text', 'payloadHit'],
  [NodeType.COUNCIL_DEBATE]: ['goal', 'round', 'members', 'summary', 'proposedTasks', 'newEvidence', 'complete'],
  [NodeType.EXPLOIT_PROOF]: ['findingId', 'title', 'method', 'url', 'headers', 'body', 'expectedVulnerableResponse', 'reproSteps', 'replayable', 'status', 'resultSummary', 'actorNote', 'scenario', 'relation', 'request', 'response', 'impact'],
  [NodeType.THREAT_MODEL]: ['findingId', 'assetsAtRisk', 'trustBoundary', 'nextTarget', 'businessImpact'],
}

export const NODE_SCHEMAS: Record<NodeType, z.ZodType> = {
  [NodeType.PAGE]: PageSchema,
  [NodeType.ACTION]: ActionSchema,
  [NodeType.INPUT]: InputSchema,
  [NodeType.ENDPOINT]: EndpointSchema,
  [NodeType.TEST]: TestSchema,
  [NodeType.FINDING]: FindingSchema,
  [NodeType.AUTH_FLOW]: AuthFlowSchema,
  [NodeType.RBAC_ROLE]: RBACRoleSchema,
  [NodeType.ATTACK]: AttackSchema,
  [NodeType.FACT]: FactSchema,
  [NodeType.INTENT]: IntentSchema,
  [NodeType.REFLEXION]: ReflexionSchema,
  [NodeType.WORKFLOW]: WorkflowSchema,
  [NodeType.ENTITY]: EntitySchema,
  [NodeType.HYPOTHESIS]: HypothesisSchema,
  [NodeType.EXPERIMENT]: ExperimentSchema,
  [NodeType.CANDIDATE_FINDING]: CandidateFindingSchema,
  [NodeType.HEADER_SEMANTIC]: HeaderSemanticSchema,
  [NodeType.AUTH_SCHEME]: AuthSchemeSchema,
  [NodeType.OUTCOME_FEEDBACK]: OutcomeFeedbackSchema,
  [NodeType.RENDERED_ELEMENT]: RenderedElementSchema,
  [NodeType.COUNCIL_DEBATE]: CouncilDebateSchema,
  [NodeType.EXPLOIT_PROOF]: ExploitProofSchema,
  [NodeType.THREAT_MODEL]: ThreatModelSchema,
}

/**
 * Validate node properties against the schema for the given node type.
 * Returns { valid, errors } where errors is an array of validation error messages.
 */
export function validateNodeProperties(
  type: NodeType,
  properties: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const schema = NODE_SCHEMAS[type]
  if (!schema) {
    return { valid: true, errors: [] }
  }

  const result = schema.safeParse(properties)
  if (result.success) {
    return { valid: true, errors: [] }
  }

  const errors = result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [
    'Unknown validation error',
  ]
  return { valid: false, errors }
}

