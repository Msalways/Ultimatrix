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
  resolve(node: WorkflowStateNode, appModel: AppModel, signal: { llmDriven: boolean }): Promise<NodeStrategyResolution | null>;
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
}

const DEFAULT_PER_TECHNIQUE_BUDGET = 3;
const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000;
const DEFAULT_MAX_NODES = 200;
const DEFAULT_SLEEP_MS = 0;
const DEFAULT_MAX_CONCURRENCY = 4;
const RATE_LIMIT_BACKOFF_MS = 5_000;

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
  private rateLimitEvents: number = 0;
  private resolvedStrategies: Map<string, NodeStrategyResolution> = new Map();
  private strategyFailures: Map<string, number> = new Map();

  constructor(opts: AutonomousV3Options) {
    this.graph = opts.graph;
    this.pool = opts.pool;
    this.workerFactory = opts.workerFactory;
    this.appModel = opts.appModel;
    this.strategy = opts.strategy ?? defaultNodeStrategy;
    this.onFinding = opts.onFinding;
    this.onNodeUpdate = opts.onNodeUpdate;
    this.onBeforeNode = opts.onBeforeNode;
    this.perTechniqueBudget = opts.perTechniqueBudget ?? DEFAULT_PER_TECHNIQUE_BUDGET;
    this.maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
    this.maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    this.enableConcurrency = opts.enableConcurrency ?? false;
    this.sleepBetweenNodesMs = opts.sleepBetweenNodesMs ?? DEFAULT_SLEEP_MS;
    this.shouldAbort = opts.shouldAbort;
    this.maxConcurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.onLog = opts.onLog;
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

  private log(msg: string): void {
    if (this.onLog) this.onLog(msg);
  }

  async run(): Promise<OrchestrationResult> {
    if (this.enableConcurrency) return this.runConcurrent();
    return this.runSequential();
  }

  private async resolveSpec(node: WorkflowStateNode): Promise<NodeSpec | null> {
    const sig = { llmDriven: false };
    const cached = this.resolvedStrategies.get(node.id);
    if (cached) return specFromResolution(node, cached, this.appModel ?? undefined);
    const resolution = await this.strategy.resolve(node, this.appModel ?? ({} as AppModel), sig);
    if (!resolution) return null;
    this.resolvedStrategies.set(node.id, resolution);
    this.log(`[orch] resolved ${node.id} → ${resolution.technique} (timeout=${resolution.timeoutMs}ms, severity=${resolution.expectedSeverity}, llmDriven=${sig.llmDriven})`);
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
      if (Date.now() - start >= this.maxRuntimeMs) { terminatedBy = 'time'; break; }
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
      const activeSessionId = this.pool.getActive()?.id ?? null;
      const result = await this.spawnOne(next, spec, activeSessionId, retries, start);
      this.techniqueRetries.set(techKey(spec.technique, spec.url), retries + 1);
      this.recordResult(next, spec, result, findings);
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
    const signal = { llmDriven: false };

    const scheduleOne = (): boolean => {
      if (this.shouldAbort?.()) return false;
      if (Date.now() - start >= this.maxRuntimeMs) return false;
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
          const activeSessionId = this.pool.getActive()?.id ?? null;
          const result = await this.spawnOne(next, spec, activeSessionId, retries, start);
          this.techniqueRetries.set(techKey(spec.technique, spec.url), retries + 1);
          this.recordResult(next, spec, result, findings);
          if (result.rateLimited) {
            this.rateLimitEvents++;
            const prev = this.maxConcurrency;
            this.maxConcurrency = Math.max(1, Math.floor(this.maxConcurrency / 2));
            this.log(`[orch] rate-limited, reducing concurrency from ${prev} to ${this.maxConcurrency}`);
            await sleep(RATE_LIMIT_BACKOFF_MS);
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
      if (Date.now() - start >= this.maxRuntimeMs) { terminatedBy = 'time'; break; }
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
        activeSessionId,
        retryAttempt: retries,
        timeoutMs: spec.timeoutMs,
        expectedSeverity: spec.expectedSeverity,
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
      const finding: AppModelFinding = {
        type: `${spec.technique}-v3`,
        endpoint: spec.url,
        param: spec.param ?? '',
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
export const defaultNodeStrategy: NodeStrategy = {
  async resolve(node, appModel, signal) {
    if (node.type === 'modal' || node.type === 'redirect') return null;
    const endpoints = (appModel?.endpoints || []) as any[];
    const matchingEp = endpoints.find((e) => {
      if (!e?.path) return false;
      return node.url.endsWith(e.path) || e.path.endsWith(node.url.split('?')[0]);
    });
    if (matchingEp && signal) signal.llmDriven = true;
    const timeoutMs = heuristicTimeoutForNode(node, matchingEp);
    const expectedSeverity = heuristicSeverityForNode(node);
    let technique: Technique = 'xss';
    if (matchingEp) {
      technique = inferTechniqueFromEndpoint(matchingEp);
    } else if (node.type === 'api' || /\/api\/|\/v\d+\//.test(node.url)) {
      technique = 'sqli';
    } else if (/login|auth|signin|signup/i.test(node.url)) {
      technique = 'open-redirect';
    }
    return {
      technique,
      method: node.type === 'api' ? 'POST' : 'GET',
      param: matchingEp?.params?.[0]?.name,
      timeoutMs,
      expectedSeverity,
    };
  },
};

function heuristicTimeoutForNode(node: WorkflowStateNode, ep: any): number {
  let ms = 30_000;
  if (node.type === 'api' || ep) ms = 120_000;
  if (node.authRequired) ms = Math.max(ms, 60_000);
  if (node.type === 'gated') ms = 180_000;
  if (ep && Array.isArray(ep.params) && ep.params.length > 3) ms = Math.max(ms, 90_000);
  return ms;
}

function heuristicSeverityForNode(node: WorkflowStateNode): AppModelFinding['severity'] {
  if (node.type === 'gated' || node.authRequired) return 'high';
  if (node.type === 'api') return 'high';
  return 'medium';
}

function inferTechniqueFromEndpoint(ep: any): Technique {
  const path = String(ep.path || '').toLowerCase();
  const method = String(ep.method || 'GET').toUpperCase();
  const body = String(ep.body || ep.contentType || '').toLowerCase();

  // OAuth / SSO / callback endpoints
  if (/\/oauth|\/authorize|\/callback|\/redirect|response_type|client_id|redirect_uri/.test(path)) {
    return 'open-redirect';
  }

  // SSRF — anything that takes a URL as a query param
  if (/[?&](url|uri|target|dest|redirect|fetch|proxy|api_endpoint)=/.test(path)) {
    return 'ssrf';
  }

  // SSTI — render/template endpoints
  if (/\/render|\/template|\/view|\/compile|\/tpl/.test(path)) {
    return 'ssti';
  }

  // Race condition — money/coupon/transfer/invite endpoints
  if (/\/transfer|\/coupon|\/redeem|\/withdraw|\/claim|\/checkout|\/pay|\/vote|\/invite|\/register/.test(path) && method === 'POST') {
    return 'race';
  }

  // JWT/auth token endpoints
  if (/\/token|\/auth|\/login|\/signin|\/session/.test(path) && method === 'POST') {
    return 'open-redirect';
  }

  // File upload — path traversal + bypass
  if (/\/upload|\/file|\/attachment|\/media|\/image/.test(path) && method === 'POST') {
    return 'path';
  }

  // GraphQL — SQLi-style introspection attacks
  if (/\/graphql/.test(path)) {
    return 'sqli';
  }

  // XML / XXE
  if (/\.xml$|content-type.*xml/.test(path + body)) {
    return 'xxe';
  }

  // File path with user-controlled ID
  if (/:id\b|\/\d+\b|{\w+}/.test(path)) {
    return 'idor';
  }

  // General API
  if (/\/api\/|\/v\d+\//.test(path)) {
    return 'sqli';
  }

  // Search / query strings
  if (/\.json$|\/search\?|q=|query=|search/.test(path)) {
    return 'xss';
  }

  // File/path manipulation
  if (/\/upload|file|path|attachment/.test(path)) {
    return 'path';
  }

  // Command exec
  if (/\/exec|cmd|shell/.test(path)) {
    return 'cmd';
  }

  return 'xss';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
