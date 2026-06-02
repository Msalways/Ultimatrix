/**
 * tests/pipeline/autonomous-v3.test.ts
 *
 * Tests for AutonomousV3Orchestrator with a fake worker factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutonomousV3Orchestrator, type WorkerSpawnResult } from '../../src/pipeline/autonomous-v3';
import { WorkflowStateGraph } from '../../src/core/workflow-state';
import type { SessionPool, SessionMeta } from '../../src/core/session-pool';
import type { AppModelFinding } from '../../src/core/app-model';

function makeMockPool(): SessionPool {
  return {
    list: vi.fn(() => []),
    has: vi.fn(() => true),
    getActive: vi.fn(() => null),
    getOrCreate: vi.fn(async () => makeMeta('default')),
    switchTo: vi.fn((id: string) => makeMeta(id)),
    login: vi.fn(async () => ({ ok: true, status: 200, finalUrl: '', body: '', cookiesAfter: 0 })),
    diff: vi.fn(async () => ({} as any)),
    screenshot: vi.fn(async () => ''),
    getCookies: vi.fn(async () => []),
    getPage: vi.fn(async () => ({} as any)),
    getNetworkLog: vi.fn(() => []),
    getInternalSession: vi.fn(() => null),
    close: vi.fn(async () => {}),
    closeAll: vi.fn(async () => {}),
  } as unknown as SessionPool;
}

function makeMeta(id: string): SessionMeta {
  return { id, label: id, role: 'user', createdAt: 0, lastActivityAt: 0, lastUrl: '', cookiesCount: 0, authenticated: false };
}

function makeNode(id: string, url: string, type: WorkflowStateGraph extends never ? never : any = 'api') {
  return { id, url, title: id, type, authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' as const };
}

describe('AutonomousV3Orchestrator', () => {
  let graph: WorkflowStateGraph;
  let pool: SessionPool;
  let findings: AppModelFinding[];

  beforeEach(() => {
    graph = new WorkflowStateGraph();
    pool = makeMockPool();
    findings = [];
  });

  it('terminates with "exhausted" when graph has no reachable nodes', async () => {
    const orch = new AutonomousV3Orchestrator({
      graph, pool,
      workerFactory: vi.fn(async () => makeResult(false, 0)),
    });
    const result = await orch.run();
    expect(result.terminatedBy).toBe('exhausted');
    expect(result.completedNodes).toBe(0);
  });

  it('picks a reachable node, runs the worker, marks completed', async () => {
    const n = graph.addNode(makeNode('n1', 'https://x.com/api/v1/ping'));
    graph.markReachable('n1');
    const factory = vi.fn(async () => makeResult(false, 0));
    const orch = new AutonomousV3Orchestrator({ graph, pool, workerFactory: factory });
    const result = await orch.run();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.completedNodes).toBe(1);
    expect(result.terminatedBy).toBe('exhausted');
    expect(graph.getNode('n1')?.status).toBe('completed');
  });

  it('records finding when worker reports vulnerable with high confidence', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api'));
    graph.markReachable('n1');
    const orch = new AutonomousV3Orchestrator({
      graph, pool,
      workerFactory: vi.fn(async () => makeResult(true, 0.9, [{ type: 'text', data: 'XSS', label: 'evidence', timestamp: 0 }])),
    });
    const result = await orch.run();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].endpoint).toBe('https://x.com/api');
    expect(result.findings[0].severity).toBe('high');
  });

  it('does NOT record finding when confidence < 0.5', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api'));
    graph.markReachable('n1');
    const orch = new AutonomousV3Orchestrator({
      graph, pool,
      workerFactory: vi.fn(async () => makeResult(true, 0.3)),
    });
    const result = await orch.run();
    expect(result.findings).toHaveLength(0);
  });

  it('respects max-nodes: caps total work', async () => {
    for (let i = 0; i < 4; i++) {
      graph.addNode(makeNode(`n${i}`, `https://x.com/api${i}`));
      graph.markReachable(`n${i}`);
    }
    const factory = vi.fn(async () => makeResult(false, 0));
    const orch = new AutonomousV3Orchestrator({ graph, pool, workerFactory: factory, maxNodes: 3 });
    const result = await orch.run();
    expect(result.terminatedBy).toBe('max-nodes');
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('terminates by "time" when maxRuntimeMs is exceeded', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api'));
    graph.markReachable('n1');
    graph.addNode(makeNode('n2', 'https://x.com/api2'));
    graph.markReachable('n2');
    const factory = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeResult(false, 0);
    });
    const orch = new AutonomousV3Orchestrator({ graph, pool, workerFactory: factory, maxRuntimeMs: 60 });
    const result = await orch.run();
    expect(result.terminatedBy).toBe('time');
    expect(factory.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('terminates by "abort" when shouldAbort returns true', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api'));
    graph.markReachable('n1');
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      return makeResult(false, 0);
    });
    const orch = new AutonomousV3Orchestrator({
      graph, pool, workerFactory: factory, shouldAbort: () => calls >= 1,
    });
    const result = await orch.run();
    expect(result.terminatedBy).toBe('abort');
  });

  it('terminates by "max-nodes" when maxNodes is reached', async () => {
    for (let i = 0; i < 3; i++) {
      graph.addNode(makeNode(`n${i}`, `https://x.com/api${i}`));
      graph.markReachable(`n${i}`);
    }
    const orch = new AutonomousV3Orchestrator({
      graph, pool,
      workerFactory: vi.fn(async () => makeResult(false, 0)),
      maxNodes: 2,
    });
    const result = await orch.run();
    expect(result.terminatedBy).toBe('max-nodes');
    expect(result.completedNodes).toBe(2);
  });

  it('emits onNodeUpdate for in_progress and completed', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api'));
    graph.markReachable('n1');
    const updates: Array<{ id: string; status: string }> = [];
    const orch = new AutonomousV3Orchestrator({
      graph, pool,
      workerFactory: vi.fn(async () => makeResult(false, 0)),
      onNodeUpdate: (n, status) => updates.push({ id: n.id, status }),
    });
    await orch.run();
    expect(updates).toEqual(expect.arrayContaining([
      { id: 'n1', status: 'in_progress' },
      { id: 'n1', status: 'completed' },
    ]));
  });

  it('processes parent then child after parent completes (unlock via refreshReachable)', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api1'));
    graph.addNode(makeNode('n2', 'https://x.com/api2'));
    graph.addEdge({ fromId: 'n1', toId: 'n2', trigger: 'click', label: 'go' });
    graph.markReachable('n1');
    const visitedOrder: string[] = [];
    const factory = vi.fn(async (input) => {
      visitedOrder.push(input.workflowNodeId);
      return makeResult(false, 0);
    });
    const orch = new AutonomousV3Orchestrator({ graph, pool, workerFactory: factory });
    const result = await orch.run();
    expect(visitedOrder).toEqual(['n1', 'n2']);
    expect(result.completedNodes).toBe(2);
  });

  it('runs workers in parallel when enableConcurrency: true (maxConcurrency >= 2)', async () => {
    for (let i = 0; i < 3; i++) {
      graph.addNode(makeNode(`n${i}`, `https://x.com/api${i}`));
      graph.markReachable(`n${i}`);
    }
    let concurrentPeak = 0;
    let inFlight = 0;
    const factory = vi.fn(async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 100));
      inFlight--;
      return makeResult(false, 0);
    });
    const orch = new AutonomousV3Orchestrator({
      graph, pool, workerFactory: factory, enableConcurrency: true, maxConcurrency: 3,
    });
    await orch.run();
    expect(concurrentPeak).toBeGreaterThan(1);
  });

  it('forces sequential execution when maxConcurrency: 1', async () => {
    for (let i = 0; i < 3; i++) {
      graph.addNode(makeNode(`n${i}`, `https://x.com/api${i}`));
      graph.markReachable(`n${i}`);
    }
    let concurrentPeak = 0;
    let inFlight = 0;
    const factory = vi.fn(async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return makeResult(false, 0);
    });
    const orch = new AutonomousV3Orchestrator({
      graph, pool, workerFactory: factory, enableConcurrency: true, maxConcurrency: 1,
    });
    await orch.run();
    expect(concurrentPeak).toBe(1);
  });

  it('invokes the injected strategy and passes timeoutMs/expectedSeverity to the worker', async () => {
    graph.addNode(makeNode('n1', 'https://x.com/api/v1/users'));
    graph.markReachable('n1');
    let capturedTimeout: number | undefined;
    let capturedSeverity: string | undefined;
    const factory = vi.fn(async (input) => {
      capturedTimeout = input.timeoutMs;
      capturedSeverity = input.expectedSeverity;
      return makeResult(false, 0);
    });
    const customStrategy = {
      resolve: vi.fn(async () => ({
        technique: 'xss' as const,
        method: 'GET',
        param: 'q',
        timeoutMs: 42_000,
        expectedSeverity: 'critical' as const,
      })),
    };
    const orch = new AutonomousV3Orchestrator({
      graph, pool, workerFactory: factory, strategy: customStrategy,
    });
    await orch.run();
    expect(customStrategy.resolve).toHaveBeenCalledTimes(1);
    expect(capturedTimeout).toBe(42_000);
    expect(capturedSeverity).toBe('critical');
  });

  it('halves concurrency when a worker reports rateLimited', async () => {
    for (let i = 0; i < 4; i++) {
      graph.addNode(makeNode(`n${i}`, `https://x.com/api${i}`));
      graph.markReachable(`n${i}`);
    }
    const rateLimitedResult: WorkerSpawnResult = { ...makeResult(false, 0), rateLimited: true };
    const factory = vi.fn(async () => rateLimitedResult);
    const orch = new AutonomousV3Orchestrator({
      graph, pool, workerFactory: factory, enableConcurrency: true, maxConcurrency: 8,
    });
    const result = await orch.run();
    expect(result.rateLimitEvents).toBeGreaterThan(0);
    expect(result.effectiveMaxConcurrency).toBeLessThan(8);
  });
});

function makeResult(vulnerable: boolean, confidence: number, evidence: any[] = []): WorkerSpawnResult {
  return {
    vulnerable,
    confidence,
    evidence,
    payloads: [],
    summary: vulnerable ? 'found' : 'not found',
    technique: 'xss',
    url: 'https://x.com',
    durationMs: 10,
  };
}
