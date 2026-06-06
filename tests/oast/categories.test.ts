// tests/oast/categories.test.ts
import { describe, it, expect } from 'vitest';
import { OOB_CATEGORIES, OOB_TEMPLATES, matchCallback } from '../../src/oast/categories';
import type { OOBProbe } from '../../src/oast/categories';

describe('OOB categories', () => {
  it('has 5 categories', () => {
    expect(OOB_CATEGORIES).toHaveLength(5);
  });

  it('every category has at least one template', () => {
    for (const cat of OOB_CATEGORIES) {
      expect(OOB_TEMPLATES[cat].length).toBeGreaterThan(0);
    }
  });

  it('every template contains {host} and {uuid} placeholders', () => {
    for (const cat of OOB_CATEGORIES) {
      for (const t of OOB_TEMPLATES[cat]) {
        expect(t).toContain('{host}');
        expect(t).toContain('{uuid}');
      }
    }
  });

  it('ssrf templates look like URLs', () => {
    for (const t of OOB_TEMPLATES.ssrf) {
      expect(t).toMatch(/^http:\/\//);
    }
  });

  it('blind-xss templates look like HTML/JS injection', () => {
    for (const t of OOB_TEMPLATES['blind-xss']) {
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('matchCallback finds probes by uuid', () => {
    const probes: OOBProbe[] = [
      { uuid: 'a', url: 'http://x/a', category: 'ssrf', endpoint: '/', param: 'q', payload: 'x', registeredAt: 0 },
      { uuid: 'b', url: 'http://x/b', category: 'blind-xss', endpoint: '/', param: 'q', payload: 'y', registeredAt: 0 },
    ];
    expect(matchCallback('a', probes)).toHaveLength(1);
    expect(matchCallback('b', probes)).toHaveLength(1);
    expect(matchCallback('c', probes)).toHaveLength(0);
  });
});
