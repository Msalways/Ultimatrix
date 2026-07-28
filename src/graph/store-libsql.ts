import { createClient } from '@libsql/client'
import { resolve } from 'path'
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
  OutcomeFeedbackNode,
  RenderedElementNode,
  CouncilDebateNode,
  ExploitProofNode,
  ThreatModelNode,
  AnyNodeData,
} from './schema'
import { log } from '../utils/logger'

interface SerializedGraph {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

export class LibSQLGraphStore {
  private db: ReturnType<typeof createClient>
  private readonly dbPath: string
  private currentTransaction: number | null = null

  constructor(dbPath?: string) {
    this.dbPath = dbPath || resolve('output', 'graph.db')
    this.db = createClient({
      url: `file:${this.dbPath}`
    })

    this.initializeDatabase()
  }

  /**
   * Begin a transaction. All subsequent database operations until commit/rollback
   * are grouped into this transaction.
   */
  async beginTransaction(): Promise<void> {
    const txId = Date.now()
    this.currentTransaction = txId
    await this.db.execute(`SAVEPOINT libsql_tx_${txId}`)
    log.dim(`[libsql] Transaction ${txId} begun`)
  }

  /**
   * Commit the current transaction. All pending changes are made permanent.
   */
  async commitTransaction(): Promise<void> {
    if (this.currentTransaction === null) {
      throw new Error('No active transaction to commit')
    }
    const txId = this.currentTransaction
    await this.db.execute(`RELEASE SAVEPOINT libsql_tx_${txId}`)
    log.dim(`[libsql] Transaction ${txId} committed`)
    this.currentTransaction = null
  }

  /**
   * Rollback the current transaction. All pending changes are discarded.
   */
  async rollbackTransaction(): Promise<void> {
    if (this.currentTransaction === null) {
      throw new Error('No active transaction to rollback')
    }
    const txId = this.currentTransaction
    await this.db.execute(`ROLLBACK TO SAVEPOINT libsql_tx_${txId}`)
    log.dim(`[libsql] Transaction ${txId} rolled back`)
    this.currentTransaction = null
  }

  /**
   * Get the current transaction ID if active.
   */
  getTransactionId(): number | null {
    return this.currentTransaction
  }

  async initializeDatabase(): Promise<void> {
    // Create tables if they don't exist
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        properties TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_id) REFERENCES nodes(id),
        FOREIGN KEY (to_id) REFERENCES nodes(id)
      )
    `)

    // Create indexes for better performance
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)
    `)

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)
    `)

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)
    `)
  }

  upsertPage(url: string, data?: Partial<PageNode['properties']>): PageNode {
    const id = `page:${url}`
    const existing = this.getNode(id)

    if (existing) {
      const props = existing.properties as PageNode['properties']
      const newData = data ?? {}
      const merged: Record<string, unknown> = {}

      // Only merge fields that are absent or empty
      if (newData.title && !props.title) merged.title = newData.title
      if (newData.contentType && !props.contentType) merged.contentType = newData.contentType
      if (newData.contentLength && (!props.contentLength || props.contentLength === 0)) merged.contentLength = newData.contentLength
      if (newData.sessionId && !props.sessionId) merged.sessionId = newData.sessionId
      if (newData.timestamp && !props.timestamp) merged.timestamp = newData.timestamp

      const existingTags = props.tags ?? []
      const newTags = newData.tags ?? []
      const mergedTags = [...new Set([...existingTags, ...newTags])]
      if (mergedTags.length > existingTags.length) merged.tags = mergedTags

      if (Object.keys(merged).length > 0) {
        this.executeWithTransaction(async () => {
          await this.updateNode({
            id,
            type: NodeType.PAGE,
            label: existing.label,
            properties: {
              ...props,
              ...merged,
            },
            createdAt: existing.createdAt,
            updatedAt: Date.now(),
          })
        })
      }

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

    this.insertNode(node)
     return node
    }

  /**
    * Non-destructive merge: reads existing endpoint by url+method, merges only
    * fields that are absent or empty in the existing node. Capture modules use
    * this instead of addEndpoint to avoid overwriting richer data (auth type,
    * params, use-case) that was discovered by other sources.
    */
  mergeEndpoint(data: Partial<EndpointNode['properties']> & { url: string; method: string }): EndpointNode {
    const id = `endpoint:${data.url}:${data.method}`
    const existing = this.getNode(id)

    if (!existing) {
      const { url: _url, method: _method, ...rest } = data
      return this.upsertNode({
        id,
        type: NodeType.ENDPOINT,
        label: `Endpoint: ${data.method} ${data.url}`,
        properties: {
          url: data.url,
          method: data.method,
          params: [],
          ...rest,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as EndpointNode
    }

    const props = existing.properties as EndpointNode['properties']
    const newHeaders: any = data.headers
    const existingHeaders: any = props.headers ?? (Array.isArray(newHeaders) ? [] : {})
    const mergedHeaders: any = Array.isArray(newHeaders)
      ? [...(Array.isArray(existingHeaders) ? existingHeaders : []), ...newHeaders.filter((h: any) => !(Array.isArray(existingHeaders) ? existingHeaders : []).some((eh: any) => eh.name?.toLowerCase() === h.name?.toLowerCase()))]
      : (Array.isArray(existingHeaders) ? existingHeaders : { ...(existingHeaders as Record<string, string>), ...(newHeaders as Record<string, string>) })

    const existingParams = props.params ?? []
    const newParams = data.params ?? []
    const paramNames = new Set(existingParams.map((p: { name: string }) => p.name.toLowerCase()))
    const mergedParams = [
      ...existingParams,
      ...newParams.filter((p: { name: string }) => !paramNames.has(p.name.toLowerCase())),
    ]

    const existingTags = props.tags ?? []
    const newTags = data.tags ?? []
    const mergedTags = [...new Set([...existingTags, ...newTags])]

    const existingSources = String(props.source ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const newSource = data.source ?? ''
    if (newSource && !existingSources.includes(newSource)) {
      existingSources.push(newSource)
    }

    this.executeWithTransaction(async () => {
      await this.updateNode({
        id,
        type: NodeType.ENDPOINT,
        label: existing.label,
        properties: {
          ...props,
          ...(Array.isArray(mergedHeaders) ? (mergedHeaders.length > (Array.isArray(existingHeaders) ? existingHeaders.length : 0) ? { headers: mergedHeaders } : {}) : (Object.keys(mergedHeaders).length > Object.keys(existingHeaders).length ? { headers: mergedHeaders } : {})),
          ...(mergedParams.length > existingParams.length ? { params: mergedParams } : {}),
          ...(mergedTags.length > existingTags.length ? { tags: mergedTags } : {}),
          ...(existingSources.length > 0 ? { source: existingSources.join(', ') } : {}),
          ...(data.authRequired !== undefined && props.authRequired === undefined ? { authRequired: data.authRequired } : {}),
          ...(data.authType && !props.authType ? { authType: data.authType } : {}),
          ...(data.bodySchema && !props.bodySchema ? { bodySchema: data.bodySchema } : {}),
          ...(data.description && !props.description ? { description: data.description } : {}),
        },
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      })
    })

    return existing as EndpointNode
  }

  addAction(pageId: string, actionData: Partial<ActionNode['properties']>): ActionNode {
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
    
    this.insertNode(node)
    this.addEdge({ fromId: pageId, toId: id, type: EdgeType.HAS_ACTION })
    return node
  }

  addInput(actionId: string, inputData: Partial<InputNode['properties']>): InputNode {
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
    
    this.insertNode(node)
    this.addEdge({ fromId: actionId, toId: id, type: EdgeType.HAS_INPUT })
    return node
  }

  addRenderedElement(
    endpointId: string | undefined,
    data: Partial<RenderedElementNode['properties']>,
  ): RenderedElementNode {
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
    this.insertNode(node)
    if (endpointId) {
      this.addEdge({ fromId: endpointId, toId: id, type: EdgeType.RENDERED_ON })
    }
    return node
  }

  addCouncilDebate(
    data: Partial<CouncilDebateNode['properties']> & { goal: string },
  ): CouncilDebateNode {
    const id = `council-debate:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const node: CouncilDebateNode = {
      id,
      type: NodeType.COUNCIL_DEBATE,
      label: `Council debate r${data.round ?? 0}: ${data.goal}`,
      properties: {
        goal: data.goal,
        round: data.round ?? 0,
        members: data.members ?? [],
        summary: data.summary ?? '',
        proposedTasks: data.proposedTasks ?? 0,
        newEvidence: data.newEvidence ?? 0,
        complete: data.complete ?? false,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.insertNode(node)
    return node
  }

  addTest(actionId: string, testData: Partial<{ testType: string; status: string; endpoint: string; technique: string; payload: string; tags: string[]; expectedResult: string; actualResult: string }>): TestNode {
    const id = `test:${actionId}:${testData.testType || 'unknown'}:${Date.now()}`
    const node: TestNode = {
      id,
      type: NodeType.TEST,
      label: `Test: ${testData.testType}`,
      properties: testData as TestNode['properties'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    this.insertNode(node)
    this.addEdge({ fromId: actionId, toId: id, type: EdgeType.HAS_TEST })
    return node
  }

  addFinding(data: Partial<FindingNode['properties']>): FindingNode {
    const id = `finding:${data.endpoint || 'unknown'}:${data.technique || 'unknown'}:${Date.now()}`
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
        lifecycleStatus: 'candidate',
        evidenceLevel: 'L1',
        findingId: `finding:${data.endpoint || 'unknown'}:${data.technique || 'unknown'}`,
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    this.insertNode(node)
    return node
  }

  addExploitProof(data: Partial<ExploitProofNode['properties']>): ExploitProofNode {
    const id = `exploitproof:${data.findingId || 'unknown'}:${Date.now()}`
    const node: ExploitProofNode = {
      id,
      type: NodeType.EXPLOIT_PROOF,
      label: `ExploitProof: ${data.title || data.findingId || 'unknown'}`,
      properties: {
        findingId: '',
        title: '',
        method: 'GET',
        url: '',
        reproSteps: [],
        replayable: true,
        status: 'proposed',
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.insertNode(node)
    return node
  }

  addThreatModel(data: Partial<ThreatModelNode['properties']>): ThreatModelNode {
    const id = `threatmodel:${data.findingId || 'unknown'}:${Date.now()}`
    const node: ThreatModelNode = {
      id,
      type: NodeType.THREAT_MODEL,
      label: `ThreatModel: ${data.findingId || 'unknown'}`,
      properties: {
        findingId: '',
        assetsAtRisk: [],
        trustBoundary: '',
        ...data,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.insertNode(node)
    return node
  }

  addAuthFlow(data: Partial<AuthFlowNode['properties']>): AuthFlowNode {
    const id = `authflow:${data.flowType || 'login'}:${Date.now()}`
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
    
    this.insertNode(node)
    return node
  }

  addRBACRole(data: Partial<RBACRoleNode['properties']>): RBACRoleNode {
    const id = `rbac:${data.roleName || 'unknown'}`
    const existing = this.getNode(id)
    
    if (existing) {
      const updatedNode = {
        ...existing,
        properties: { ...existing.properties, ...data },
        updatedAt: Date.now()
      }
      this.updateNode(updatedNode)
      return updatedNode as RBACRoleNode
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
    
    this.insertNode(node)
    return node
  }

  addAttack(data: Partial<AttackNode['properties']>): AttackNode {
    const id = `attack:${data.technique || 'unknown'}:${Date.now()}`
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
    
    this.insertNode(node)
    return node
  }

  addOutcome(data: { findingId: string; techniqueId: string; accepted?: boolean; fixed?: boolean; retestHeld?: boolean; severityAdjusted?: string; note?: string; targetOrigin?: string; timestamp?: string }): OutcomeFeedbackNode {
    const id = `outcome:${data.findingId}`
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
     this.upsertNode(node)
     return node
   }

  /**
   * Non-destructive page merge: reads existing page by url, merges only fields
   * that are absent or empty. Capture modules use this to avoid overwriting
   * richer data (title, contentLength, contentType) that was discovered earlier.
   */
  mergePage(url: string, data?: Partial<PageNode['properties']>): PageNode {
    const id = `page:${url}`
    const existing = this.getNode(id)

    if (!existing) {
      return this.upsertPage(url, data)
    }

    const props = existing.properties as PageNode['properties']
    const newData = data ?? {}
    const merged: Record<string, unknown> = {}

    if (newData.title && !props.title) merged.title = newData.title
    if (newData.contentType && !props.contentType) merged.contentType = newData.contentType
    if (newData.contentLength && (!props.contentLength || props.contentLength === 0)) merged.contentLength = newData.contentLength
    if (newData.sessionId && !props.sessionId) merged.sessionId = newData.sessionId
    if (newData.timestamp && !props.timestamp) merged.timestamp = newData.timestamp

    const existingTags = props.tags ?? []
    const newTags = newData.tags ?? []
    const mergedTags = [...new Set([...existingTags, ...newTags])]
    if (mergedTags.length > existingTags.length) merged.tags = mergedTags

    if (Object.keys(merged).length > 0) {
      this.executeWithTransaction(async () => {
        await this.updateNode({
          id,
          type: NodeType.PAGE,
          label: existing.label,
          properties: {
            ...props,
            ...merged,
          },
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        })
      })
    }

    return existing as PageNode
  }

  chainFindings(fromId: string, toId: string): void {
    this.addEdge({ fromId, toId, type: EdgeType.CHAINED_FROM })
  }

  /**
   * Execute a database operation within the current transaction if one is active.
   * If no transaction is active, executes directly.
   */
  private async executeWithTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.currentTransaction !== null) {
      // Use SAVEPOINT within the transaction
      await this.db.execute(`SAVEPOINT libsql_tx_${this.currentTransaction}_ops`)
      try {
        const result = await fn()
        // Keep transaction open, don't release SAVEPOINT
        return result
      } catch (error) {
        // Rollback to the SAVEPOINT on error
        await this.db.execute(`ROLLBACK TO SAVEPOINT libsql_tx_${this.currentTransaction}_ops`)
        throw error
      }
    } else {
      // No transaction active, execute directly
      return await fn()
    }
  }

  private insertNode(node: GraphNodeData): void {
    this.executeWithTransaction(async () => {
      await this.db.execute(`
        INSERT INTO nodes (id, type, label, properties, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        node.id,
        node.type,
        node.label,
        JSON.stringify(node.properties),
        node.createdAt,
        node.updatedAt
      ])
    })
  }

  upsertNode(node: AnyNodeData): AnyNodeData {
    const existing = this.getNode(node.id)
    if (existing) {
      const updated = {
        ...existing,
        ...node,
        properties: { ...existing.properties, ...node.properties },
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      } as AnyNodeData
      this.updateNode(updated)
      return updated
    }

    const created = {
      ...node,
      createdAt: node.createdAt || Date.now(),
      updatedAt: node.updatedAt || Date.now(),
    } as AnyNodeData
    this.insertNode(created)
    return created
  }

  updateNode(node: GraphNodeData): void {
    this.executeWithTransaction(async () => {
      await this.db.execute(`
        UPDATE nodes
        SET type = ?, label = ?, properties = ?, updated_at = ?
        WHERE id = ?
      `, [
        node.type,
        node.label,
        JSON.stringify(node.properties),
        node.updatedAt,
        node.id
      ])
    })
  }

  getNode(id: string): AnyNodeData | undefined {
    const result = this.db.execute(`
      SELECT id, type, label, properties, created_at, updated_at
      FROM nodes
      WHERE id = ?
    `, [id]) as unknown as { rows: Array<{ id: string; type: string; label: string; properties: string; created_at: number; updated_at: number }> }

    if (result.rows.length === 0) return undefined

    const row = result.rows[0]
    return {
      id: row.id,
      type: row.type as NodeType,
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } as AnyNodeData
  }

  deleteNode(id: string): boolean {
    const existing = this.getNode(id)
    if (!existing) return false
    this.executeWithTransaction(async () => {
      await this.db.execute('DELETE FROM edges WHERE from_id = ? OR to_id = ?', [id, id])
      await this.db.execute('DELETE FROM nodes WHERE id = ?', [id])
    })
    return true
  }

  addEdge(edgeData: { fromId: string; toId: string; type: EdgeType; properties?: Record<string, unknown> }): GraphEdgeData {
    const id = `edge:${edgeData.fromId}:${edgeData.toId}:${edgeData.type}`

    // Check if edge already exists
    const existing = this.getNode(id)

    if (existing) {
      return existing as unknown as GraphEdgeData
    }

    const edge: GraphEdgeData = {
      id,
      fromId: edgeData.fromId,
      toId: edgeData.toId,
      type: edgeData.type,
      properties: edgeData.properties ?? {},
      createdAt: Date.now(),
    }

    this.executeWithTransaction(async () => {
      await this.db.execute(`
        INSERT INTO edges (id, from_id, to_id, type, properties, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        edge.id,
        edge.fromId,
        edge.toId,
        edge.type,
        JSON.stringify(edge.properties),
        edge.createdAt
      ])
    })

    return edge
  }

  queryEdges(filters?: { fromId?: string; toId?: string; type?: EdgeType }): GraphEdgeData[] {
    let query = 'SELECT id, from_id, to_id, type, properties, created_at FROM edges'
    const conditions: string[] = []
    const params: any[] = []

    if (filters?.fromId) {
      conditions.push('from_id = ?')
      params.push(filters.fromId)
    }
    if (filters?.toId) {
      conditions.push('to_id = ?')
      params.push(filters.toId)
    }
    if (filters?.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    const result = this.db.execute(query, params) as unknown as { rows: Array<{ id: string; from_id: string; to_id: string; type: string; properties: string; created_at: number }> }
    return result.rows.map((row: { id: string; from_id: string; to_id: string; type: string; properties: string; created_at: number }) => ({
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type as EdgeType,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at
    })) as GraphEdgeData[]
  }

  getAllEdges(): GraphEdgeData[] {
    return this.queryEdges()
  }

  queryNodes(type?: NodeType, filters?: Record<string, unknown>): AnyNodeData[] {
    let query = 'SELECT id, type, label, properties, created_at, updated_at FROM nodes'
    const params: any[] = []

    if (type) {
      query += ' WHERE type = ?'
      params.push(type)
    }

    const result = this.db.execute(query, params) as unknown as { rows: Array<{ id: string; type: string; label: string; properties: string; created_at: number; updated_at: number }> }
    
    return result.rows.map((row: { id: string; type: string; label: string; properties: string; created_at: number; updated_at: number }) => ({
      id: row.id,
      type: row.type as NodeType,
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })) as AnyNodeData[]
  }

  getTestCoverage(endpointId: string): TestNode[] {
    return this.queryNodes(NodeType.TEST).filter(t => 
      (t.properties as Record<string, unknown>).endpoint === endpointId
    ) as TestNode[]
  }

  getUntestedActions(): ActionNode[] {
    const actions = this.queryNodes(NodeType.ACTION) as ActionNode[]
    const edgeResult = this.db.execute(`
      SELECT from_id FROM edges WHERE type = ?
    `, [EdgeType.HAS_TEST]) as unknown as { rows: Array<{ from_id: string }> }
    const testedActionIds = new Set(edgeResult.rows.map((row: { from_id: string }) => row.from_id))

    return actions.filter(a => !testedActionIds.has(a.id))
  }

  getAuthFlows(): AuthFlowNode[] {
    return this.queryNodes(NodeType.AUTH_FLOW) as AuthFlowNode[]
  }

  getRBACMatrix(): { role: string; endpoints: string[] }[] {
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
    const path: AnyNodeData[] = []
    const node = this.getNode(findingId)
    if (!node) return path

    path.push(node)
    const visited = new Set<string>()
    const queue = [findingId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const incoming = (this.db.execute(`
        SELECT from_id FROM edges WHERE to_id = ? AND type = ?
      `, [currentId, EdgeType.CHAINED_FROM]) as unknown as { rows: Array<{ from_id: string }> }).rows

      for (const row of incoming) {
        const parent = this.getNode(row.from_id)
        if (parent && !visited.has(parent.id)) {
          path.unshift(parent)
          queue.push(parent.id)
        }
      }
    }

    return path
  }

  async save(): Promise<void> {
    // LibSQL automatically persists data, so no explicit save needed
    console.log(`[libsql] Graph data saved to ${this.dbPath}`)
  }

  async load(): Promise<void> {
    // Data is already loaded in memory from the database
    console.log(`[libsql] Graph data loaded from ${this.dbPath}`)
  }

  async close(): Promise<void> {
    // Close the database connection
    await this.db.close()
  }

  exportToJson(): SerializedGraph {
    const nodes = this.queryNodes()
    const edgesResult = this.db.execute('SELECT * FROM edges') as unknown as { rows: Array<{ id: string; from_id: string; to_id: string; type: string; properties: string; created_at: number }> }
    const edges = edgesResult.rows.map((row: { id: string; from_id: string; to_id: string; type: string; properties: string; created_at: number }) => ({
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type as EdgeType,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at
    }))

    return { nodes, edges }
  }

  importFromJson(data: SerializedGraph): void {
    // Clear existing data - transactional
    this.executeWithTransaction(async () => {
      await this.db.execute('DELETE FROM edges')
      await this.db.execute('DELETE FROM nodes')
    })

    // Import nodes - transactional
    for (const node of data.nodes) {
      this.insertNode(node)
    }

    // Import edges - transactional
    for (const edge of data.edges) {
      this.addEdge({
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type
      })
    }
  }
}
