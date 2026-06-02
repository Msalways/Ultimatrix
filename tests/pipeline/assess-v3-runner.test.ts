/**
 * tests/pipeline/assess-v3-runner.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAssessV3, type WorkerRunner } from '../../src/pipeline/assess-v3-runner';
import { WorkflowStateGraph } from '../../src/core/workflow-state';
import { SessionPool } from '../../src/core/session-pool';
import { readAppModel } from '../../src/core/app-model';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('runAssessV3', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assess-v3-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the orchestrator, persists findings, and writes a report', async () => {
    const appModelPath = path.join(tmpDir, 'app-model.json');
    fs.writeFileSync(appModelPath, JSON.stringify({
      target: 'https://example.com',
      techStack: [],
      auth: { type: 'unknown', loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {} },
      workflow: { nodes: [], edges: [] },
      endpoints: [],
      forms: [],
      scripts: [],
      cookies: {},
      localStorage: {},
      findings: [],
      verifications: [],
      parameterClassifications: [],
      authBoundaries: [],
      recordedSessions: {},
      hypotheses: [],
      nextSteps: [],
      visitedUrls: [],
    }));

    const graph = new WorkflowStateGraph();
    const node = graph.addNode({ id: 'n1', url: 'https://example.com/api/test', title: 'test', type: 'api', authRequired: false, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    graph.markReachable('n1');

    const pool = new SessionPool({ headless: true, networkCaptureEnabled: false });

    const workerRunner: WorkerRunner = async (input) => {
      if (input.workflowNodeId === 'n1') {
        return {
          vulnerable: true,
          confidence: 0.9,
          evidence: [{ type: 'text', data: 'reflected xss', label: 'xss-evidence', timestamp: Date.now() }],
          payloads: ['<script>alert(1)</script>'],
          summary: 'XSS confirmed at https://example.com/api/test',
          technique: input.technique,
          url: input.url,
          durationMs: 100,
        };
      }
      return { vulnerable: false, confidence: 0, evidence: [], payloads: [], summary: 'no vuln', technique: input.technique, url: input.url, durationMs: 0 };
    };

    const result = await runAssessV3({
      target: 'https://example.com' as any,
      graph,
      pool,
      appModelPath,
      outputDir: tmpDir,
      format: 'json',
      workerRunner,
      perTechniqueBudget: 1,
      maxNodes: 5,
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].location).toBe('https://example.com/api/test');
    const reportPath = path.join(tmpDir, 'final-security-report.json');
    expect(fs.existsSync(reportPath)).toBe(true);
    const model = readAppModel(appModelPath);
    expect(model.findings.length).toBeGreaterThan(0);
  }, 15000);
});
