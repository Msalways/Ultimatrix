// tests/tools/finding-test-generator.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateFindingTests, writeFindingTests } from '../../src/tools/finding-test-generator';
import type { AppModel, AppModelFinding, AttackChain } from '../../src/core/app-model';

function makeModel(): AppModel {
  return {
    target: 'http://x.com',
    techStack: [],
    auth: { username: 'admin', password: 'secret' } as any,
    workflow: { steps: [], edges: [] },
    endpoints: [],
    forms: [],
    scripts: [],
    cookies: [],
    localStorage: {},
    sessionStorage: {},
    findings: [
      { id: 'f-1', type: 'xss', endpoint: '/search', param: 'q', method: 'GET', payload: '<script>', confidence: 'high', confirmed: true, severity: 'high' } as any,
      { id: 'f-2', type: 'sqli', endpoint: '/api/users', param: 'id', method: 'POST', payload: "' OR 1=1--", confidence: 'medium', confirmed: true, severity: 'critical' } as any,
    ],
    verifications: [],
    parameterClassifications: [],
    authBoundaries: [],
    recordedSessions: [],
    hypotheses: [],
    nextSteps: [],
    visitedUrls: [],
    oauthProviders: [],
    graphqlEndpoints: [],
    jwtTokens: [],
    frameworks: [],
    cloudProbes: [],
    reconLog: [],
    attackChains: [
      { id: 'c-1', name: 'OAuth → admin', severity: 'critical', confidence: 0.9, exploitability: 'trivial', steps: [{ step: 1, findingType: 'oauth', endpoint: '/oauth', evidenceRef: 'r', description: '?' }], narrative: 'n' } as any,
    ],
    coverage: [],
  } as AppModel;
}

describe('generateFindingTests', () => {
  it('generates config + fixture + specs for each finding', () => {
    const result = generateFindingTests(makeModel(), { outDir: 'playwright-tests', includeChainTests: true });
    expect(result.findingsWritten).toBe(2);
    expect(result.chainsWritten).toBe(1);
    const paths = result.files.map(f => f.path);
    expect(paths).toContain('playwright.config.ts');
    expect(paths).toContain('fixtures/findings.ts');
    expect(paths).toContain('fixtures/auth.ts');
    expect(paths.some(p => p.endsWith('attack-f-1.spec.ts'))).toBe(true);
    expect(paths.some(p => p.endsWith('attack-f-2.spec.ts'))).toBe(true);
    expect(paths.some(p => p.endsWith('chain-c-1.spec.ts'))).toBe(true);
  });

  it('writes files to disk', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-tests-'));
    const result = generateFindingTests(makeModel(), { outDir: tmp, includeChainTests: true });
    const written = writeFindingTests(result, '');
    expect(written.length).toBe(6);
    expect(fs.existsSync(written[0])).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('spec file is valid Playwright code', () => {
    const result = generateFindingTests(makeModel(), { outDir: 'playwright-tests' });
    const spec = result.files.find(f => f.path === 'attack-f-1.spec.ts')!;
    expect(spec.content).toContain(`import { test, expect } from '@playwright/test'`);
    expect(spec.content).toContain('test.describe(');
    expect(spec.content).toContain('test(');
  });

  it('skips chain tests when not requested', () => {
    const result = generateFindingTests(makeModel(), { outDir: 'playwright-tests', includeChainTests: false });
    expect(result.chainsWritten).toBe(0);
    expect(result.files.some(f => f.path.includes('chain-'))).toBe(false);
  });

  it('writes all files to the same outDir without double-nesting', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-tests-nest-'));
    const result = generateFindingTests(makeModel(), { outDir: tmp, includeChainTests: true });
    const written = writeFindingTests(result, tmp);
    // All written files should be DIRECT children of tmp, not nested deeper
    for (const f of written) {
      const rel = path.relative(tmp, f);
      const parts = rel.split(path.sep);
      // At most one level of nesting (fixtures/...) is allowed
      expect(parts.length).toBeLessThanOrEqual(2);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
