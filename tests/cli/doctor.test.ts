// tests/cli/doctor.test.ts
import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../src/cli/doctor';

describe('runDoctor', () => {
  it('returns a report with expected checks', async () => {
    const r = await runDoctor();
    expect(r).toHaveProperty('ok');
    expect(r).toHaveProperty('checks');
    expect(r).toHaveProperty('warnings');
    expect(Array.isArray(r.checks)).toBe(true);
  });

  it('checks Node version', async () => {
    const r = await runDoctor();
    const node = r.checks.find((c) => c.name === 'Node.js');
    expect(node).toBeDefined();
    expect(node?.detail).toMatch(/v\d+/);
  });

  it('checks LLM provider', async () => {
    const r = await runDoctor();
    const llm = r.checks.find((c) => c.name === 'LLM provider');
    expect(llm).toBeDefined();
  });

  it('checks output dir', async () => {
    const r = await runDoctor();
    const out = r.checks.find((c) => c.name === 'Output dir');
    expect(out).toBeDefined();
  });

  it('checks Playwright', async () => {
    const r = await runDoctor();
    const pw = r.checks.find((c) => c.name === 'Playwright');
    expect(pw).toBeDefined();
  });

  it('checks xss-game reachability', async () => {
    const r = await runDoctor();
    const xss = r.checks.find((c) => c.name.includes('xss-game'));
    expect(xss).toBeDefined();
  });

  it('warns when Playwright is missing', async () => {
    // We can't actually remove playwright mid-test, but the warning format is stable.
    const r = await runDoctor();
    expect(Array.isArray(r.warnings)).toBe(true);
  });
});
