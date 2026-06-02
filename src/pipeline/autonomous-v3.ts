/**
 * src/pipeline/autonomous-v3.ts
 *
 * Workflow-DAG-driven orchestrator. Replaces the fixed-turn / maxToolCalls
 * termination of autonomous.ts with a hybrid that respects:
 *   - workflow-state DAG exhaustion (no more reachable nodes)
 *   - per-technique retry budget (e.g. 3 attempts per (hypothesis, technique))
 *   - overall time limit (e.g. 30 minutes)
 *
 * Why: the v1/v2 orchestrators terminated on tool-call counts, which
 * meant a quiet 10-min run was just as good as a 2-hour run. v3 says
 * "keep going as long as there's something actionable, and the budget
 * or wall-clock hasn't been hit."
 *
 * Designed to be testable: every external dependency is injected.
 */

import type { WorkflowStateGraph, WorkflowStateNode } from '../core/workflow-state';
import type { SessionPool } from '../core/session-pool';
import type { Hypothesis, Technique } from '../core/attack-plan';
import type { AppModelFinding, FindingEvidence } from '../core/app-model';
import { randomUUID } from 'crypto';

export interface NodeSpec {
  workflowNodeId: string;
  url: string;
  method: string;
  technique: Technique;
  param?: string;
  requiresAuth: boolean;
}

export interface WorkerSpawnInput {
  hypothesis: Hypothesis;
  workflowNodeId: string;
  technique: Technique;
  url: string;
  method: string;
  param?: string;
  activeSessionId: string | null;
  retryAttempt: number;
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
}

export type WorkerFactory = (input: WorkerSpawnInput) => Promise<WorkerSpawnResult>;

export interface OnFindingHandler {
  (finding: AppModelFinding, node: WorkflowStateNode): void;
}

export interface OnNodeUpdateHandler {
  (node: WorkflowStateNode, status: 'in_progress' | 'completed' | 'failed'): void;
}

export interface AutonomousV3Options {
  graph: WorkflowStateGraph;
  pool: SessionPool;
  workerFactory: WorkerFactory;
  onFinding?: OnFindingHandler;
  onNodeUpdate?: OnNodeUpdateHandler;
  perTechniqueBudget?: number;
  maxRuntimeMs?: number;
  maxNodes?: number;
  enableConcurrency?: boolean;
  sleepBetweenNodesMs?: number;
  shouldAbort?: () => boolean;
}

const DEFAULT_PER_TECHNIQUE_BUDGET = 3;
const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000;
const DEFAULT_MAX_NODES = 200;
const DEFAULT_SLEEP_MS = 0;

export interface OrchestrationResult {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  blockedNodes: number;
  findings: AppModelFinding[];
  durationMs: number;
  terminatedBy: 'exhausted' | 'budget' | 'time' | 'abort' | 'no-active-session' | 'max-nodes';
}

export class AutonomousV3Orchestrator {
  private graph: WorkflowStateGraph;
  private pool: SessionPool;
  private workerFactory: WorkerFactory;
  private onFinding?: OnFindingHandler;
  private onNodeUpdate?: OnNodeUpdateHandler;
  private perTechniqueBudget: number;
  private maxRuntimeMs: number;
  private maxNodes: number;
  private enableConcurrency: boolean;
  private sleepBetweenNodesMs: number;
  private shouldAbort?: () => boolean;
  private techniqueRetries: Map<string, number> = new Map();

  constructor(opts: AutonomousV3Options) {
    this.graph = opts.graph;
    this.pool = opts.pool;
    this.workerFactory = opts.workerFactory;
    this.onFinding = opts.onFinding;
    this.onNodeUpdate = opts.onNodeUpdate;
    this.perTechniqueBudget = opts.perTechniqueBudget ?? DEFAULT_PER_TECHNIQUE_BUDGET;
    this.maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
    this.maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    this.enableConcurrency = opts.enableConcurrency ?? false;
    this.sleepBetweenNodesMs = opts.sleepBetweenNodesMs ?? DEFAULT_SLEEP_MS;
    this.shouldAbort = opts.shouldAbort;
  }

  async run(): Promise<OrchestrationResult> {
    const start = Date.now();
    const findings: AppModelFinding[] = [];
    let completed = 0;
    let failed = 0;
    let blocked = 0;
    let processed = 0;
    let terminatedBy: OrchestrationResult['terminatedBy'] = 'exhausted';

    while (true) {
      if (this.shouldAbort?.()) { terminatedBy = 'abort'; break; }
      const elapsed = Date.now() - start;
      if (elapsed >= this.maxRuntimeMs) { terminatedBy = 'time'; break; }
      if (processed >= this.maxNodes) { terminatedBy = 'max-nodes'; break; }

      const next = this.graph.nextActionable()[0];
      if (!next) {
        terminatedBy = this.graph.size().nodes === 0 ? 'exhausted' : 'exhausted';
        break;
      }

      const spec = nodeToSpec(next);
      if (!spec) {
        this.graph.markFailed(next.id, 'no spec generated');
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
      this.pool.getActive();
      const activeSessionId = this.pool.getActive()?.id ?? null;

      let result: WorkerSpawnResult;
      try {
        result = await this.workerFactory({
          hypothesis: makeHypothesisForNode(spec),
          workflowNodeId: next.id,
          technique: spec.technique,
          url: spec.url,
          method: spec.method,
          param: spec.param,
          activeSessionId,
          retryAttempt: retries,
        });
      } catch (e) {
        result = makeFailure(spec, String(e), Date.now() - elapsed);
      }

      this.techniqueRetries.set(techKey(spec.technique, spec.url), retries + 1);

      if (result.vulnerable && result.confidence >= 0.5) {
        const finding = makeFinding(next.id, spec, result);
        findings.push(finding);
        this.graph.addFinding(next.id, finding.type);
        this.onFinding?.(finding, next);
        this.graph.markCompleted(next.id, [finding.type]);
        this.onNodeUpdate?.(next, 'completed');
        completed++;
      } else if (result.error) {
        this.graph.markFailed(next.id, result.error);
        this.onNodeUpdate?.(next, 'failed');
        failed++;
      } else {
        this.graph.markCompleted(next.id);
        this.onNodeUpdate?.(next, 'completed');
        completed++;
      }

      this.graph.refreshReachable();
      processed++;
      if (this.sleepBetweenNodesMs > 0) await sleep(this.sleepBetweenNodesMs);
    }

    return {
      totalNodes: this.graph.size().nodes,
      completedNodes: completed,
      failedNodes: failed,
      blockedNodes: blocked,
      findings,
      durationMs: Date.now() - start,
      terminatedBy,
    };
  }
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

function makeFinding(workflowNodeId: string, spec: NodeSpec, result: WorkerSpawnResult): AppModelFinding {
  return {
    type: `${spec.technique}-v3`,
    endpoint: spec.url,
    param: spec.param ?? '',
    evidence: result.evidence,
    confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
    confirmed: result.confidence >= 0.7,
    severity: severityForTechnique(spec.technique),
  };
}

function makeFailure(spec: NodeSpec, error: string, _elapsed: number): WorkerSpawnResult {
  return {
    vulnerable: false,
    confidence: 0,
    evidence: [],
    payloads: [],
    summary: `Worker failed: ${error}`,
    technique: spec.technique,
    url: spec.url,
    error,
    durationMs: 0,
  };
}

function nodeToSpec(node: WorkflowStateNode): NodeSpec | null {
  if (node.type !== 'api' && node.type !== 'page' && node.type !== 'login' && node.type !== 'gated') return null;
  const technique = pickTechniqueForNode(node);
  return {
    workflowNodeId: node.id,
    url: node.url,
    method: node.type === 'api' ? 'POST' : 'GET',
    technique,
    requiresAuth: node.authRequired,
  };
}

function pickTechniqueForNode(_node: WorkflowStateNode): Technique {
  return 'xss';
}

function techKey(technique: Technique, url: string): string {
  return `${technique}|${url}`;
}

function severityForTechnique(technique: Technique): AppModelFinding['severity'] {
  if (technique === 'xss' || technique === 'sqli' || technique === 'ssrf' || technique === 'xxe' || technique === 'cmd' || technique === 'ssti') return 'high';
  if (technique === 'open-redirect') return 'medium';
  if (technique === 'path' || technique === 'idor' || technique === 'race') return 'medium';
  return 'low';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
