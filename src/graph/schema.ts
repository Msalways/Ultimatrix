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
  }
}

export interface FindingNode extends GraphNodeData {
  type: NodeType.FINDING
  properties: {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
    technique: string
    endpoint: string
    evidence: string[]
    screenshots?: string[]
    remediation?: string
    cwe?: string
    impact?: string
    confidence: number
    lifecycleStatus: 'candidate' | 'pending_verification' | 'verified' | 'rejected' | 'needs_review'
    evidenceLevel: 'L1' | 'L2' | 'L3' | 'L4'
    findingId: string
    verifiedAt?: string
    verificationNote?: string
  }
}

export interface AuthFlowNode extends GraphNodeData {
  type: NodeType.AUTH_FLOW
  properties: {
    flowType: 'login' | 'logout' | 'refresh'
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

export type AnyNodeData = GraphNodeData | PageNode | ActionNode | InputNode | EndpointNode | TestNode | FindingNode | AuthFlowNode | RBACRoleNode | AttackNode | FactNode | IntentNode | ReflexionNode

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
}