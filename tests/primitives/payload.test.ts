import { describe, it, expect } from 'vitest';
import {
  craftPayload,
  craftBypass,
  craftXmlEntity,
  craftMultipart,
} from '../../src/primitives/payload';

describe('craftPayload', () => {
  it('returns empty array (LLM crafts payloads inline now)', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftPayload.execute({ type: 'sqli', context: 'url' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.value).toBeInstanceOf(Array);
    expect((r.value as string[]).length).toBe(0);
  });

  it('returns empty array regardless of type', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftPayload.execute({ type: 'xss', context: 'html' }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as string[]).length).toBe(0);
  });

  it('ignores count limit', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftPayload.execute({ type: 'sqli', context: 'url', count: 3 }, ctx);
    expect((r.value as string[]).length).toBe(0);
  });
});

describe('craftBypass', () => {
  it('produces multiple variants of a payload', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftBypass.execute({ payload: '<script>alert(1)</script>', wafType: 'cloudflare' }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as string[]).length).toBeGreaterThan(1);
  });

  it('includes url-encoded variant', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftBypass.execute({ payload: 'OR 1=1', wafType: 'modsecurity' }, ctx);
    const v = r.value as string[];
    expect(v.some((p) => p.includes('%'))).toBe(true);
  });
});

describe('craftXmlEntity', () => {
  it('wraps LLM payload in XML structure', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftXmlEntity.execute({ payload: 'file:///etc/passwd' }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as string).includes('file:///etc/passwd')).toBe(true);
    expect((r.value as string).includes('<!ENTITY xxe SYSTEM "file:///etc/passwd"')).toBe(true);
  });

  it('supports custom entity name', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftXmlEntity.execute({ payload: 'http://169.254.169.254/', systemId: 'ssrf' }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as string).includes('169.254.169.254')).toBe(true);
    expect((r.value as string).includes('<!ENTITY ssrf SYSTEM "http://169.254.169.254/"')).toBe(true);
  });
});

describe('craftMultipart', () => {
  it('builds multipart body with boundary', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftMultipart.execute({ filename: 'test.txt', content: 'hello' }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as any).contentType.includes('boundary=')).toBe(true);
    expect((r.value as any).body.toString().includes('test.txt')).toBe(true);
  });

  it('handles path traversal in filename', () => {
    const ctx = { baseUrl: '', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: 0, maxMs: 0 } };
    const r = craftMultipart.execute({ filename: '../../etc/passwd', content: 'x' }, ctx);
    expect((r.value as any).body.toString().includes('../../etc/passwd')).toBe(true);
  });
});
