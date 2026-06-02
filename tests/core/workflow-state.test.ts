/**
 * tests/core/workflow-state.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowStateGraph } from '../../src/core/workflow-state';

describe('WorkflowStateGraph', () => {
  let g: WorkflowStateGraph;

  beforeEach(() => {
    g = new WorkflowStateGraph();
  });

  it('starts empty and exhausted', () => {
    expect(g.size()).toEqual({ nodes: 0, edges: 0 });
    expect(g.isExhausted()).toBe(true);
    expect(g.hasActionable()).toBe(false);
  });

  it('adds a node and tracks it', () => {
    const node = g.addNode({
      id: 'n1',
      url: 'https://x.com',
      title: 'Home',
      type: 'page',
      authRequired: false,
      authVerified: false,
      discoveredFrom: null,
      discoveryMethod: 'navigation',
    });
    expect(node.status).toBe('pending');
    expect(g.getNode('n1')).not.toBeNull();
    expect(g.size().nodes).toBe(1);
  });

  it('does not duplicate nodes with the same id', () => {
    g.addNode({ id: 'n1', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({ id: 'n1', url: 'a-v2', title: 'A v2', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    expect(g.size().nodes).toBe(1);
    expect(g.getNode('n1')?.url).toBe('a-v2');
  });

  it('markReachable moves pending -> reachable', () => {
    g.addNode({ id: 'n1', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markReachable('n1');
    expect(g.getNode('n1')?.status).toBe('reachable');
  });

  it('nextActionable returns only reachable nodes', () => {
    g.addNode({ id: 'pending', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({ id: 'ready', url: 'b', title: 'B', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markReachable('ready');
    const next = g.nextActionable();
    expect(next.map((n) => n.id)).toEqual(['ready']);
  });

  it('nextActionable filters by type and auth requirement', () => {
    g.addNode({ id: 'p1', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({ id: 'a1', url: 'b', title: 'B', type: 'api', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markReachable('p1');
    g.markReachable('a1');
    expect(g.nextActionable({ type: 'api' }).map((n) => n.id)).toEqual(['a1']);
    expect(g.nextActionable({ requireAuth: true }).map((n) => n.id)).toEqual(['a1']);
    expect(g.nextActionable({ requireAuth: false }).map((n) => n.id)).toEqual(['p1']);
  });

  it('unlocks children when parent completes', () => {
    g.addNode({ id: 'p', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({ id: 'c', url: 'b', title: 'B', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addEdge({ fromId: 'p', toId: 'c', trigger: 'click', label: 'go' });
    g.markReachable('p');
    expect(g.getNode('c')?.status).toBe('pending');
    g.markCompleted('p');
    expect(g.getNode('c')?.status).toBe('reachable');
  });

  it('does not unlock children if they have other unmet conditions', () => {
    g.addNode({ id: 'p', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({
      id: 'c', url: 'b', title: 'B', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'cookie_present', cookieName: 'session' }],
    });
    g.addEdge({ fromId: 'p', toId: 'c', trigger: 'click', label: 'go' });
    g.markReachable('p');
    g.markCompleted('p');
    expect(g.getNode('c')?.status).toBe('pending');
  });

  it('unlocks child when unlock conditions are satisfied (response_body_contains)', () => {
    g.addNode({ id: 'p', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({
      id: 'c', url: 'b', title: 'B', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'response_body_contains', substring: 'level-passed', fromNode: 'p' }],
    });
    g.addEdge({ fromId: 'p', toId: 'c', trigger: 'click', label: 'go' });
    g.markReachable('p');
    g.markCompleted('p');
    expect(g.getNode('c')?.status).toBe('pending');
    g.addNote('p', 'level-passed indicator visible');
    const newly = g.refreshReachable();
    expect(newly).toContain('c');
    expect(g.getNode('c')?.status).toBe('reachable');
  });

  it('isExhausted returns true when nothing is reachable or in_progress', () => {
    g.addNode({ id: 'p', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markReachable('p');
    g.markCompleted('p');
    expect(g.isExhausted()).toBe(true);
  });

  it('hasActionable returns true while a reachable node exists', () => {
    g.addNode({ id: 'p', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markReachable('p');
    expect(g.hasActionable()).toBe(true);
    g.markCompleted('p');
    expect(g.hasActionable()).toBe(false);
  });

  it('find siblings that share an unlock condition with the source node', () => {
    g.addNode({
      id: 'a', url: 'a', title: 'A', type: 'page', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'auth', sessionId: 'admin' }],
    });
    g.addNode({
      id: 'b', url: 'b', title: 'B', type: 'page', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'auth', sessionId: 'admin' }],
    });
    g.addNode({
      id: 'c', url: 'c', title: 'C', type: 'page', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'auth', sessionId: 'admin' }],
    });
    g.addNode({
      id: 'd', url: 'd', title: 'D', type: 'page', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation',
      unlockConditions: [{ kind: 'auth', sessionId: 'mechanic' }],
    });
    const siblings = g.siblings('a');
    expect(siblings.map((s) => s.id).sort()).toEqual(['b', 'c']);
  });

  it('addEdge ignores edges to/from non-existent nodes', () => {
    g.addNode({ id: 'a', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addEdge({ fromId: 'a', toId: 'ghost', trigger: 'click', label: 'go' });
    g.addEdge({ fromId: 'ghost', toId: 'a', trigger: 'click', label: 'go' });
    expect(g.size().edges).toBe(0);
  });

  it('toJSON / fromJSON roundtrip', () => {
    g.addNode({ id: 'a', url: 'https://x.com/a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.addNode({ id: 'b', url: 'https://x.com/b', title: 'B', type: 'api', authRequired: true, authVerified: false, discoveredFrom: 'a', discoveryMethod: 'navigation' });
    g.addEdge({ fromId: 'a', toId: 'b', trigger: 'click', label: 'go' });
    g.markReachable('a');
    const json = g.toJSON();
    const g2 = new WorkflowStateGraph();
    g2.fromJSON(json);
    expect(g2.size()).toEqual({ nodes: 2, edges: 1 });
    expect(g2.getNode('a')?.status).toBe('reachable');
  });

  it('addFinding pushes to node findings and updates lastUpdated', async () => {
    g.addNode({ id: 'a', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    const before = g.getNode('a')!.lastUpdated;
    await new Promise((r) => setTimeout(r, 5));
    g.addFinding('a', 'finding-1');
    expect(g.getNode('a')!.findings).toEqual(['finding-1']);
    expect(g.getNode('a')!.lastUpdated).toBeGreaterThan(before);
  });

  it('markFailed and markBlocked append notes', () => {
    g.addNode({ id: 'a', url: 'a', title: 'A', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markFailed('a', 'timeout');
    expect(g.getNode('a')?.status).toBe('failed');
    expect(g.getNode('a')?.notes[0]).toContain('timeout');

    g.addNode({ id: 'b', url: 'b', title: 'B', type: 'page', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    g.markBlocked('b', 'requires captcha');
    expect(g.getNode('b')?.status).toBe('blocked');
    expect(g.getNode('b')?.notes[0]).toContain('captcha');
  });
});
