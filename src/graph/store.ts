import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  GraphNodeData,
  GraphEdgeData,
  NodeType,
  EdgeType,
  PageNode,
  ActionNode,
  InputNode,
  EndpointNode,
  FindingNode,
  AuthFlowNode,
  RBACRoleNode,
  AttackNode,
  TestNode,
  FactNode,
  IntentNode,
  ReflexionNode,
  OutcomeFeedbackNode,
  RenderedElementNode,
  AnyNodeData,
} from './schema'

interface SerializedGraph {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

interface LibSQLGraphStore {
  initializeDatabase(): Promise<void>
  upsertPage(url: string, data?: Partial<PageNode['properties']>): PageNode
  addAction(pageId: string, actionData: Partial<ActionNode['properties']>): ActionNode
  addInput(actionId: string, inputData: Partial<InputNode['properties']>): InputNode
  addTest(actionId: string, testData: Partial<{ testType: string; status: string; endpoint: string; technique: string; payload: string; tags: string[]; expectedResult: string; actualResult: string }>): TestNode
  addFinding(data: Partial<FindingNode['properties']>): FindingNode
  addAuthFlow(data: Partial<AuthFlowNode['properties']>): AuthFlowNode
  addRBACRole(data: Partial<RBACRoleNode['properties']>): RBACRoleNode
  addAttack(data: Partial<AttackNode['properties']>): AttackNode
  addOutcome(data: { findingId: string; techniqueId: string; accepted?: boolean; fixed?: boolean; retestHeld?: boolean; severityAdjusted?: string; note?: string; targetOrigin?: string; timestamp?: string }): OutcomeFeedbackNode
  addRenderedElement(endpointId: string | undefined, data: Partial<RenderedElementNode['properties']>): RenderedElementNode
  upsertNode(node: AnyNodeData): AnyNodeData
  updateNode(node: GraphNodeData): void
  getNode(id: string): AnyNodeData | undefined
  deleteNode(id: string): boolean
  chainFindings(fromId: string, toId: string): void
  addEdge(edgeData: { fromId: string; toId: string; type: EdgeType; properties?: Record<string, unknown> }): GraphEdgeData
  queryNodes(type?: NodeType, filters?: Record<string, unknown>): AnyNodeData[]
  queryEdges(filters?: { fromId?: string; toId?: string; type?: EdgeType }): GraphEdgeData[]
  getAllEdges(): GraphEdgeData[]
  getTestCoverage(endpointId: string): TestNode[]
  getUntestedActions(): ActionNode[]
  getAuthFlows(): AuthFlowNode[]
  getRBACMatrix(): { role: string; endpoints: string[] }[]
  getAttackPath(findingId: string): AnyNodeData[]
  save(): Promise<void>
  load(): Promise<void>
  close(): Promise<void>
  exportToJson(): SerializedGraph
  importFromJson(data: SerializedGraph): void
}

export class GraphStore {
  private nodes: Map<string, GraphNodeData> = new Map()
  private edges: GraphEdgeData[] = []
  private readonly savePath: string
  private useLibSQL: boolean
  private libSQLStore?: LibSQLGraphStore
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly SAVE_DEBOUNCE_MS = 500
  /** Serializes file-store writes so overlapping saves never rename the same
   *  target concurrently (the root cause of Windows EPERM on rename). */
  private saveChain: Promise<void> = Promise.resolve()

  constructor(savePath?: string, useLibSQL: boolean = false) {
    this.savePath = savePath || resolve('output', 'graph.json')
    this.useLibSQL = useLibSQL
  }

  scheduleSave(): void {
    if (this.useLibSQL && this.libSQLStore) {
      this.libSQLStore.save().catch(() => {})
      return
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save().catch(() => {})
    }, GraphStore.SAVE_DEBOUNCE_MS)
  }

  private contentHash(str: string): string {
    return createHash('sha256').update(str).digest('hex').slice(0, 12)
  }

  private async getLibSQLStore(): Promise<LibSQLGraphStore> {
    if (!this.libSQLStore && this.useLibSQL) {
      const { LibSQLGraphStore: Store } = await import('./store-libsql')
      const dbPath = this.savePath ? this.savePath.replace('.json', '.db') : resolve('output', 'graph.db')
      this.libSQLStore = new Store(dbPath)
    }
    return this.libSQLStore!
  }

  async initialize(): Promise<void> {
    if (this.useLibSQL && this.libSQLStore) {
      await this.libSQLStore.initializeDatabase()
    }
  }

  upsertPage(url: string, data?: Partial<PageNode['properties']>): PageNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.upsertPage(url, data)
    }

    const id = `page:${url}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as PageNode
    }
    const node: PageNode = {
      id,
      type: NodeType.PAGE,
      label: `Page: ${url}`,
      properties: {
        url,
        method: 'GET',
        tags: [],
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addAction(pageId: string, actionData: Partial<ActionNode['properties']>): ActionNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addAction(pageId, actionData)
    }

    const id = `action:${pageId}:${actionData.actionType || 'unknown'}:${Date.now()}`
    const node: ActionNode = {
      id,
      type: NodeType.ACTION,
      label: `Action: ${actionData.actionType}`,
      properties: {
        actionType: 'click',
        ...actionData,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    this.addEdge({ fromId: pageId, toId: id, type: EdgeType.HAS_ACTION })
    return node
  }

  addRenderedElement(
    endpointId: string | undefined,
    data: Partial<RenderedElementNode['properties']>,
  ): RenderedElementNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addRenderedElement(endpointId, data)
    }

    const id = `rendered:${data.selector || 'unknown'}:${data.url || 'x'}:${Date.now()}`
    const node: RenderedElementNode = {
      id,
      type: NodeType.RENDERED_ELEMENT,
      label: `Rendered ${data.tag}${data.name ? `#${data.name}` : ''} on ${data.url ?? ''}`,
      properties: {
        selector: '',
        tag: 'div',
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    if (endpointId) {
      this.addEdge({ fromId: endpointId, toId: id, type: EdgeType.RENDERED_ON })
    }
    return node
  }

  addInput(actionId: string, inputData: Partial<InputNode['properties']>): InputNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addInput(actionId, inputData)
    }

    const id = `input:${actionId}:${inputData.selector || 'unknown'}`
    const node: InputNode = {
      id,
      type: NodeType.INPUT,
      label: `Input: ${inputData.selector}`,
      properties: {
        selector: '',
        inputType: 'text',
        ...inputData,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    this.addEdge({ fromId: actionId, toId: id, type: EdgeType.HAS_INPUT })
    return node
  }

  addTest(actionId: string, testData: Partial<{ testType: string; status: string; endpoint: string; technique: string; payload: string; tags: string[]; expectedResult: string; actualResult: string }>): TestNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addTest(actionId, testData)
    }

    const id = `test:${actionId}:${testData.testType || 'unknown'}:${Date.now()}`
    const node: TestNode = {
      id,
      type: NodeType.TEST,
      label: `Test: ${testData.testType}`,
      properties: testData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    this.addEdge({ fromId: actionId, toId: id, type: EdgeType.HAS_TEST })
    return node
  }

  addEndpoint(data: Partial<EndpointNode['properties']> & { url: string; method: string }): EndpointNode {
    const existing = Array.from(this.nodes.values()).find(
      n => n.type === NodeType.ENDPOINT &&
        (n.properties as EndpointNode['properties']).url === data.url &&
        (n.properties as EndpointNode['properties']).method?.toUpperCase() === data.method.toUpperCase()
    )
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as EndpointNode
    }

    const id = `endpoint:${data.method.toUpperCase()}:${data.url}:${Date.now()}`
    const node: EndpointNode = {
      id,
      type: NodeType.ENDPOINT,
      label: `${data.method.toUpperCase()} ${data.url}`,
      properties: {
        url: data.url,
        method: data.method.toUpperCase(),
        params: data.params || [],
        ...(data.description ? { description: data.description } : {}),
        ...(data.headers ? { headers: data.headers } : {}),
        ...(data.bodySchema ? { bodySchema: data.bodySchema } : {}),
        ...(data.authRequired !== undefined ? { authRequired: data.authRequired } : {}),
        ...(data.authType ? { authType: data.authType } : {}),
        ...(data.tags ? { tags: data.tags } : {}),
        ...(data.source ? { source: data.source } : {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  getTargetSummary(): {
    totalEndpoints: number
    endpoints: Array<{ id: string; url: string; method: string; params: number; authRequired?: boolean; hasHeaders: boolean; headerCount: number }>
    totalFindings: number
    findingsBySeverity: Record<string, number>
    totalTests: number
    authFlows: number
    rbacRoles: number
    untestedActions: number
    totalCapturedHeaders: number
    totalPages: number
    totalActions: number
    totalInputs: number
    lastUpdated: number
  } {
    const endpoints = this.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
    const findings = this.queryNodes(NodeType.FINDING) as FindingNode[]
    const tests = this.queryNodes(NodeType.TEST) as TestNode[]
    const authFlows = this.queryNodes(NodeType.AUTH_FLOW) as AuthFlowNode[]
    const rbacRoles = this.queryNodes(NodeType.RBAC_ROLE) as RBACRoleNode[]
    const pages = this.queryNodes(NodeType.PAGE) as PageNode[]
    const actions = this.queryNodes(NodeType.ACTION) as ActionNode[]
    const inputs = this.queryNodes(NodeType.INPUT) as InputNode[]
    const untested = this.getUntestedActions()

    const findingsBySeverity: Record<string, number> = {}
    for (const f of findings) {
      const sev = f.properties.severity || 'unknown'
      findingsBySeverity[sev] = (findingsBySeverity[sev] || 0) + 1
    }

    let totalCapturedHeaders = 0
    for (const e of endpoints) {
      const h = e.properties.headers || {}
      totalCapturedHeaders += Array.isArray(h) ? h.length : Object.keys(h).length
    }

    return {
      totalEndpoints: endpoints.length,
      endpoints: endpoints.map(e => {
        const h = e.properties.headers || {}
        const headerKeys = Array.isArray(h) ? h : Object.keys(h)
        return {
          id: e.id,
          url: e.properties.url,
          method: e.properties.method,
          params: (e.properties.params || []).length,
          authRequired: e.properties.authRequired,
          hasHeaders: headerKeys.length > 0,
          headerCount: headerKeys.length,
        }
      }),
      totalFindings: findings.length,
      findingsBySeverity,
      totalTests: tests.length,
      authFlows: authFlows.length,
      rbacRoles: rbacRoles.length,
      untestedActions: untested.length,
      totalCapturedHeaders,
      totalPages: pages.length,
      totalActions: actions.length,
      totalInputs: inputs.length,
      lastUpdated: Date.now(),
    }
  }

  getEndpointsWithParams(): EndpointNode[] {
    return (this.queryNodes(NodeType.ENDPOINT) as EndpointNode[]).filter(
      e => e.properties.params && e.properties.params.length > 0
    )
  }

  addFinding(data: Partial<FindingNode['properties']>): FindingNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addFinding(data)
    }

    const id = `finding:${data.endpoint || 'unknown'}:${data.technique || 'unknown'}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as FindingNode
    }

    const node: FindingNode = {
      id,
      type: NodeType.FINDING,
      label: `Finding: ${data.technique} on ${data.endpoint}`,
      properties: {
        severity: 'medium',
        technique: 'unknown',
        endpoint: '',
        evidence: [],
        confidence: 0,
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addAuthFlow(data: Partial<AuthFlowNode['properties']>): AuthFlowNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addAuthFlow(data)
    }

    const id = `authflow:${data.flowType || 'login'}:${data.startUrl || 'unknown'}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as AuthFlowNode
    }

    const node: AuthFlowNode = {
      id,
      type: NodeType.AUTH_FLOW,
      label: `Auth: ${data.flowType}`,
      properties: {
        flowType: 'login',
        steps: [],
        reusable: true,
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addRBACRole(data: Partial<RBACRoleNode['properties']>): RBACRoleNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addRBACRole(data)
    }

    const id = `rbac:${data.roleName || 'unknown'}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as RBACRoleNode
    }
    const node: RBACRoleNode = {
      id,
      type: NodeType.RBAC_ROLE,
      label: `Role: ${data.roleName}`,
      properties: {
        roleName: 'unknown',
        accessibleEndpoints: [],
        inaccessibleEndpoints: [],
        visibleUIElements: [],
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addAttack(data: Partial<AttackNode['properties']>): AttackNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addAttack(data)
    }

    const payloadHash = this.contentHash(data.payload || 'empty')
    const id = `attack:${data.technique || 'unknown'}:${payloadHash}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as AttackNode
    }

    const node: AttackNode = {
      id,
      type: NodeType.ATTACK,
      label: `Attack: ${data.technique}`,
      properties: {
        technique: 'unknown',
        payload: '',
        vulnerable: false,
        confidence: 0,
        timestamp: Date.now(),
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addFact(data: { description: string; source: string; confidence?: number; relatedIntents?: string[] }): FactNode {
    const id = `fact:${this.contentHash(data.description)}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as FactNode
    }

    const node: FactNode = {
      id,
      type: NodeType.FACT,
      label: `Fact: ${data.description.slice(0, 60)}`,
      properties: {
        description: data.description,
        source: data.source,
        confidence: data.confidence ?? 0.5,
        ...(data.relatedIntents ? { relatedIntents: data.relatedIntents } : {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addIntent(data: { description: string; fromFacts?: string[]; attackPath?: string }): IntentNode {
    const id = `intent:${this.contentHash(data.description)}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as IntentNode
    }

    const node: IntentNode = {
      id,
      type: NodeType.INTENT,
      label: `Intent: ${data.description.slice(0, 60)}`,
      properties: {
        description: data.description,
        status: 'open',
        ...(data.fromFacts ? { fromFacts: data.fromFacts } : {}),
        ...(data.attackPath ? { attackPath: data.attackPath } : {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addReflexion(data: { workerId: string; vulnType: string; failureCategory: string; escalationLevel?: number; failedPaths?: string[]; hints?: string[]; targetOrigin?: string }): ReflexionNode {
    const id = `reflexion:${data.workerId}:${data.vulnType}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as ReflexionNode
    }

    const node: ReflexionNode = {
      id,
      type: NodeType.REFLEXION,
      label: `Reflexion: ${data.vulnType} (${data.failureCategory})`,
      properties: {
        workerId: data.workerId,
        vulnType: data.vulnType,
        failureCategory: data.failureCategory,
        escalationLevel: data.escalationLevel ?? 0,
        failedPaths: data.failedPaths ?? [],
        hints: data.hints ?? [],
        targetOrigin: data.targetOrigin,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addOutcome(data: { findingId: string; techniqueId: string; accepted?: boolean; fixed?: boolean; retestHeld?: boolean; severityAdjusted?: string; note?: string; targetOrigin?: string; timestamp?: string }): OutcomeFeedbackNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addOutcome(data)
    }

    const id = `outcome:${data.findingId}`
    const existing = this.nodes.get(id)
    if (existing) {
      Object.assign(existing.properties, data)
      existing.updatedAt = Date.now()
      return existing as OutcomeFeedbackNode
    }

    const now = data.timestamp || new Date().toISOString()
    const node: OutcomeFeedbackNode = {
      id,
      type: NodeType.OUTCOME_FEEDBACK,
      label: `Outcome: ${data.findingId} (${data.techniqueId})`,
      properties: {
        findingId: data.findingId,
        techniqueId: data.techniqueId,
        accepted: data.accepted,
        fixed: data.fixed,
        retestHeld: data.retestHeld,
        severityAdjusted: data.severityAdjusted,
        note: data.note,
        targetOrigin: data.targetOrigin,
        timestamp: now,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  upsertNode(node: AnyNodeData): AnyNodeData {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.upsertNode(node)
    }

    const existing = this.nodes.get(node.id)
    const now = Date.now()
    if (existing) {
      const updated: AnyNodeData = {
        ...existing,
        ...node,
        properties: {
          ...existing.properties,
          ...node.properties,
        },
        createdAt: existing.createdAt,
        updatedAt: now,
      } as AnyNodeData
      this.nodes.set(node.id, updated)
      return updated
    }

    const created: AnyNodeData = {
      ...node,
      createdAt: node.createdAt || now,
      updatedAt: node.updatedAt || now,
    } as AnyNodeData
    this.nodes.set(created.id, created)
    return created
  }

  updateNode(node: AnyNodeData): void {
    if (this.useLibSQL && this.libSQLStore) {
      this.libSQLStore.updateNode(node)
      return
    }
    this.nodes.set(node.id, { ...node, updatedAt: Date.now() })
  }

  getNode(id: string): AnyNodeData | undefined {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getNode(id)
    }
    return this.nodes.get(id) as AnyNodeData | undefined
  }

  deleteNode(id: string): boolean {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.deleteNode(id)
    }
    return this.nodes.delete(id)
  }

  chainFindings(fromId: string, toId: string): void {
    if (this.useLibSQL && this.libSQLStore) {
      this.libSQLStore.chainFindings(fromId, toId)
      return
    }

    this.addEdge({ fromId, toId, type: EdgeType.CHAINED_FROM })
  }

  addEdge(edgeData: { fromId: string; toId: string; type: EdgeType; properties?: Record<string, unknown> }): GraphEdgeData {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addEdge(edgeData)
    }

    const id = `edge:${edgeData.fromId}:${edgeData.toId}:${edgeData.type}`
    if (this.edges.some(e => e.id === id)) {
      return this.edges.find(e => e.id === id)!
    }
    const edge: GraphEdgeData = {
      id,
      fromId: edgeData.fromId,
      toId: edgeData.toId,
      type: edgeData.type,
      properties: edgeData.properties ?? {},
      createdAt: Date.now(),
    }
    this.edges.push(edge)
    return edge
  }

  queryEdges(filters?: { fromId?: string; toId?: string; type?: EdgeType }): GraphEdgeData[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.queryEdges(filters)
    }

    let result = this.edges
    if (filters?.fromId) {
      result = result.filter(e => e.fromId === filters.fromId)
    }
    if (filters?.toId) {
      result = result.filter(e => e.toId === filters.toId)
    }
    if (filters?.type) {
      result = result.filter(e => e.type === filters.type)
    }
    return result
  }

  getAllEdges(): GraphEdgeData[] {
    return this.queryEdges()
  }

  queryNodes(type?: NodeType, filters?: Record<string, unknown>): AnyNodeData[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.queryNodes(type, filters)
    }

    let result = Array.from(this.nodes.values())

    if (type) {
      result = result.filter(n => n.type === type)
    }

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === null || value === '') continue
        if (key === 'url') {
          result = result.filter(n =>
            typeof n.properties.url === 'string' &&
            n.properties.url.includes(String(value))
          )
        } else if (key === 'method') {
          result = result.filter(n => n.properties.method === value)
        } else if (key === 'tags') {
          const tags = Array.isArray(value) ? value : [value]
          result = result.filter(n => {
            const nodeTags = n.properties.tags
            return Array.isArray(nodeTags) && tags.some(t => nodeTags.includes(t))
          })
        }
      }
    }

    return result
  }

  getTestCoverage(endpointId: string): GraphNodeData[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getTestCoverage(endpointId)
    }

    const endpoint = this.nodes.get(endpointId)
    const endpointUrl = (endpoint?.properties as Record<string, unknown>)?.url
    return this.queryNodes(NodeType.TEST).filter(t => 
      (t.properties as Record<string, unknown>).endpoint === endpointId ||
      (endpointUrl && (t.properties as Record<string, unknown>).endpoint === endpointUrl)
    )
  }

  getUntestedActions(): ActionNode[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getUntestedActions()
    }

    const actions = this.queryNodes(NodeType.ACTION) as ActionNode[]
    const testedActionIds = new Set(
      this.edges
        .filter(e => e.type === EdgeType.HAS_TEST)
        .map(e => e.fromId)
    )
    return actions.filter(a => !testedActionIds.has(a.id))
  }

  getAuthFlows(): AuthFlowNode[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getAuthFlows()
    }

    return this.queryNodes(NodeType.AUTH_FLOW) as AuthFlowNode[]
  }

  getRBACMatrix(): { role: string; endpoints: string[] }[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getRBACMatrix()
    }

    const roles = this.queryNodes(NodeType.RBAC_ROLE) as RBACRoleNode[]
    return roles.map(r => ({
      role: r.properties.roleName,
      endpoints: [
        ...r.properties.accessibleEndpoints,
        ...r.properties.inaccessibleEndpoints.map(e => `${e} (denied)`),
      ],
    }))
  }

  getAttackPath(findingId: string): AnyNodeData[] {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.getAttackPath(findingId)
    }

    const path: AnyNodeData[] = []
    const node = this.nodes.get(findingId)
    if (!node) return path

    path.push(node)
    const visited = new Set<string>()
    const queue = [findingId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const incoming = this.edges.filter(e => e.toId === currentId && e.type === EdgeType.CHAINED_FROM)
      for (const edge of incoming) {
        const parent = this.nodes.get(edge.fromId)
        if (parent && !visited.has(parent.id)) {
          path.unshift(parent)
          queue.push(parent.id)
        }
      }
    }

    return path
  }

  async save(filePath?: string): Promise<void> {
    const targetPath = filePath || this.savePath

    if (this.useLibSQL && this.libSQLStore) {
      await this.libSQLStore.save()
      return
    }

    // Serialize file writes behind a single promise chain so concurrent
    // scheduleSave() calls never overlap their renames (Windows EPERM fix).
    const run = this.saveChain.then(
      () => this.atomicWrite(targetPath),
      () => this.atomicWrite(targetPath),
    )
    this.saveChain = run.catch(() => {})
    return run
  }

  /**
   * Atomic, crash-safe file write: temp file -> .bak of current -> rename
   * temp over target. Renames are retried with backoff on EPERM/EBUSY so a
   * transient external lock (antivirus, cloud-sync watcher) doesn't drop the
   * save. Serialization via `saveChain` already prevents self-overlap.
   */
  private async atomicWrite(targetPath: string): Promise<void> {
    const dir = resolve(targetPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    const data: SerializedGraph = {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    }
    const json = JSON.stringify(data, null, 2)
    const tmpPath = `${targetPath}.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

    await writeFile(tmpPath, json, 'utf-8')

    // Snapshot the current file as .bak (best-effort).
    if (existsSync(targetPath)) {
      try {
        await rename(targetPath, `${targetPath}.bak`)
      } catch { /* first save, or briefly locked — non-fatal */ }
    }

    let lastErr: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(tmpPath, targetPath)
        return
      } catch (err: any) {
        lastErr = err
        const code = err?.code
        if (code === 'EPERM' || code === 'EBUSY') {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
          continue
        }
        throw err
      }
    }
    // Exhausted retries — drop the orphaned temp file and surface the error.
    try { await unlink(tmpPath) } catch { /* ignore */ }
    throw lastErr
  }

  async load(filePath?: string): Promise<void> {
    const targetPath = filePath || this.savePath
    
    if (this.useLibSQL && this.libSQLStore) {
      await this.libSQLStore.load()
      return
    }

    if (!existsSync(targetPath)) return

    try {
      const raw = await readFile(targetPath, 'utf-8')
      const data = JSON.parse(raw) as SerializedGraph
      if (data.nodes) {
        this.nodes.clear()
        for (const n of data.nodes) {
          this.nodes.set(n.id, n)
        }
      }
      if (data.edges) this.edges = data.edges
    } catch (err) {
      console.warn(`[graph] Primary graph corrupt at ${targetPath}, trying backup...`)
      const backupPath = `${targetPath}.bak`
      if (existsSync(backupPath)) {
        try {
          const raw = await readFile(backupPath, 'utf-8')
          const data = JSON.parse(raw) as SerializedGraph
          if (data.nodes) {
            this.nodes.clear()
            for (const n of data.nodes) {
              this.nodes.set(n.id, n)
            }
          }
          if (data.edges) this.edges = data.edges
          console.info(`[graph] Restored from backup: ${backupPath}`)
        } catch {
          console.warn(`[graph] Backup also corrupt, starting fresh`)
        }
      } else {
        console.warn(`[graph] No backup available, starting fresh`)
      }
    }
  }

  async close(): Promise<void> {
    if (this.useLibSQL && this.libSQLStore) {
      await this.libSQLStore.close()
    }
  }

  exportToJson(filePath?: string): SerializedGraph {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.exportToJson()
    }

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    }
  }

  importFromJson(data: SerializedGraph, filePath?: string): void {
    if (this.useLibSQL && this.libSQLStore) {
      this.libSQLStore.importFromJson(data)
      return
    }

    this.nodes.clear()
    for (const node of data.nodes) {
      this.nodes.set(node.id, node)
    }
    this.edges = data.edges
  }

  snapshot(): string {
    return JSON.stringify(this.exportToJson())
  }

  restoreFromSnapshot(snapshot: string): void {
    const data = JSON.parse(snapshot) as SerializedGraph
    this.nodes.clear()
    for (const node of data.nodes) {
      this.nodes.set(node.id, node)
    }
    this.edges = data.edges
  }

  isUsingLibSQL(): boolean {
    return this.useLibSQL
  }
}

let _globalGraphStore: GraphStore | null = null

export function getGlobalGraphStore(): GraphStore {
  if (!_globalGraphStore) {
    throw new Error('Graph store not initialized. Ensure workspace.switchTarget() is called before accessing the graph store.')
  }
  return _globalGraphStore
}

export function setGlobalGraphStore(store: GraphStore): void {
  _globalGraphStore = store
}

export function createLibSQLGraphStore(savePath?: string): GraphStore {
  const store = new GraphStore(savePath, true)
  return store
}
