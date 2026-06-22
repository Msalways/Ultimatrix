import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
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
  AnyNodeData,
} from './schema'

interface SerializedGraph {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

interface LibSQLGraphStore {
  initializeDatabase(): Promise<void>
  upsertPage(url: string, data?: Partial<PageNode['properties']>): PageNode
  upsertAction(url: string, data?: Partial<ActionNode['properties']>): ActionNode
  upsertInput(url: string, data?: Partial<InputNode['properties']>): InputNode
  addAuthFlow(data: AuthFlowNode['properties']): AuthFlowNode
  addRBACRole(data: RBACRoleNode['properties']): RBACRoleNode
  addAttack(data: AttackNode['properties']): AttackNode
  addTest(data: TestNode['properties']): TestNode
  upsertNode(node: AnyNodeData): AnyNodeData
  updateNode(node: AnyNodeData): void
  getNode(id: string): AnyNodeData | undefined
  deleteNode(id: string): boolean
  queryNodes(filters?: { type?: NodeType; label?: string; properties?: Record<string, unknown> }): AnyNodeData[]
  addEdge(edge: GraphEdgeData): GraphEdgeData
  queryEdges(filters?: { fromId?: string; toId?: string; type?: EdgeType }): GraphEdgeData[]
  save(): Promise<void>
  load(): Promise<void>
  close(): Promise<void>
  exportToJson(): unknown
  importFromJson(data: unknown): void
}

export class GraphStore {
  private nodes: Map<string, GraphNodeData> = new Map()
  private edges: GraphEdgeData[] = []
  private readonly savePath: string
  private useLibSQL: boolean
  private libSQLStore?: LibSQLGraphStore

  constructor(savePath?: string, useLibSQL: boolean = false) {
    this.savePath = savePath || resolve('output', 'graph.json')
    this.useLibSQL = useLibSQL
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

  addFinding(data: Partial<FindingNode['properties']>): FindingNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addFinding(data)
    }

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
    this.nodes.set(id, node)
    return node
  }

  addAuthFlow(data: Partial<AuthFlowNode['properties']>): AuthFlowNode {
    if (this.useLibSQL && this.libSQLStore) {
      return this.libSQLStore.addAuthFlow(data)
    }

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
    this.nodes.set(id, node)
    return node
  }

  chainFindings(fromId: string, toId: string): void {
    if (this.useLibSQL && this.libSQLStore) {
      this.libSQLStore.chainFindings(fromId, toId)
      return
    }

    this.addEdge({ fromId, toId, type: EdgeType.CHAINED_FROM })
  }

  private addEdge(edgeData: { fromId: string; toId: string; type: EdgeType }): GraphEdgeData {
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
      properties: {},
      createdAt: Date.now(),
    }
    this.edges.push(edge)
    return edge
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

    return this.queryNodes(NodeType.TEST).filter(t => 
      (t.properties as Record<string, unknown>).endpoint === endpointId
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

    const dir = resolve(targetPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    const data: SerializedGraph = {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    }
    await writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8')
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
    } catch {
      console.warn(`[graph] Corrupt or invalid graph.json at ${targetPath} — starting fresh`)
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

  isUsingLibSQL(): boolean {
    return this.useLibSQL
  }
}

let _globalGraphStore: GraphStore | null = null

export function getGlobalGraphStore(): GraphStore {
  if (!_globalGraphStore) {
    // Default to JSON for backward compatibility
    _globalGraphStore = new GraphStore()
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