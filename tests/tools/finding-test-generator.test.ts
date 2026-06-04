// tests/tools/finding-test-generator.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateFindingTests, writeFindingTests } from '../../src/tools/finding-test-generator';
import type { AppModel, AppModelFinding, AttackChain } from '../../src/core/app-model';
import type { MacroStep } from '../../src/core/browser-session';

function makeModel(overrides: Partial<AppModel> = {}): AppModel {
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
    recordedSessions: {},
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
    ...overrides,
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

  it('does NOT generate user-flow.spec.ts when no spider recording exists', () => {
    const result = generateFindingTests(makeModel(), { outDir: 'playwright-tests' });
    expect(result.userFlowsWritten).toBe(0);
    expect(result.files.some(f => f.path === 'user-flow.spec.ts')).toBe(false);
  });

  it('generates user-flow.spec.ts from spider-auto recording', () => {
    const steps: MacroStep[] = [
      { type: 'navigate', url: 'http://x.com' },
      { type: 'navigate', url: 'http://x.com/login' },
      { type: 'fill', selector: 'input[name="email"]', value: 'admin@x.com' },
      { type: 'fill', selector: 'input[name="password"]', value: 'super-secret-123' },
      { type: 'click', selector: 'button[type="submit"]' },
      { type: 'navigate', url: 'http://x.com/dashboard' },
    ];
    const result = generateFindingTests(
      makeModel({ recordedSessions: { 'spider-auto': steps } }),
      { outDir: 'playwright-tests' },
    );
    expect(result.userFlowsWritten).toBe(1);
    const flow = result.files.find(f => f.path === 'user-flow.spec.ts');
    expect(flow).toBeDefined();
    expect(flow!.type).toBe('user-flow');
    // Spot-check the content
    expect(flow!.content).toContain(`import { test, expect } from '@playwright/test'`);
    expect(flow!.content).toContain('test.describe(\'User Flow');
    expect(flow!.content).toContain(`await page.goto('http://x.com/login')`);
    expect(flow!.content).toContain(`await page.locator('input[name=\"password\"]').fill('••••••••')`); // password masked
    expect(flow!.content).toContain(`await page.locator('input[name=\"email\"]').fill('admin@x.com')`); // non-password NOT masked
    expect(flow!.content).toContain(`// Submit form`); // fill + click grouped
    expect(flow!.content).toContain(`await page.locator('button[type=\"submit\"]').click()`);
    expect(flow!.content).toContain(`await page.goto('http://x.com/dashboard')`);
  });

  it('deduplicates consecutive navigate-to-same-URL in user-flow', () => {
    const steps: MacroStep[] = [
      { type: 'navigate', url: 'http://x.com' },
      { type: 'navigate', url: 'http://x.com' },
      { type: 'navigate', url: 'http://x.com/about' },
      { type: 'navigate', url: 'http://x.com/about' },
      { type: 'navigate', url: 'http://x.com/contact' },
    ];
    const result = generateFindingTests(
      makeModel({ recordedSessions: { 'spider-auto': steps } }),
      { outDir: 'playwright-tests' },
    );
    const flow = result.files.find(f => f.path === 'user-flow.spec.ts')!;
    // Should mention 3 unique URLs, not 5
    expect(flow.content).toContain(`await page.goto('http://x.com');`);
    expect(flow.content).toContain(`await page.goto('http://x.com/about');`);
    expect(flow.content).toContain(`await page.goto('http://x.com/contact');`);
    // The comment header should say "3 step(s)" not "5"
    expect(flow.content).toMatch(/3 step\(s\) replayed/);
  });

  it('can opt out of user-flow with includeUserFlow: false', () => {
    const steps: MacroStep[] = [{ type: 'navigate', url: 'http://x.com' }];
    const result = generateFindingTests(
      makeModel({ recordedSessions: { 'spider-auto': steps } }),
      { outDir: 'playwright-tests', includeUserFlow: false },
    );
    expect(result.userFlowsWritten).toBe(0);
    expect(result.files.some(f => f.path === 'user-flow.spec.ts')).toBe(false);
  });

  it('uses frameLocator for selectors inside an iframe (cross-frame form)', () => {
    const steps: MacroStep[] = [
      { type: 'navigate', url: 'http://x.com' },
      { type: 'navigate', url: 'http://x.com/level1' },
      { type: 'fill', selector: 'iframe form:nth-of-type(1) [name="query"]', value: 'replay-test' },
      { type: 'click', selector: 'iframe input:nth-of-type(2)' },
      { type: 'navigate', url: 'http://x.com/dashboard' },
    ];
    const result = generateFindingTests(
      makeModel({ recordedSessions: { 'spider-auto': steps } }),
      { outDir: 'playwright-tests' },
    );
    const flow = result.files.find(f => f.path === 'user-flow.spec.ts')!;
    // Should declare a frameLocator for 'iframe'
    expect(flow.content).toMatch(/const iframe_1 = page\.frameLocator\('iframe'\);/);
    // Fill should chain iframe_1.first().locator(...).fill(...)
    expect(flow.content).toMatch(/await iframe_1\.first\(\)\.locator\('form:nth-of-type\(1\) \[name="query"\]'\)\.fill\('replay-test'\)/);
    // Click should chain iframe_1.first().locator(...).click()
    expect(flow.content).toMatch(/await iframe_1\.first\(\)\.locator\('input:nth-of-type\(2\)'\)\.click\(\)/);
    // Should NOT have the raw 'iframe form...' selector on page
    expect(flow.content).not.toMatch(/await page\.locator\('iframe /);
    expect(flow.content).not.toMatch(/await page\.fill\('iframe /);
  });
});

