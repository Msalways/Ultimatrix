/**
 * src/pipeline/autonomous-v3.ts
 *
 * Workflow-DAG-driven orchestrator. Replaces the fixed-turn / maxToolCalls
 * termination of autonomous.ts with a hybrid that respects:
 *   - workflow-state DAG exhaustion (no more reachable nodes)
 *   - per-technique retry budget (e.g. 3 attempts per (hypothesis, technique))
 *   - overall time limit (e.g. 30 minutes)
 *   - max-nodes cap
 *   - optional concurrent worker execution (bounded by maxConcurrency)
 *   - rate-limit (429) backoff: halves concurrency on each rate-limited worker
 *
 * The orchestrator is a thin loop. ALL per-node decisions (which technique
 * to try, what severity to assign, how long to wait) are injected as
 * strategy resolvers. No hardcoded technique lists, severity maps, or
 * timeout tables live in this file.
 *
 * Designed to be testable: every external dependency is injected.
 */

import type { WorkflowStateGraph, WorkflowStateNode } from '../core/workflow-state';
import type { SessionPool } from '../core/session-pool';
import type { Hypothesis, Technique } from '../core/attack-plan';
import type { AppModelFinding, FindingEvidence, AppModel } from '../core/app-model';
import type { ComposerLogEvent } from '../agents/composer';
import type { HuntConfigValues } from '../core/hunt-config';
import { getGlobalGraphStore } from '../workflow-graph/store';
import { getGlobalMcpManager } from '../mcp/client';
import { randomUUID } from 'crypto';

export interface NodeSpec {
  workflowNodeId: string;
  url: string;
  method: string;
  technique: Technique;
  param?: string;
  allParams?: Array<{ name: string; type: string; required: boolean }>;
  bodyPreview?: string;
  concreteUrl?: string;
  requiresAuth: boolean;
  timeoutMs: number;
  expectedSeverity: AppModelFinding['severity'];
}

export interface WorkerSpawnInput {
  hypothesis: Hypothesis;
  workflowNodeId: string;
  technique: Technique;
  url: string;
  method: string;
  param?: string;
  /** All discovered params (so worker can pick the right sink) */
  allParams?: Array<{ name: string; type: string; required: boolean }>;
  /** Body preview captured by spider (so LLM can see sinks) */
  bodyPreview?: string;
  /** Concrete URL with query string (e.g. /level1/frame?query=) for direct attack */
  concreteUrl?: string;
  activeSessionId: string | null;
  retryAttempt: number;
  timeoutMs: number;
  expectedSeverity: AppModelFinding['severity'];
  /**
   * Optional sink for LLM token streaming. Forwarded to the worker's
   * Composer so the web UI / CLI can show LLM output in real-time.
   */
  onLLMToken?: (label: string, chunk: string) => void;
  /**
   * Optional sink for structured Composer lifecycle events (plan-proposed,
   * primitive, triage, specialist-spawn, finding). The web UI consumes
   * these to render the live plan/primitive/finding panels.
   */
  onLog?: (event: ComposerLogEvent) => void;
  /**
   * Optional sink for low-level primitive invocations. Used by tests
   * and instrumentation; the UI consumes onLog (richer).
   */
  onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
  /**
   * Optional output dir. Used by the worker to write a per-node live
   * Playwright spec via the recordTestStep primitive. The spec is
   * named `live-${nodeId}.spec.ts` to avoid concurrent-write races
   * between parallel workers.
   */
  outDir?: string;
}

export interface WorkerSpawnResult {
  vulnerable: boolean;
  confidence: number;
  evidence: FindingEvidence[];
  payloads: string[];
  summary: string;
  technique: Technique;
  url: string;
  error?: string;
  durationMs: number;
  rateLimited?: boolean;
}

export type WorkerFactory = (input: WorkerSpawnInput) => Promise<WorkerSpawnResult>;

export interface OnFindingHandler {
  (finding: AppModelFinding, node: WorkflowStateNode): void;
}

export interface OnNodeUpdateHandler {
  (node: WorkflowStateNode, status: 'in_progress' | 'completed' | 'failed'): void;
}

export type BeforeNodeDecision = 'proceed' | 'skip' | 'abort' | Promise<'proceed' | 'skip' | 'abort'>;

export interface OnBeforeNodeHandler {
  (node: WorkflowStateNode, spec: NodeSpec | null): BeforeNodeDecision;
}

/**
 * Per-node strategy resolver. Returns the test plan for a single node.
 * ALL per-node decisions are encapsulated here so the orchestrator
 * itself contains no hardcoded technique/severity/timeout logic.
 *
 * The default implementation in `defaultNodeStrategyResolver` uses the
 * LLM-driven `selectTechniquesForEndpoint` and a heuristic timeout
 * function. Production should always pass an explicit resolver.
 */
export interface NodeStrategy {
  resolve(node: WorkflowStateNode, appModel: AppModel): Promise<NodeStrategyResolution | null>;
}

export interface NodeStrategyResolution {
  technique: Technique;
  method: string;
  param?: string;
  timeoutMs: number;
  expectedSeverity: AppModelFinding['severity'];
}

export interface AutonomousV3Options {
  graph: WorkflowStateGraph;
  pool: SessionPool;
  workerFactory: WorkerFactory;
  appModel?: AppModel;
  strategy?: NodeStrategy;
  huntConfig?: HuntConfigValues;
  skipPhases?: Set<'observe' | 'learn' | 'attack'>;
  onFinding?: OnFindingHandler;
  onNodeUpdate?: OnNodeUpdateHandler;
  onBeforeNode?: OnBeforeNodeHandler;
  perTechniqueBudget?: number;
  maxRuntimeMs?: number;
  maxNodes?: number;
  enableConcurrency?: boolean;
  maxConcurrency?: number;
  sleepBetweenNodesMs?: number;
  onLog?: (msg: string) => void;
  shouldAbort?: () => boolean;
  onLLMToken?: (label: string, chunk: string) => void;
  onComposerEvent?: (event: ComposerLogEvent) => void;
  onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
  outDir?: string;
}

export interface OrchestrationResult {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  blockedNodes: number;
  findings: AppModelFinding[];
  durationMs: number;
  terminatedBy: 'exhausted' | 'budget' | 'time' | 'abort' | 'no-active-session' | 'max-nodes';
  effectiveMaxConcurrency: number;
  rateLimitEvents: number;
}

/** Snapshot of orchestrator state for the interactive session / web UI. */
export interface OrchestratorStatus {
  phase: 'idle' | 'observe' | 'learn' | 'attack' | 'done';
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  inFlight: number;
  elapsedMs: number;
  maxRuntimeMs: number;
  retryBudgetUsed: number;
  rateLimitEvents: number;
}

export class AutonomousV3Orchestrator {
  private graph: WorkflowStateGraph;
  private pool: SessionPool;
  private workerFactory: WorkerFactory;
  private appModel?: AppModel;
  private strategy: NodeStrategy;
  private onFinding?: OnFindingHandler;
  private onNodeUpdate?: OnNodeUpdateHandler;
  private onBeforeNode?: OnBeforeNodeHandler;
  private perTechniqueBudget: number;
  private maxRuntimeMs: number;
  private maxNodes: number;
  private enableConcurrency: boolean;
  private sleepBetweenNodesMs: number;
  private shouldAbort?: () => boolean;
  private techniqueRetries: Map<string, number> = new Map();
  private maxConcurrency: number;
  private onLog?: (msg: string) => void;
  private onLLMToken?: (label: string, chunk: string) => void;
  private onComposerEvent?: (event: ComposerLogEvent) => void;
  private onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
  private outDir?: string;
  private rateLimitEvents: number = 0;
  private resolvedStrategies: Map<string, NodeStrategyResolution> = new Map();
  private strategyFailures: Map<string, number> = new Map();
  private huntConfig: HuntConfigValues;
  private skipPhases: Set<'observe' | 'learn' | 'attack'>;
  /** Phase label for status queries. Updated at each phase transition. */
  private _phase: OrchestratorStatus['phase'] = 'idle';
  /** Epoch ms when run() started. 0 before run(). */
  private _startTime: number = 0;

  constructor(opts: AutonomousV3Options) {
    this.graph = opts.graph;
    this.pool = opts.pool;
    this.workerFactory = opts.workerFactory;
    this.appModel = opts.appModel;
    this.strategy = opts.strategy ?? defaultNodeStrategy;
    this.onFinding = opts.onFinding;
    this.onNodeUpdate = opts.onNodeUpdate;
    this.onBeforeNode = opts.onBeforeNode;
    this.huntConfig = opts.huntConfig ?? {
      maxNodes: 200, techniqueBudget: 3, nodeDelayMs: 100,
      nodeTimeoutMs: 120_000, rateLimitBackoffMs: 5_000,
      maxConcurrency: 4, formWatchIntervalMs: 1500,
    };
    this.skipPhases = opts.skipPhases ?? new Set();
    this.perTechniqueBudget = opts.perTechniqueBudget ?? this.huntConfig.techniqueBudget;
    this.maxRuntimeMs = opts.maxRuntimeMs ?? 0;
    this.maxNodes = opts.maxNodes ?? this.huntConfig.maxNodes;
    this.enableConcurrency = opts.enableConcurrency ?? false;
    this.sleepBetweenNodesMs = opts.sleepBetweenNodesMs ?? this.huntConfig.nodeDelayMs;
    this.shouldAbort = opts.shouldAbort;
    this.maxConcurrency = opts.maxConcurrency ?? this.huntConfig.maxConcurrency;
    this.onLog = opts.onLog;
    this.onLLMToken = opts.onLLMToken;
    this.onComposerEvent = opts.onComposerEvent;
    this.onPrimitive = opts.onPrimitive;
    this.outDir = opts.outDir;
  }

  getEffectiveMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  getRateLimitEvents(): number {
    return this.rateLimitEvents;
  }

  getResolvedStrategy(nodeId: string): NodeStrategyResolution | undefined {
    return this.resolvedStrategies.get(nodeId);
  }

  /** Return a snapshot of current orchestrator state. Thread-safe — reads properties. */
  getStatus(): OrchestratorStatus {
    const nodes = this.graph.getNodes();
    const completedNodes = nodes.filter((n) => n.status === 'completed').length;
    const failedNodes = nodes.filter((n) => n.status === 'failed').length;
    const inFlight = nodes.filter((n) => n.status === 'in_progress').length;
    return {
      phase: this._phase,
      totalNodes: this.graph.size().nodes,
      completedNodes,
      failedNodes,
      inFlight,
      elapsedMs: this._startTime > 0 ? Date.now() - this._startTime : 0,
      maxRuntimeMs: this.maxRuntimeMs,
      retryBudgetUsed: this.techniqueRetries.size,
      rateLimitEvents: this.rateLimitEvents,
    };
  }

  private log(msg: string): void {
    if (this.onLog) this.onLog(msg);
  }

  /**
   * Phase 1 — Observe: fetch reachable URLs to determine
   * content-type, status, and basic tags. Records into GraphStore.
   * Uses HTTP fetch (not browser) — the spider already handled
   * browser exploration.
   */
  private async runObservePhase(): Promise<void> {
    const nodes = this.graph.getNodes().filter((n) => n.status === 'reachable');
    if (nodes.length === 0) { this.log('[orch:observe] no reachable nodes'); return; }

    const graphStore = getGlobalGraphStore();
    let observed = 0;
    for (const node of nodes.slice(0, this.maxNodes)) {
      const gNode = graphStore.findNodeByUrl('GET', node.url);
      if (gNode && gNode.tags.length > 0) continue;

      try {
        const resp = await fetch(node.url, {
          method: 'GET',
          signal: AbortSignal.timeout(this.huntConfig.nodeTimeoutMs),
        });
        const status = resp.status;
        const ct = resp.headers.get('content-type') ?? '';
        const text = await resp.text();
        const bodyPreview = text.slice(0, 1500);
        const tags: string[] = [];
        if (ct.includes('html')) tags.push('returns-html');
        if (ct.includes('json')) tags.push('returns-json');
        if (text.includes('<form') || text.includes('<input')) tags.push('has-forms');
        if (text.includes('name="') || text.includes('name=\'')) tags.push('has-params');
        if (status === 401 || status === 403) tags.push('auth-required');

        graphStore.upsertNode('GET', node.url, {
          contentType: ct,
          responseStatus: status,
          responseBodyPreview: bodyPreview,
          tags,
          source: 'crawl',
          depth: 0,
        });
        observed++;
      } catch (e) {
        this.log(`[orch:observe] fetch error ${node.url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.log(`[orch:observe] tagged ${observed}/${nodes.length} nodes`);
  }

  /**
   * Phase 2 — Learn: probe params on observed graph nodes with
   * benign payloads and record any reflection observations.
   * Only probes nodes already in GraphStore with params.
   */
  private async runLearnPhase(): Promise<void> {
    const graphStore = getGlobalGraphStore();
    const nodes = this.graph.getNodes().filter((n) => n.status === 'reachable');
    let probed = 0;

    for (const node of nodes.slice(0, this.maxNodes)) {
      const gNode = graphStore.findNodeByUrl('GET', node.url);
      if (!gNode) continue;
      if (gNode.observations.length > 0) continue;
      const params = [...(gNode.params || []), ...(gNode.bodyFields || [])];
      if (params.length === 0) continue;

      const probes = ['test', '<test>', '../../etc/passwd', "'"];
      for (const param of params.slice(0, 3)) {
        for (const probe of probes) {
          try {
            const sep = node.url.includes('?') ? '&' : '?';
            const probeUrl = `${node.url}${sep}${param.name}=${encodeURIComponent(probe)}`;
            const resp = await fetch(probeUrl, {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
            });
            const text = await resp.text();
            const reflected = text.includes(probe);
            graphStore.addObservation(gNode.id, {
              probe,
              location: `param:${param.name}`,
              responseDelta: reflected ? 'reflected' : 'no-change',
              inferredSurface: reflected ? 'xss' : undefined,
              responseStatus: resp.status,
              responseBodySnippet: text.slice(0, 300),
              timestamp: Date.now(),
            });
            if (reflected) {
              graphStore.addTag(gNode.id, 'reflects-input');
            }
          } catch { /* probe failed — skip */ }
        }
        probed++;
      }
    }
    this.log(`[orch:learn] probed ${probed} param(s) across graph nodes`);
  }

  async run(): Promise<OrchestrationResult> {
    this._startTime = Date.now();
    const size = this.graph.size();
    const reachable = this.graph.getNodes().filter((n) => n.status === 'reachable').length;
    this.log(`[orch] starting · graph: ${size.nodes} nodes, ${reachable} reachable, concurrency=${this.enableConcurrency ? this.maxConcurrency : 1}`);

    // Phase 1 — Observe: visit reachable nodes in browser, tag GraphStore
    if (!this.skipPhases.has('observe')) {
      this._phase = 'observe';
      this.log(`[orch] Phase 1: observe — visiting ${reachable} reachable nodes…`);
      await this.runObservePhase();
    } else {
      this.log(`[orch] Phase 1: observe — skipped`);
    }

    // Phase 2 — Learn: probe params/forms, record observations
    if (!this.skipPhases.has('learn')) {
      this._phase = 'learn';
      this.log(`[orch] Phase 2: learn — probing nodes with params…`);
      await this.runLearnPhase();
    } else {
      this.log(`[orch] Phase 2: learn — skipped`);
    }

    // Phase 3 — Attack: existing sequential/concurrent loop
    if (this.skipPhases.has('attack')) {
      this._phase = 'done';
      this.log(`[orch] Phase 3: attack — skipped`);
      return {
        totalNodes: this.graph.size().nodes,
        completedNodes: 0,
        failedNodes: 0,
        blockedNodes: 0,
        findings: [],
        durationMs: 0,
        terminatedBy: 'exhausted',
        effectiveMaxConcurrency: this.maxConcurrency,
        rateLimitEvents: 0,
      };
    }

    this._phase = 'attack';
    const result = this.enableConcurrency ? await this.runConcurrent() : await this.runSequential();
    this._phase = 'done';
    return result;
  }

  private async resolveSpec(node: WorkflowStateNode): Promise<NodeSpec | null> {
    const cached = this.resolvedStrategies.get(node.id);
    if (cached) return specFromResolution(node, cached, this.appModel ?? undefined);
    const resolution = await this.strategy.resolve(node, this.appModel ?? ({} as AppModel));
    if (!resolution) return null;
    this.resolvedStrategies.set(node.id, resolution);
    this.log(`[orch] resolved ${node.id} → ${resolution.technique} (timeout=${resolution.timeoutMs}ms, severity=${resolution.expectedSeverity})`);
    return specFromResolution(node, resolution, this.appModel ?? undefined);
  }

  private async runSequential(): Promise<OrchestrationResult> {
    const start = Date.now();
    const findings: AppModelFinding[] = [];
    let completed = 0;
    let failed = 0;
    let processed = 0;
    let terminatedBy: OrchestrationResult['terminatedBy'] = 'exhausted';

    while (true) {
      if (this.shouldAbort?.()) { terminatedBy = 'abort'; break; }
      if (this.maxRuntimeMs > 0 && Date.now() - start >= this.maxRuntimeMs) { terminatedBy = 'time'; break; }
      if (processed >= this.maxNodes) { terminatedBy = 'max-nodes'; break; }

      const next = this.graph.nextActionable()[0];
      if (!next) { terminatedBy = 'exhausted'; break; }

      const spec = await this.resolveSpec(next);
      if (this.onBeforeNode) {
        const decision = await this.onBeforeNode(next, spec);
        if (decision === 'abort') { terminatedBy = 'abort'; break; }
        if (decision === 'skip') {
          this.graph.markFailed(next.id, 'skipped by user');
          failed++;
          processed++;
          continue;
        }
      }
      if (!spec) {
        this.graph.markFailed(next.id, 'strategy could not resolve node');
        failed++;
        processed++;
        continue;
      }

      const retries = this.techniqueRetries.get(techKey(spec.technique, spec.url)) ?? 0;
      if (retries >= this.perTechniqueBudget) {
        this.graph.markFailed(next.id, `technique budget exhausted (${retries} retries)`);
        failed++;
        processed++;
        continue;
      }

      this.graph.markInProgress(next.id);
      this.onNodeUpdate?.(next, 'in_progress');
      this.log(`[orch] → ${next.id} · ${spec.technique} on ${spec.url}${spec.param ? ` (param=${spec.param})` : ''} [${processed + 1}/${this.maxNodes}]`);
      const activeSessionId = this.pool.getActive()?.id ?? null;
      const result = await this.spawnOne(next, spec, activeSessionId, retries, start);
      this.techniqueRetries.set(techKey(spec.technique, spec.url), retries + 1);
      this.recordResult(next, spec, result, findings);
      const outcome = result.vulnerable
        ? `VULN conf=${result.confidence.toFixed(2)} (${result.evidence.length} evidence)`
        : result.error
          ? `FAIL: ${result.error}`
          : 'clean';
      this.log(`[orch] ← ${next.id} · ${outcome} in ${result.durationMs}ms`);
      if (result.rateLimited) {
        this.rateLimitEvents++;
        this.log(`[orch] rate-limited (sequential, no concurrency to reduce)`);
      }
      if (result.vulnerable && result.confidence >= 0.5) completed++;
      else if (result.error) failed++;
      else completed++;
      this.graph.refreshReachable();
      processed++;
      if (this.sleepBetweenNodesMs > 0) await sleep(this.sleepBetweenNodesMs);
    }

    return {
      totalNodes: this.graph.size().nodes,
      completedNodes: completed,
      failedNodes: failed,
      blockedNodes: 0,
      findings,
      durationMs: Date.now() - start,
      terminatedBy,
      effectiveMaxConcurrency: this.maxConcurrency,
      rateLimitEvents: this.rateLimitEvents,
    };
  }

  private async runConcurrent(): Promise<OrchestrationResult> {
    const start = Date.now();
    const findings: AppModelFinding[] = [];
    let completed = 0;
    let failed = 0;
    let processed = 0;
    let terminatedBy: OrchestrationResult['terminatedBy'] = 'exhausted';
    let abortedByUser = false;
    const inFlight: Map<string, Promise<void>> = new Map();
    const processedIds = new Set<string>();

    const scheduleOne = (): boolean => {
      if (this.shouldAbort?.()) return false;
      if (this.maxRuntimeMs > 0 && Date.now() - start >= this.maxRuntimeMs) return false;
      if (processed >= this.maxNodes) return false;
      if (inFlight.size >= this.maxConcurrency) return false;
      const next = this.graph.nextActionable()[0];
      if (!next) return false;
      if (processedIds.has(next.id)) return false;
      processedIds.add(next.id);
      const task = (async () => {
        try {
          const spec = await this.resolveSpec(next);
          if (this.onBeforeNode) {
            const decision = await this.onBeforeNode(next, spec);
            if (decision === 'abort') { abortedByUser = true; return; }
            if (decision === 'skip') {
              this.graph.markFailed(next.id, 'skipped by user');
              failed++;
              processed++;
              return;
            }
          }
          if (!spec) {
            this.graph.markFailed(next.id, 'strategy could not resolve node');
            failed++;
            processed++;
            return;
          }
          const retries = this.techniqueRetries.get(techKey(spec.technique, spec.url)) ?? 0;
          if (retries >= this.perTechniqueBudget) {
            this.graph.markFailed(next.id, `technique budget exhausted (${retries} retries)`);
            failed++;
            processed++;
            return;
          }
          this.graph.markInProgress(next.id);
          this.onNodeUpdate?.(next, 'in_progress');
          this.log(`[orch] → ${next.id} · ${spec.technique} on ${spec.url}${spec.param ? ` (param=${spec.param})` : ''} [in-flight=${inFlight.size + 1}]`);
          const activeSessionId = this.pool.getActive()?.id ?? null;
          const result = await this.spawnOne(next, spec, activeSessionId, retries, start);
          this.techniqueRetries.set(techKey(spec.technique, spec.url), retries + 1);
          this.recordResult(next, spec, result, findings);
          const outcome = result.vulnerable
            ? `VULN conf=${result.confidence.toFixed(2)} (${result.evidence.length} evidence)`
            : result.error
              ? `FAIL: ${result.error}`
              : 'clean';
          this.log(`[orch] ← ${next.id} · ${outcome} in ${result.durationMs}ms`);
          if (result.rateLimited) {
            this.rateLimitEvents++;
            const prev = this.maxConcurrency;
            this.maxConcurrency = Math.max(1, Math.floor(this.maxConcurrency / 2));
            this.log(`[orch] rate-limited, reducing concurrency from ${prev} to ${this.maxConcurrency}`);
            await sleep(this.huntConfig.rateLimitBackoffMs);
          }
          if (result.vulnerable && result.confidence >= 0.5) completed++;
          else if (result.error) failed++;
          else completed++;
          this.graph.refreshReachable();
          processed++;
        } catch (e) {
          this.log(`[orch] unhandled error in worker: ${String(e)}`);
          this.graph.markFailed(next.id, String(e));
          failed++;
          processed++;
        }
      })().finally(() => { inFlight.delete(next.id); });
      inFlight.set(next.id, task);
      return true;
    };

    while (true) {
      if (this.shouldAbort?.() || abortedByUser) { terminatedBy = abortedByUser ? 'abort' : 'abort'; break; }
      if (this.maxRuntimeMs > 0 && Date.now() - start >= this.maxRuntimeMs) { terminatedBy = 'time'; break; }
      if (processed >= this.maxNodes) { terminatedBy = 'max-nodes'; break; }
      let scheduled = false;
      while (scheduleOne()) scheduled = true;
      if (!scheduled && inFlight.size === 0) {
        const nextActionable = this.graph.nextActionable();
        if (nextActionable.length === 0) { terminatedBy = 'exhausted'; break; }
        const all = nextActionable.every((n) => processedIds.has(n.id));
        if (all) { terminatedBy = 'exhausted'; break; }
      }
      if (inFlight.size === 0) break;
      await Promise.race([
        Promise.allSettled([...inFlight.values()]),
        sleep(100),
      ]);
    }

    return {
      totalNodes: this.graph.size().nodes,
      completedNodes: completed,
      failedNodes: failed,
      blockedNodes: 0,
      findings,
      durationMs: Date.now() - start,
      terminatedBy,
      effectiveMaxConcurrency: this.maxConcurrency,
      rateLimitEvents: this.rateLimitEvents,
    };
  }

  private async spawnOne(
    next: WorkflowStateNode,
    spec: NodeSpec,
    activeSessionId: string | null,
    retries: number,
    start: number,
  ): Promise<WorkerSpawnResult> {
    try {
      return await this.workerFactory({
        hypothesis: makeHypothesisForNode(spec),
        workflowNodeId: next.id,
        technique: spec.technique,
        url: spec.url,
        method: spec.method,
        param: spec.param,
        allParams: spec.allParams,
        bodyPreview: spec.bodyPreview,
        concreteUrl: spec.concreteUrl,
        onLLMToken: this.onLLMToken,
        onLog: this.onComposerEvent
          ? (event) => this.onComposerEvent?.(event)
          : undefined,
        onPrimitive: this.onPrimitive,
        activeSessionId,
        retryAttempt: retries,
        timeoutMs: spec.timeoutMs,
        expectedSeverity: spec.expectedSeverity,
        outDir: this.outDir,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is429 = /429|rate.?limit|too many requests/i.test(msg);
      return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: `Worker failed: ${msg}`, technique: spec.technique, url: spec.url, error: msg, durationMs: Date.now() - start, rateLimited: is429 };
    }
  }

  private recordResult(
    next: WorkflowStateNode,
    spec: NodeSpec,
    result: WorkerSpawnResult,
    findings: AppModelFinding[],
  ): void {
    if (result.vulnerable && result.confidence >= 0.5) {
      // Bug 2: the persisted AppModelFinding was missing `method` and
      // `payload`. Codegen (finding-test-generator.ts) uses these to
      // build a Playwright regression test that reproduces the vuln
      // — without them the generated test just hits the bare URL and
      // asserts status < 500, which doesn't actually prove the vuln
      // (e.g. it wouldn't reproduce the XSS at /?query=<script>...).
      // Pull the HTTP method from the resolved spec, and the first
      // payload that actually worked from the worker's result.
      const firstPayload = Array.isArray(result.payloads) && result.payloads.length > 0
        ? result.payloads[0]
        : '';
      const finding: AppModelFinding = {
        type: `${spec.technique}-v3`,
        endpoint: spec.url,
        param: spec.param ?? '',
        method: spec.method,
        payload: firstPayload,
        evidence: result.evidence,
        confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
        confirmed: result.confidence >= 0.7,
        severity: spec.expectedSeverity,
      };
      findings.push(finding);
      this.graph.addFinding(next.id, finding.type);
      this.onFinding?.(finding, next);
      this.graph.markCompleted(next.id, [finding.type]);
      this.onNodeUpdate?.(next, 'completed');
    } else if (result.error) {
      this.graph.markFailed(next.id, result.error);
      this.onNodeUpdate?.(next, 'failed');
    } else {
      this.graph.markCompleted(next.id);
      this.onNodeUpdate?.(next, 'completed');
    }
  }
}

function techKey(technique: Technique, url: string): string {
  return `${technique}|${url}`;
}

function specFromResolution(
  node: WorkflowStateNode,
  r: NodeStrategyResolution,
  appModel?: AppModel,
): NodeSpec {
  // Find the matched endpoint to extract ALL params + body preview + concrete URL
  const endpoints = (appModel?.endpoints || []) as any[];
  const matchingEp = endpoints.find((e) => {
    if (!e?.path) return false;
    return node.url.endsWith(e.path) || e.path.endsWith(node.url.split('?')[0]);
  });
  return {
    workflowNodeId: node.id,
    url: node.url,
    method: r.method,
    technique: r.technique,
    param: r.param,
    allParams: matchingEp?.params,
    bodyPreview: matchingEp?.bodyPreview,
    concreteUrl: node.url,
    requiresAuth: node.authRequired,
    timeoutMs: r.timeoutMs,
    expectedSeverity: r.expectedSeverity,
  };
}

function makeHypothesisForNode(spec: NodeSpec): Hypothesis {
  return {
    type: 'param',
    id: `${spec.workflowNodeId}-${randomUUID().slice(0, 6)}`,
    endpoint: spec.url,
    method: spec.method,
    param: spec.param ?? '',
    technique: spec.technique,
    priority: 5,
    status: 'pending',
    source: 'strategist',
    createdAt: Date.now(),
  };
}

/**
 * The default node strategy. Uses LLM-driven technique selection
 * (`selectTechniquesForEndpoint`) when the AppModel has the relevant
 * endpoint data, falls back to the LLM's safe fallback. Timeout and
 * severity are derived from node signals; can be overridden.
 *
 * IMPORTANT: this default exists only so the orchestrator works
 * without a custom strategy. In production, callers should always
 * inject a NodeStrategy that fits their target class.
 */
/**
 * Graph-aware node strategy. Reads GraphStore tags/observations/params
 * and selects a technique based on observed node characteristics.
 * No hardcoded URL-pattern regex mapping. Falls back to the workflow
 * node type when graph data is insufficient, but never defaults to a
 * single technique.
 */
export const defaultNodeStrategy: NodeStrategy = {
  async resolve(node, appModel) {
    if (node.type === 'modal' || node.type === 'redirect') return null;

    const graphStore = getGlobalGraphStore();
    const gNode = graphStore.findNodeByUrl('GET', node.url);

    // Fall back to node-type heuristics when graph store has no data
    // Fallback: if the graph store has no data for this URL, use the
    // workflow node type as a hint (but don't default to a technique).
    // This handles tests and early-scenario runs where the observe
    // phase hasn't tagged nodes yet.
    const hasGraphData = gNode && (gNode.tags.length > 0 || gNode.observations.length > 0 || gNode.params.length > 0 || gNode.bodyFields.length > 0);
    const sourceParams = hasGraphData ? gNode! : { params: [], bodyFields: [] };
    const params = [
      ...sourceParams.params.map((p: any) => p.name),
      ...sourceParams.bodyFields.map((b: any) => b.name),
    ].slice(0, 5);
    const firstParam = params[0] ?? sourceParams.params?.[0]?.name;

    let technique: Technique = 'xss';
    const hasReflection = hasGraphData && gNode!.tags.includes('reflects-input');
    const hasForms = hasGraphData && gNode!.tags.includes('has-forms');
    const isAuth = hasGraphData && gNode!.tags.includes('auth-required') || node.authRequired;
    const isJSON = hasGraphData && gNode!.tags.includes('returns-json');
    const isHTML = hasGraphData && gNode!.tags.includes('returns-html');
    const isAPI = node.type === 'api';

    if (hasReflection && (isHTML || isJSON)) technique = 'xss';
    else if (isAuth) technique = 'open-redirect';
    else if ((isAPI || isJSON) && params.length > 0) technique = 'sqli';
    else if (hasForms && !isAPI) technique = 'xss';
    else if (params.some((p: string) => /url|uri|redirect|target|fetch/.test(p))) technique = 'ssrf';

    const expectedSeverity: AppModelFinding['severity'] =
      isAuth || isAPI || isJSON ? 'high' : 'medium';

    return {
      technique,
      method: isAPI || isJSON ? 'POST' : 'GET',
      param: firstParam,
      timeoutMs: 120_000,
      expectedSeverity,
    };
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
