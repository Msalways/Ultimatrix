// tests/cli/url-label.test.ts
import { describe, it, expect } from 'vitest';
import { deriveShortUrlLabel } from '../../src/cli/url-label';

describe('deriveShortUrlLabel', () => {
  it('derives host-path label from typical https URL', () => {
    expect(deriveShortUrlLabel('https://xss-game.appspot.com/level1/frame?query=Enter+query+here'))
      .toBe('xss-game-appspot-com-level1-frame');
  });

  it('drops the query string and fragment', () => {
    const out = deriveShortUrlLabel('https://x.com/a/b?evil=alert(1)#frag');
    expect(out).toBe('x-com-a-b');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('frag');
  });

  it('converts port to a port-N suffix', () => {
    expect(deriveShortUrlLabel('http://localhost:3000/api/v1/users'))
      .toBe('localhost-3000-api-v1-users');
  });

  it('handles URL with no path', () => {
    expect(deriveShortUrlLabel('https://x.com/')).toBe('x-com');
    expect(deriveShortUrlLabel('https://x.com')).toBe('x-com');
  });

  it('returns "target" for invalid input', () => {
    expect(deriveShortUrlLabel('not-a-url')).toBe('target');
    expect(deriveShortUrlLabel('')).toBe('target');
  });

  it('lowercases and collapses non-alphanumerics to dashes', () => {
    expect(deriveShortUrlLabel('https://X.COM/Path_With_Underscores/x.y'))
      .toBe('x-com-path-with-underscores-x-y');
  });

  it('trims leading and trailing dashes', () => {
    expect(deriveShortUrlLabel('https://x.com/---foo---'))
      .toBe('x-com-foo');
  });

  it('caps the result at 60 characters', () => {
    const longPath = '/a'.repeat(100);
    const out = deriveShortUrlLabel(`https://x.com${longPath}`);
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('reproduces the exact bad input from the user bug report', () => {
    // The user's seed URL was:
    //   https://xss-game.appspot.com/level1/frame?query=Enter+query+here...
    // The literal "..." in the URL previously leaked into the test name.
    const out = deriveShortUrlLabel('https://xss-game.appspot.com/level1/frame?query=Enter+query+here...');
    expect(out).toBe('xss-game-appspot-com-level1-frame');
    expect(out).not.toContain('...');
    expect(out).not.toContain('Enter');
  });
});
