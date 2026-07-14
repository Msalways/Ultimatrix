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
  FindingNode,
  AuthFlowNode,
  RBACRoleNode,
  AttackNode,
  TestNode,
  OutcomeFeedbackNode,
  RenderedElementNode,
  CouncilDebateNode,
  AnyNodeData,
} from './schema'

interface SerializedGraph {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

export class LibSQLGraphStore {
  private db: ReturnType<typeof createClient>
  private readonly dbPath: string

  constructor(dbPath?: string) {
    this.dbPath = dbPath || resolve('output', 'graph.db')
    this.db = createClient({
      url: `file:${this.dbPath}`
    })
    
    this.initializeDatabase()
  }

  private async initializeDatabase(): Promise<void> {
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
      const updatedNode = {
        ...existing,
        properties: { ...existing.properties, ...data },
        updatedAt: Date.now()
      }
      this.updateNode(updatedNode)
      return updatedNode as PageNode
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
      properties: testData,
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

  chainFindings(fromId: string, toId: string): void {
    this.addEdge({ fromId, toId, type: EdgeType.CHAINED_FROM })
  }

  private insertNode(node: GraphNodeData): void {
    this.db.execute(`
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
    this.db.execute(`
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
  }

  getNode(id: string): AnyNodeData | undefined {
    const result = this.db.execute(`
      SELECT id, type, label, properties, created_at, updated_at
      FROM nodes
      WHERE id = ?
    `, [id])

    if (result.rows.length === 0) return undefined

    const row = result.rows[0]
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } as AnyNodeData
  }

  deleteNode(id: string): boolean {
    const existing = this.getNode(id)
    if (!existing) return false
    this.db.execute('DELETE FROM edges WHERE from_id = ? OR to_id = ?', [id, id])
    this.db.execute('DELETE FROM nodes WHERE id = ?', [id])
    return true
  }

  addEdge(edgeData: { fromId: string; toId: string; type: EdgeType; properties?: Record<string, unknown> }): GraphEdgeData {
    const id = `edge:${edgeData.fromId}:${edgeData.toId}:${edgeData.type}`
    
    // Check if edge already exists
    const existing = this.db.execute(`
      SELECT id FROM edges WHERE id = ?
    `, [id])

    if (existing.rows.length > 0) {
      return existing.rows[0] as GraphEdgeData
    }

    const edge: GraphEdgeData = {
      id,
      fromId: edgeData.fromId,
      toId: edgeData.toId,
      type: edgeData.type,
      properties: edgeData.properties ?? {},
      createdAt: Date.now(),
    }

    this.db.execute(`
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

    return edge
  }

  queryNodes(type?: NodeType, filters?: Record<string, unknown>): AnyNodeData[] {
    let query = 'SELECT id, type, label, properties, created_at, updated_at FROM nodes'
    const params: any[] = []

    if (type) {
      query += ' WHERE type = ?'
      params.push(type)
    }

    const result = this.db.execute(query, params)
    
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  getTestCoverage(endpointId: string): TestNode[] {
    return this.queryNodes(NodeType.TEST).filter(t => 
      (t.properties as Record<string, unknown>).endpoint === endpointId
    ) as TestNode[]
  }

  getUntestedActions(): ActionNode[] {
    const actions = this.queryNodes(NodeType.ACTION) as ActionNode[]
    const testedActionIds = new Set(
      this.db.execute(`
        SELECT from_id FROM edges WHERE type = ?
      `, [EdgeType.HAS_TEST]).rows.map(row => row.from_id)
    )
    
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

      const incoming = this.db.execute(`
        SELECT from_id FROM edges WHERE to_id = ? AND type = ?
      `, [currentId, EdgeType.CHAINED_FROM]).rows

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
    const edges = this.db.execute('SELECT * FROM edges').rows.map(row => ({
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at
    }))

    return { nodes, edges }
  }

  importFromJson(data: SerializedGraph): void {
    // Clear existing data
    this.db.execute('DELETE FROM edges')
    this.db.execute('DELETE FROM nodes')

    // Import nodes
    for (const node of data.nodes) {
      this.insertNode(node)
    }

    // Import edges
    for (const edge of data.edges) {
      this.addEdge({
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type
      })
    }
  }
}
