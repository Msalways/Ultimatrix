// tests/core/attack-chain.test.ts
import { describe, it, expect } from 'vitest';
import { runHeuristicChains, runChainEngine } from '../../src/core/attack-chain';
import type { AppModelFinding } from '../../src/core/app-model';
import { writeAppModelAsync, DEFAULT_MODEL, readAppModel } from '../../src/core/app-model';
import { makeTempModelPath, cleanup } from '../recon/recon-helpers';

function makeFinding(overrides: Partial<AppModelFinding> = {}): AppModelFinding {
  return {
    type: 'xss',
    endpoint: 'http://x.com/api',
    param: 'q',
    evidence: [{ type: 'text', data: 'test evidence', label: 'finding-1', timestamp: Date.now() }],
    confidence: 'medium',
    confirmed: true,
    severity: 'medium',
    ...overrides,
  };
}

describe('runHeuristicChains', () => {
  it('returns no chains for empty findings', () => {
    expect(runHeuristicChains([])).toEqual([]);
  });

  it('detects SSRF + cloud-metadata chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'ssrf', endpoint: 'http://x.com/api/preview' }),
      makeFinding({ type: 'cloud-metadata-leak', endpoint: 'http://169.254.169.254' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('SSRF');
    expect(chains[0].severity).toBe('critical');
    expect(chains[0].steps.length).toBe(2);
  });

  it('detects JWT alg-none + broken-authz chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'jwt-alg-none', endpoint: 'http://x.com/api' }),
      makeFinding({ type: 'broken-function-level-authz', endpoint: 'http://x.com/admin' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('JWT');
    expect(chains[0].severity).toBe('critical');
  });

  it('detects OAuth redirect-bypass + IDOR chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'oauth-redirect-uri-bypass', endpoint: 'http://x.com/oauth/authorize' }),
      makeFinding({ type: 'idor', endpoint: 'http://x.com/api/users/1' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('OAuth');
  });

  it('detects GraphQL introspection + field-authz chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'graphql-introspection', endpoint: 'http://x.com/graphql' }),
      makeFinding({ type: 'graphql-field-authz', endpoint: 'http://x.com/graphql' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('GraphQL');
  });

  it('detects file upload RCE chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'file-upload-content-type-bypass', endpoint: 'http://x.com/api/upload' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('upload');
    expect(chains[0].severity).toBe('critical');
  });

  it('detects SSTI RCE chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'ssti-jinja2', endpoint: 'http://x.com/api/render' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('SSTI');
  });

  it('detects race condition chain', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'race-condition', endpoint: 'http://x.com/api/transfer' }),
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].name).toContain('Race');
    expect(chains[0].severity).toBe('high');
  });

  it('respects minSeverity threshold', () => {
    const chains = runHeuristicChains([
      makeFinding({ type: 'race-condition', endpoint: 'http://x.com/api/transfer' }),
    ], 'critical');
    // race chain is high severity, so should be filtered out at critical threshold
    expect(chains.length).toBe(0);
  });

  it('writes chains to the app-model', async () => {
    const p = await makeTempModelPath();
    try {
      await writeAppModelAsync(p, {
        ...DEFAULT_MODEL,
        target: 'http://x.com',
        findings: [
          makeFinding({ type: 'ssrf', endpoint: 'http://x.com/api/preview' }),
          makeFinding({ type: 'cloud-metadata-leak', endpoint: 'http://169.254.169.254' }),
        ],
      });
      const result = await runChainEngine({
        findings: [],
        appModel: readAppModel(p),
        appModelPath: p,
        mode: 'heuristic',
      });
      // need to pass findings
      const result2 = await runChainEngine({
        findings: [
          makeFinding({ type: 'ssrf', endpoint: 'http://x.com/api/preview' }),
          makeFinding({ type: 'cloud-metadata-leak', endpoint: 'http://169.254.169.254' }),
        ],
        appModel: readAppModel(p),
        appModelPath: p,
        mode: 'heuristic',
      });
      expect(result2.chains.length).toBe(1);
      const model = readAppModel(p);
      expect(model.attackChains.length).toBe(1);
    } finally {
      await cleanup(p);
    }
  });
});
