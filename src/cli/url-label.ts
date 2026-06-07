// src/cli/url-label.ts
//
// Small pure utility for deriving a short, human-readable label from a URL.
// Used to generate Playwright test names from hunt target URLs so that
// reports stay readable and don't leak user-supplied query strings.

const MAX_TEST_NAME_LABEL_LEN = 60;

/**
 * Derive a short, human-readable label from a URL for use as a test name.
 *
 * Examples:
 *   deriveShortUrlLabel('https://xss-game.appspot.com/level1/frame?query=x')
 *     => 'xss-game-level1-frame'
 *   deriveShortUrlLabel('http://localhost:3000/')
 *     => 'localhost-3000'
 *   deriveShortUrlLabel('not-a-url')
 *     => 'target'
 *
 * The result is sanitized to `[a-z0-9-]`, lowercased, and capped at
 * 60 characters. The query string and fragment are dropped (they often
 * contain the user's own test payload, which would pollute the test name
 * and leak into Playwright reports).
 */
export function deriveShortUrlLabel(rawUrl: string): string {
  if (!rawUrl) return 'target';
  let host = '';
  let pathname = '';
  try {
    const u = new URL(rawUrl);
    // u.host includes the port (e.g. "localhost:3000"), u.hostname doesn't.
    // We want the port in the label so "http://localhost:3000" and
    // "http://localhost:4000" don't collide.
    host = u.host;
    pathname = u.pathname;
  } catch {
    return 'target';
  }
  const combined = (host + pathname).toLowerCase();
  const sanitized = combined.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) return 'target';
  return sanitized.slice(0, MAX_TEST_NAME_LABEL_LEN);
}
