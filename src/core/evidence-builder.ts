/**
 * src/core/evidence-builder.ts
 *
 * Builds FindingEvidence records with session attribution. Each finding
 * card should answer "which session found this, what did it see, and how
 * does that compare to other sessions?" — that's the whole point of the
 * multi-session rebuild.
 *
 * Evidence kinds:
 *   - text: a verbatim quote from a response body
 *   - screenshot: a path to a captured PNG of a rendered page
 *   - har_entry: a single request/response from a session's network log
 *   - raw_request: full request as sent
 *   - raw_response: full response body
 *   - session_diff: side-by-side body comparison across two sessions
 *   - dom_excerpt: a snippet of rendered DOM text (so reviewers see what
 *     the worker saw, including on-screen hints)
 *
 * All evidence is session-attributed: every FindingEvidence has a
 * `session` field showing which session it came from.
 */

import type { FindingEvidence } from './app-model';
import type { SessionDiff, DiffResponseSide } from './session-pool';

export interface SessionEvidenceInput {
  type: FindingEvidence['type'] | 'session_diff' | 'dom_excerpt';
  data: string;
  label: string;
  session?: string;
  timestamp?: number;
  sideA?: DiffResponseSide;
  sideB?: DiffResponseSide;
}

export interface EvidenceBuildOptions {
  redact?: (s: string) => string;
  maxBytes?: number;
  includeNetworkLog?: boolean;
}

const DEFAULT_MAX_BYTES = 8192;

function safeTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated ${s.length - max} bytes]`;
}

export class EvidenceBuilder {
  private redact?: (s: string) => string;
  private maxBytes: number;

  constructor(opts: EvidenceBuildOptions = {}) {
    this.redact = opts.redact;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  text(quote: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'text',
      data: this.process(quote),
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  screenshot(path: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'screenshot',
      data: path,
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  harEntry(rawEntry: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'har_entry',
      data: safeTruncate(this.process(rawEntry), this.maxBytes),
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  rawRequest(raw: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'raw_request',
      data: safeTruncate(this.process(raw), this.maxBytes),
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  rawResponse(raw: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'raw_response',
      data: safeTruncate(this.process(raw), this.maxBytes),
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  domExcerpt(excerpt: string, label: string, session?: string): FindingEvidence {
    return {
      type: 'raw_response',
      data: safeTruncate(this.process(excerpt), this.maxBytes),
      label,
      timestamp: Date.now(),
      ...(session ? { session } : {}),
    };
  }

  /**
   * Convert a SessionDiff into a list of evidence items: one summary text
   * item, plus optional raw bodies from each side. The summary describes
   * what the diff found (IDOR / 401 / static response) so reviewers
   * understand without reading JSON.
   */
  sessionDiff(diff: SessionDiff, label: string): FindingEvidence[] {
    const out: FindingEvidence[] = [];
    const summary = [
      `Session "${diff.sessionA.label}" (${diff.sessionA.role}): ${diff.sessionA.status}, ${diff.sessionA.bodyLength} bytes, ${diff.sessionA.cookiesSent} cookies sent`,
      `Session "${diff.sessionB.label}" (${diff.sessionB.role}): ${diff.sessionB.status}, ${diff.sessionB.bodyLength} bytes, ${diff.sessionB.cookiesSent} cookies sent`,
      `Status match: ${diff.statusMatch}; body equal: ${diff.bodyEqual}; body length diff: ${diff.bodyLengthDiff}`,
      ...diff.notes.map((n) => `Note: ${n}`),
    ].join('\n');
    out.push({
      type: 'text',
      data: summary,
      label,
      timestamp: Date.now(),
    });
    out.push({
      type: 'raw_response',
      data: safeTruncate(this.process(diff.sessionA.body), this.maxBytes),
      label: `${label} — body of "${diff.sessionA.label}"`,
      timestamp: Date.now(),
    });
    out.push({
      type: 'raw_response',
      data: safeTruncate(this.process(diff.sessionB.body), this.maxBytes),
      label: `${label} — body of "${diff.sessionB.label}"`,
      timestamp: Date.now(),
    });
    return out;
  }

  /**
   * Convenience: take any session-attributed FindingEvidence and ensure
   * it has a session field. Used when workers add evidence from various
   * sources and we want a uniform shape before persisting.
   */
  withSession(ev: FindingEvidence, session: string): FindingEvidence {
    return { ...ev, session };
  }

  private process(s: string): string {
    if (this.redact) return this.redact(s);
    return s;
  }
}
