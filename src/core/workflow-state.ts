/**
 * src/core/workflow-state.ts
 *
 * Tracks application pages as a directed graph where edges represent
 * "must complete X to reach Y". Used by the orchestrator to know what
 * to attack next, and to terminate cleanly when no actionable node
 * remains.
 *
 * Why: for a real webapp, you can't just enumerate URLs. XSS-game has
 * 6 levels, each gated by the previous one. E-commerce has cart
 * (must add to cart) → checkout (must have cart) → confirmation
 * (must submit form). A workflow-state DAG captures these dependencies
 * so the worker can chain attacks: "I solved level 1, now try level 2."
 *
 * This is a pure data structure with no I/O and no LLM. Spider emits
 * nodes, agents mark nodes as reachable, terminal, or blocked.
 */

export type NodeStatus = 'pending' | 'reachable' | 'in_progress' | 'completed' | 'blocked' | 'failed';

export interface WorkflowStateNode {
  id: string;
  url: string;
  title: string;
  type: 'page' | 'api' | 'modal' | 'redirect' | 'login' | 'gated';
  status: NodeStatus;
  authRequired: boolean;
  authVerified: boolean;
  discoveredFrom: string | null;
  discoveryMethod: 'navigation' | 'click' | 'form_submit' | 'redirect' | 'script_navigation' | 'auth_discovered';
  unlockConditions: UnlockCondition[];
  testedAt?: number;
  findings: string[];
  notes: string[];
  lastUpdated: number;
}

export type UnlockCondition =
  | { kind: 'form_submit'; formAction: string; fields: Record<string, string> }
  | { kind: 'auth'; sessionId: string }
  | { kind: 'script_eval'; predicate: string }
  | { kind: 'cookie_present'; cookieName: string }
  | { kind: 'header_present'; header: string; value: string }
  | { kind: 'response_body_contains'; substring: string; fromNode: string }
  | { kind: 'redirect_chain'; finalUrlPattern: string };

export interface WorkflowStateEdge {
  fromId: string;
  toId: string;
  trigger: 'click' | 'form_submit' | 'navigation' | 'redirect' | 'script' | 'auth_unlock';
  label: string;
}

export class WorkflowStateGraph {
  private nodes = new Map<string, WorkflowStateNode>();
  private edges: WorkflowStateEdge[] = [];
  private idCounter = 0;

  reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.idCounter = 0;
  }

  size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }

  addNode(input: Omit<WorkflowStateNode, 'status' | 'unlockConditions' | 'findings' | 'notes' | 'lastUpdated'> & Partial<Pick<WorkflowStateNode, 'status' | 'unlockConditions' | 'findings' | 'notes'>>): WorkflowStateNode {
    const existing = this.nodes.get(input.id);
    if (existing) {
      Object.assign(existing, input, { lastUpdated: Date.now() });
      return existing;
    }
    const node: WorkflowStateNode = {
      id: input.id,
      url: input.url,
      title: input.title,
      type: input.type,
      authRequired: input.authRequired,
      authVerified: input.authVerified,
      discoveredFrom: input.discoveredFrom,
      discoveryMethod: input.discoveryMethod,
      status: input.status ?? 'pending',
      unlockConditions: input.unlockConditions ?? [],
      findings: input.findings ?? [],
      notes: input.notes ?? [],
      lastUpdated: Date.now(),
    };
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(edge: WorkflowStateEdge): void {
    if (!this.nodes.has(edge.fromId) || !this.nodes.has(edge.toId)) return;
    if (this.edges.some((e) => e.fromId === edge.fromId && e.toId === edge.toId && e.trigger === edge.trigger)) return;
    this.edges.push(edge);
  }

  getNode(id: string): WorkflowStateNode | null {
    return this.nodes.get(id) ?? null;
  }

  getNodes(): WorkflowStateNode[] {
    return Array.from(this.nodes.values());
  }

  getEdges(): WorkflowStateEdge[] {
    return [...this.edges];
  }

  markReachable(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (node.status === 'pending' || node.status === 'blocked') {
      node.status = 'reachable';
      node.lastUpdated = Date.now();
    }
  }

  markInProgress(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'in_progress';
    node.lastUpdated = Date.now();
  }

  markCompleted(id: string, findingIds: string[] = []): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'completed';
    node.testedAt = Date.now();
    node.findings.push(...findingIds);
    node.lastUpdated = Date.now();
    this.unlockChildren(id);
  }

  markFailed(id: string, reason: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'failed';
    node.testedAt = Date.now();
    node.notes.push(`failed: ${reason}`);
    node.lastUpdated = Date.now();
  }

  markBlocked(id: string, reason: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'blocked';
    node.notes.push(`blocked: ${reason}`);
    node.lastUpdated = Date.now();
  }

  addFinding(id: string, findingId: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.findings.push(findingId);
    node.lastUpdated = Date.now();
  }

  addNote(id: string, note: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.notes.push(note);
    node.lastUpdated = Date.now();
  }

  /**
   * Find all nodes whose unlock conditions are now satisfiable and mark them
   * as 'reachable'. Used when a parent node is completed, or when an auth
   * session is created, etc.
   */
  refreshReachable(): string[] {
    const newlyReachable: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending' && node.status !== 'blocked') continue;
      if (this.conditionsSatisfied(node)) {
        node.status = 'reachable';
        node.lastUpdated = Date.now();
        newlyReachable.push(node.id);
      }
    }
    return newlyReachable;
  }

  /**
   * Returns nodes that the orchestrator should attack next: 'reachable' nodes
   * that aren't already in progress or completed. Optionally filters by
   * type or by auth requirement.
   */
  nextActionable(filter?: { type?: WorkflowStateNode['type']; requireAuth?: boolean }): WorkflowStateNode[] {
    const out: WorkflowStateNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'reachable') continue;
      if (filter?.type && node.type !== filter.type) continue;
      if (filter?.requireAuth === true && !node.authRequired) continue;
      if (filter?.requireAuth === false && node.authRequired) continue;
      out.push(node);
    }
    return out;
  }

  /**
   * Are there any reachable, untested nodes?
   */
  hasActionable(): boolean {
    for (const n of this.nodes.values()) {
      if (n.status === 'reachable') return true;
    }
    return false;
  }

  /**
   * Are all nodes either completed, failed, blocked, or pending (waiting on
   * an unlock condition that we don't know how to satisfy)?
   */
  isExhausted(): boolean {
    if (this.nodes.size === 0) return true;
    for (const node of this.nodes.values()) {
      if (node.status === 'reachable' || node.status === 'in_progress') return false;
    }
    return true;
  }

  /**
   * Build a sibling-graph: pending/blocked nodes that share an unlock
   * condition with the given node. Used by the orchestrator to detect
   * "I should test these in parallel" patterns. A node that requires
   * the same auth session as `id` (e.g. both need admin login) is a
   * sibling because once you log in as admin, both become testable.
   */
  siblings(id: string): WorkflowStateNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    const out: WorkflowStateNode[] = [];
    for (const candidate of this.nodes.values()) {
      if (candidate.id === id) continue;
      if (candidate.status !== 'pending' && candidate.status !== 'blocked') continue;
      if (this.shareUnlockCondition(node, candidate)) out.push(candidate);
    }
    return out;
  }

  toJSON(): { nodes: WorkflowStateNode[]; edges: WorkflowStateEdge[] } {
    return { nodes: this.getNodes(), edges: this.getEdges() };
  }

  fromJSON(data: { nodes?: WorkflowStateNode[]; edges?: WorkflowStateEdge[] }): void {
    this.reset();
    for (const n of data.nodes ?? []) this.nodes.set(n.id, { ...n });
    this.edges = data.edges ?? [];
  }

  generateId(prefix = 'n'): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter.toString(36)}`;
  }

  private conditionsSatisfied(node: WorkflowStateNode): boolean {
    if (node.unlockConditions.length === 0) {
      const inEdges = this.edges.filter((e) => e.toId === node.id);
      if (inEdges.length === 0) return true;
      return inEdges.every((e) => this.nodes.get(e.fromId)?.status === 'completed');
    }
    return node.unlockConditions.every((c) => this.conditionMet(c));
  }

  private conditionMet(cond: UnlockCondition): boolean {
    switch (cond.kind) {
      case 'form_submit': return false;
      case 'auth': return false;
      case 'script_eval': return false;
      case 'cookie_present': return false;
      case 'header_present': return false;
      case 'response_body_contains': {
        const from = this.nodes.get(cond.fromNode);
        if (!from) return false;
        return from.notes.some((n) => n.includes(cond.substring));
      }
      case 'redirect_chain': return false;
    }
  }

  private shareUnlockCondition(a: WorkflowStateNode, b: WorkflowStateNode): boolean {
    for (const ca of a.unlockConditions) {
      for (const cb of b.unlockConditions) {
        if (ca.kind === cb.kind) {
          if (ca.kind === 'auth' && cb.kind === 'auth' && ca.sessionId === cb.sessionId) return true;
          if (ca.kind === 'form_submit' && cb.kind === 'form_submit' && ca.formAction === cb.formAction) return true;
        }
      }
    }
    return false;
  }

  private unlockChildren(parentId: string): void {
    const children = this.edges.filter((e) => e.fromId === parentId);
    for (const e of children) {
      const child = this.nodes.get(e.toId);
      if (!child) continue;
      if (child.status === 'pending' || child.status === 'blocked') {
        if (this.conditionsSatisfied(child)) {
          child.status = 'reachable';
          child.lastUpdated = Date.now();
        }
      }
    }
  }
}
