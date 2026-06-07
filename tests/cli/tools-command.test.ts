// tests/cli/tools-command.test.ts
//
// The `ultimatrix tools` subcommand is a thin wrapper that prints:
//   - 22 primitive names from PRIMITIVE_LIST (with category filter)
//   - 9 specialist names from ALL_SPECIALISTS_V2
//   - 5 OOB categories from OOB_CATEGORIES
//
// We don't spawn commander to test it (would require stubbing stdin/stdout);
// we just verify the data sources are present and stable. If this file
// breaks, the `tools` command's printout will be wrong.

import { describe, it, expect } from 'vitest';
import { PRIMITIVE_LIST } from '../../src/primitives';
import { ALL_SPECIALISTS_V2 } from '../../src/agents/specialists-v2';
import { OOB_CATEGORIES } from '../../src/oast/categories';

describe('`ultimatrix tools` data sources', () => {
  it('exposes exactly 23 primitives (matches README + RECENT CHANGES)', () => {
    expect(PRIMITIVE_LIST).toHaveLength(23);
  });
  it('includes the new recordTestStep primitive from Block 9b.1', () => {
    expect(PRIMITIVE_LIST).toContain('recordTestStep');
  });
  it('includes the new spiderCrawl primitive from Block 12', () => {
    expect(PRIMITIVE_LIST).toContain('spiderCrawl');
  });
  it('includes the original 21 primitives', () => {
    for (const name of [
      'httpRequest', 'multipartUpload', 'followRedirects',
      'craftPayload', 'craftBypass', 'craftXmlEntity', 'craftMultipart',
      'injectInContext', 'omitHeader', 'parseResponse', 'evaluateRendered',
      'measureTiming', 'compareResponses', 'checkWaf', 'findEndpointsInResponse',
      'extractSessionCookie', 'extractCsrfToken', 'useSession', 'spawnSubtask',
      'recordEvidence', 'writeFinding',
    ]) {
      expect(PRIMITIVE_LIST).toContain(name);
    }
  });
  it('exposes 9 specialists (matches Block 3)', () => {
    expect(ALL_SPECIALISTS_V2).toHaveLength(9);
  });
  it('specialists include the expected names', () => {
    const names = ALL_SPECIALISTS_V2.map((s) => s.name);
    for (const id of ['jwt', 'oauth', 'race', 'graphql', 'idor', 'cloud', 'waf-mutator', 'xss', 'second-order']) {
      expect(names).toContain(id);
    }
  });
  it('exposes 5 OOB categories (matches Block 4)', () => {
    expect(OOB_CATEGORIES).toHaveLength(5);
  });
  it('OOB categories are ssrf, blind-xss, blind-sqli, xxe, deserialization', () => {
    expect([...OOB_CATEGORIES].sort()).toEqual(['blind-sqli', 'blind-xss', 'deserialization', 'ssrf', 'xxe']);
  });
});
