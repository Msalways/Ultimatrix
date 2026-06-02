/**
 * src/pipeline/assess-v3-runner.ts
 *
 * Thin orchestration layer that ties together:
 *   - spider (workflow nodes + auth flow → WorkflowStateGraph + SessionPool)
 *   - AutonomousV3Orchestrator (DAG-driven loop with hybrid termination)
 *   - workerRunner (per-node worker that uses session pool + Playwright)
 *   - app-model writes (findings persisted, report generated)
 *
 * This is the production entry point for `--v3` assess runs. It is
 * invoked from `src/cli/index.ts` when the user passes `--v3`.
 */

import { AutonomousV3Orchestrator, type WorkerFactory, type WorkerSpawnInput, type WorkerSpawnResult, type OnFindingHandler, type OnNodeUpdateHandler } from './autonomous-v3';
import type { WorkflowStateGraph } from '../core/workflow-state';
import type { SessionPool } from '../core/session-pool';
import { readAppModel, compileReport, updateAppModelSection } from '../core/app-model';
import fs from 'fs';
import type { Finding, ScanTarget } from '../core/types';

export type WorkerRunner = (input: WorkerSpawnInput) => Promise<WorkerSpawnResult>;

export interface AssessV3Options {
  target: ScanTarget;
  graph: WorkflowStateGraph;
  pool: SessionPool;
  appModelPath: string;
  outputDir: string;
  format?: 'html' | 'markdown' | 'json';
  perTechniqueBudget?: number;
  maxRuntimeMs?: number;
  maxNodes?: number;
  workerRunner: WorkerRunner;
  onFinding?: OnFindingHandler;
  onNodeUpdate?: OnNodeUpdateHandler;
  shouldAbort?: () => boolean;
}

export async function runAssessV3(opts: AssessV3Options): Promise<{ findings: Finding[]; reportPath: string; terminatedBy: string }> {
  const orch = new AutonomousV3Orchestrator({
    graph: opts.graph,
    pool: opts.pool,
    workerFactory: opts.workerRunner,
    onFinding: (finding, node) => {
      updateAppModelSection(opts.appModelPath, 'findings', [finding], true);
      opts.onFinding?.(finding, node);
    },
    onNodeUpdate: opts.onNodeUpdate,
    perTechniqueBudget: opts.perTechniqueBudget,
    maxRuntimeMs: opts.maxRuntimeMs,
    maxNodes: opts.maxNodes,
    shouldAbort: opts.shouldAbort,
  });

  const result = await orch.run();

  const finalModel = readAppModel(opts.appModelPath);
  const report = compileReport(finalModel, opts.format || 'html');
  const reportPath = `${opts.outputDir}/final-security-report.${opts.format || 'html'}`;
  fs.writeFileSync(reportPath, report);

  const findings: Finding[] = (finalModel.findings || []).map((f, i) => ({
    id: `finding-${i}`,
    title: f.type,
    description: `Parameter: ${f.param || '-'}, Evidence: ${f.evidence.map((e) => e.label).join('; ')}`,
    severity: f.severity as Finding['severity'],
    category: f.type,
    confidence: f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3,
    location: f.endpoint || finalModel.target,
    evidence: f.evidence.map((e) => `[${e.label}] ${e.data.slice(0, 200)}`).join('\n'),
    remediation: '',
    agent: 'autonomous' as Finding['agent'],
    timestamp: new Date().toISOString(),
  }));

  return { findings, reportPath, terminatedBy: result.terminatedBy };
}
