import * as fs from 'fs';
import * as path from 'path';
import type {
  GraphNode, GraphEdge, GraphSnapshot,
  GraphQueryFilter, GraphQueryResult, FlowTrace,
  GraphObservation, AttackResult, GraphParam,
} from './types';

export class GraphStore {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private idCounter = 0;
  private target = '';
  private filePath = '';

  loadFromFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    this.filePath = filePath;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const snap: GraphSnapshot = JSON.parse(raw);
      this.nodes.clear();
      for (const n of snap.nodes) this.nodes.set(n.id, n);
      this.edges = snap.edges;
      this.target = snap.metadata.target;
      this.idCounter = snap.nodes.length;
    } catch { /* corrupt file — start fresh */ }
  }

  saveToFile(filePath: string): void {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const snap: GraphSnapshot = {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      metadata: {
        target: this.target,
        createdAt: Date.now(),
        nodeCount: this.nodes.size,
        edgeCount: this.edges.length,
      },
    };
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, filePath);
  }

  setTarget(target: string): void { this.target = target; }
  getTarget(): string { return this.target; }

  generateId(): string {
    this.idCounter += 1;
    return `wf-${this.idCounter.toString(36)}`;
  }

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) return existing;
    this.nodes.set(node.id, node);
    return node;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  findNodeByUrl(method: string, url: string): GraphNode | undefined {
    for (const n of this.nodes.values()) {
      if (n.method === method && n.url === url) return n;
    }
    return undefined;
  }

  upsertNode(method: string, url: string, update: Partial<GraphNode>): GraphNode {
    const existing = this.findNodeByUrl(method, url);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const id = this.generateId();
    const node: GraphNode = {
      id,
      url,
      method,
      params: [],
      bodyFields: [],
      requestHeaders: {},
      responseStatus: 0,
      responseHeaders: {},
      contentType: '',
      cookies: {},
      source: 'crawl',
      tags: [],
      observations: [],
      attackResults: [],
      depth: 0,
      title: '',
      ...update,
    };
    this.nodes.set(id, node);
    return node;
  }

  addEdge(edge: GraphEdge): void {
    const exists = this.edges.some(
      (e) => e.fromId === edge.fromId && e.toId === edge.toId && e.trigger === edge.trigger,
    );
    if (!exists && this.nodes.has(edge.fromId) && this.nodes.has(edge.toId)) {
      this.edges.push(edge);
    }
  }

  addObservation(nodeId: string, obs: GraphObservation): void {
    const node = this.nodes.get(nodeId);
    if (node) node.observations.push(obs);
  }

  addAttackResult(nodeId: string, result: AttackResult): void {
    const node = this.nodes.get(nodeId);
    if (node) node.attackResults.push(result);
  }

  addTag(nodeId: string, tag: string): void {
    const node = this.nodes.get(nodeId);
    if (node && !node.tags.includes(tag)) node.tags.push(tag);
  }

  getChildEdges(nodeId: string): GraphEdge[] {
    return this.edges.filter((e) => e.fromId === nodeId);
  }

  getParentEdges(nodeId: string): GraphEdge[] {
    return this.edges.filter((e) => e.toId === nodeId);
  }

  queryNodes(filter: GraphQueryFilter): GraphNode[] {
    let results = Array.from(this.nodes.values());
    if (filter.source) results = results.filter((n) => n.source === filter.source);
    if (filter.method) results = results.filter((n) => n.method === filter.method);
    if (filter.requiresAuth !== undefined) {
      results = results.filter((n) => n.tags.includes('auth-required') === filter.requiresAuth);
    }
    if (filter.nodeTags && filter.nodeTags.length > 0) {
      results = results.filter((n) => filter.nodeTags!.some((t) => n.tags.includes(t)));
    }
    if (filter.hasParams) results = results.filter((n) => n.params.length > 0 || n.bodyFields.length > 0);
    if (filter.sinkTypes) {
      results = results.filter((n) => {
        const ct = n.contentType.toLowerCase();
        return filter.sinkTypes!.some((st) => ct.includes(st));
      });
    }
    if (filter.maxDepth !== undefined) {
      results = results.filter((n) => n.depth <= filter.maxDepth!);
    }
    const limit = filter.limit ?? 50;
    return results.slice(0, limit);
  }

  summarize(filter?: GraphQueryFilter): GraphQueryResult {
    const matched = filter ? this.queryNodes(filter) : Array.from(this.nodes.values());
    const limit = filter?.limit ?? 50;
    const truncated = matched.length > limit;
    const sliced = matched.slice(0, limit);
    return {
      nodes: sliced.map((n) => ({
        id: n.id,
        url: n.url,
        method: n.method,
        paramNames: [...n.params.map((p) => p.name), ...n.bodyFields.map((p) => p.name)],
        tags: n.tags,
        contentType: n.contentType,
        responseStatus: n.responseStatus,
        source: n.source,
        depth: n.depth,
      })),
      edges: this.edges.map((e) => ({
        fromId: e.fromId,
        toId: e.toId,
        trigger: e.trigger,
        label: e.label,
      })),
      totalNodes: matched.length,
      totalEdges: this.edges.length,
      truncated,
    };
  }

  traceFlow(param: string, startNodeId: string): FlowTrace {
    const path: FlowTrace['path'] = [];
    const visited = new Set<string>();
    const queue = [startNodeId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const node = this.nodes.get(currentId);
      if (!node) continue;
      const foundIn = this.findParamInNode(param, node);
      if (foundIn) {
        path.push({
          nodeId: node.id,
          url: node.url,
          location: foundIn,
          reflected: node.responseBodyPreview?.includes(param) ?? false,
          encoded: node.responseBodyPreview?.includes(encodeURIComponent(param)) ?? false,
        });
      }
      const children = this.getChildEdges(currentId);
      for (const edge of children) queue.push(edge.toId);
    }
    const sinks = path.filter((p) => p.reflected).map((p) => `${p.nodeId}@${p.location}`);
    return { param, path, sinks };
  }

  private findParamInNode(param: string, node: GraphNode): string | null {
    for (const p of node.params) if (p.name === param) return `param:${p.in}`;
    for (const p of node.bodyFields) if (p.name === param) return `body:${p.in}`;
    if (node.responseBodyPreview?.includes(param)) return 'response-body';
    return null;
  }

  getStats(): { nodes: number; edges: number; observations: number; findings: number; sources: Record<string, number> } {
    const sources: Record<string, number> = {};
    let observations = 0;
    let findings = 0;
    for (const n of this.nodes.values()) {
      sources[n.source] = (sources[n.source] || 0) + 1;
      observations += n.observations.length;
      findings += n.attackResults.length;
    }
    return { nodes: this.nodes.size, edges: this.edges.length, observations, findings, sources };
  }

  getNodeCount(): number { return this.nodes.size; }
  getEdgeCount(): number { return this.edges.length; }
  getAllNodes(): GraphNode[] { return Array.from(this.nodes.values()); }
  getAllEdges(): GraphEdge[] { return [...this.edges]; }
}

let globalGraphStore: GraphStore | null = null;
export function getGlobalGraphStore(): GraphStore {
  if (!globalGraphStore) globalGraphStore = new GraphStore();
  return globalGraphStore;
}
export function resetGlobalGraphStore(): void { globalGraphStore = null; }
