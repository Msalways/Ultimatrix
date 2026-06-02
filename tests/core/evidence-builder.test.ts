/**
 * tests/core/evidence-builder.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceBuilder } from '../../src/core/evidence-builder';
import type { SessionDiff } from '../../src/core/session-pool';

describe('EvidenceBuilder', () => {
  let b: EvidenceBuilder;

  beforeEach(() => {
    b = new EvidenceBuilder({ maxBytes: 200 });
  });

  it('text() builds a text-type evidence', () => {
    const ev = b.text('<script>alert(1)</script>', 'XSS payload reflected in body', 'user-a');
    expect(ev.type).toBe('text');
    expect(ev.data).toBe('<script>alert(1)</script>');
    expect(ev.label).toBe('XSS payload reflected in body');
    expect(ev.session).toBe('user-a');
  });

  it('screenshot() records the path', () => {
    const ev = b.screenshot('/tmp/shot.png', 'login page after attempt', 'user-a');
    expect(ev.type).toBe('screenshot');
    expect(ev.data).toBe('/tmp/shot.png');
  });

  it('truncates long bodies to maxBytes', () => {
    const long = 'A'.repeat(1000);
    const ev = b.rawResponse(long, 'long body');
    expect(ev.data.length).toBeLessThan(1000);
    expect(ev.data).toContain('[truncated');
  });

  it('applies redaction when configured', () => {
    const b2 = new EvidenceBuilder({
      redact: (s) => s.replace(/password=\w+/g, 'password=••••'),
    });
    const ev = b2.text('user&password=secret123&x=1', 'login form', 'user-a');
    expect(ev.data).toBe('user&password=••••&x=1');
  });

  it('sessionDiff emits summary + both side bodies', () => {
    const diff: SessionDiff = {
      sessionA: { id: 'a', label: 'user-a', role: 'user', status: 200, body: '{"owner":"alice"}', headers: {}, bodyLength: 16, cookiesSent: 1 },
      sessionB: { id: 'b', label: 'user-b', role: 'user', status: 200, body: '{"owner":"bob"}', headers: {}, bodyLength: 14, cookiesSent: 1 },
      statusMatch: true,
      bodyEqual: false,
      bodyLengthDiff: 2,
      leakDetected: true,
      notes: ['Different bodies with matching 200 status — possible cross-user data leak'],
    };
    const evs = b.sessionDiff(diff, 'IDOR check /api/v1/vehicles/1');
    expect(evs.length).toBe(3);
    expect(evs[0].type).toBe('text');
    expect(evs[0].data).toContain('user-a');
    expect(evs[0].data).toContain('user-b');
    expect(evs[0].data).toContain('cross-user data leak');
    expect(evs[1].data).toBe('{"owner":"alice"}');
    expect(evs[2].data).toBe('{"owner":"bob"}');
  });

  it('withSession adds a session field if missing', () => {
    const ev = b.text('evidence without session', 'no session');
    expect((ev as any).session).toBeUndefined();
    const tagged = b.withSession(ev, 'user-a');
    expect(tagged.session).toBe('user-a');
  });

  it('domExcerpt stores rendered DOM text as raw_response with dom label', () => {
    const ev = b.domExcerpt('"XSS-game Level 1 hint: This level is a simple reflection"', 'on-screen hint captured', 'anon');
    expect(ev.data).toContain('XSS-game Level 1 hint');
  });
});
