import { describe, it, expect } from 'vitest';
import { BrowserSessionManager } from '../../src/core/browser-session';

// Hoisted so the Playwright-integration describe blocks below can reuse
// it (each `describe` in vitest shares module scope, but the original
// Block 9a code declared it inside its own describe — which is fine for
// one block but breaks when we add a second block).
const hasPlaywright = (() => {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
})();

describe('BrowserSessionManager', () => {
  it('should export BrowserSessionManager class', async () => {
    const mod = await import('../../src/core/browser-session');
    expect(mod.BrowserSessionManager).toBeDefined();
  });

  it('should create and manage sessions by ID', async () => {
    const manager = new BrowserSessionManager();
    expect(manager.listSessions()).toEqual([]);
    manager.closeAll();
  });

  it('should close a specific session', async () => {
    const manager = new BrowserSessionManager();
    manager.close('nonexistent');
    expect(manager.listSessions()).toEqual([]);
    manager.closeAll();
  });

  it('should close all sessions', async () => {
    const manager = new BrowserSessionManager();
    manager.closeAll();
    expect(manager.listSessions()).toEqual([]);
  });
});

// Block 9e: lastUrl tracking + auto-recovery. The lastUrls map lives
// outside SessionState so it survives close() — that is what makes
// getOrCreate() able to reopen a session to the URL the user was on
// instead of leaving the page on about:blank. These unit tests cover
// the map-level API without spinning up a real browser.
describe('Block 9e: lastUrl tracking (no browser required)', () => {
  it('getLastUrl returns undefined for an unknown session', () => {
    const m = new BrowserSessionManager();
    expect(m.getLastUrl('does-not-exist')).toBeUndefined();
  });

  it('clearLastUrl is a safe no-op for an unknown session', () => {
    const m = new BrowserSessionManager();
    m.clearLastUrl('does-not-exist');
    expect(m.getLastUrl('does-not-exist')).toBeUndefined();
  });

  it('close() preserves lastUrl — this is the whole point of recovery', () => {
    const m = new BrowserSessionManager();
    // We can't easily call navigate() without a real browser, so seed
    // the map directly via reflection on the same private field. (We
    // test the public-facing behavior in the integration tests below.)
    (m as unknown as { lastUrls: Map<string, string> }).lastUrls.set('manual', 'https://example.com/page');
    m.close('manual');
    expect(m.getLastUrl('manual')).toBe('https://example.com/page');
  });

  it('closeAll() drops the lastUrl memory (full reset)', () => {
    const m = new BrowserSessionManager();
    const map = (m as unknown as { lastUrls: Map<string, string> }).lastUrls;
    map.set('a', 'https://a.com');
    map.set('b', 'https://b.com');
    m.closeAll();
    expect(m.getLastUrl('a')).toBeUndefined();
    expect(m.getLastUrl('b')).toBeUndefined();
  });
});

// Block 9a/9c.1: __name shim for tsx/esbuild keepNames. These tests run a
// real Playwright browser via BrowserSessionManager. They will be skipped
// automatically if Playwright is unavailable in the test environment.
//
// Block 9c.1 changed the shim from page.addInitScript to
// context.addInitScript so the shim is available on the initial
// about:blank page WITHOUT any prior navigation. The tests below now
// exercise that property directly (no goto needed).
describe('Block 9a/9c.1: __name shim (Playwright integration)', () => {
  it.skipIf(!hasPlaywright)('installs __name global on the initial page (no navigation needed)', async () => {
    const manager = new BrowserSessionManager(true); // headless=true for tests
    try {
      const page = await manager.getOrCreate('shim-test-1');
      // Block 9c.1: context.addInitScript fires for the initial about:blank
      // document, so __name is available immediately. No page.goto required.
      const t = await page.evaluate(() => typeof (globalThis as any).__name);
      expect(t).toBe('function');
    } finally {
      manager.closeAll();
    }
  }, 30_000);

  it.skipIf(!hasPlaywright)('__name shim is a no-op pass-through', async () => {
    const manager = new BrowserSessionManager(true);
    try {
      const page = await manager.getOrCreate('shim-test-2');
      const result = await page.evaluate(() => {
        const f = () => 42;
        // Real esbuild helper does: __name(f, "f") -> f. Our shim does the same.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__name(f, 'f')();
      });
      expect(result).toBe(42);
    } finally {
      manager.closeAll();
    }
  }, 30_000);

  it.skipIf(!hasPlaywright)('shim is available before any navigation (initial about:blank)', async () => {
    // Regression test for the scanInteractive crash: page.evaluate with
    // a typed-arrow containing a named function used to throw
    // "ReferenceError: __name is not defined" because page.addInitScript
    // only runs on navigations AFTER it's added. With context.addInitScript
    // the shim is present on the very first document.
    const manager = new BrowserSessionManager(true);
    try {
      const page = await manager.getOrCreate('shim-test-3');
      // Simulate the tsx-transpiled shape: a typed arrow with a named
      // function inside. Without the shim this throws on the __name call.
      const result = await page.evaluate(() => {
        // The transpiled code is the literal `__name(fn, "name")` call.
        // We assert it executes without ReferenceError and returns 7.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const __name = (globalThis as any).__name;
        const fn = () => 7;
        return __name(fn, 'fn')();
      });
      expect(result).toBe(7);
    } finally {
      manager.closeAll();
    }
  }, 30_000);
});

// Block 9e: auto-recover to last URL after manual browser close. The
// user reported that closing the browser window by hand leaves the next
// primitive call sitting on an about:blank page. The fix: lastUrls map
// survives close(), and the recreate path in getOrCreate() auto-navigates
// back to the remembered URL. The integration tests below use example.com
// as a stable, bot-detection-free target.
describe('Block 9e: auto-recover to last URL after manual close (Playwright integration)', () => {
  it.skipIf(!hasPlaywright)('fresh session with no lastUrl stays on about:blank (no regression)', async () => {
    const manager = new BrowserSessionManager(true);
    try {
      const page = await manager.getOrCreate('fresh-session-1');
      // No prior navigate() call → lastUrls has no entry → no auto-navigate.
      // Page should still be on about:blank.
      expect(page.url()).toBe('about:blank');
      expect(manager.getLastUrl('fresh-session-1')).toBeUndefined();
    } finally {
      manager.closeAll();
    }
  }, 30_000);

  it.skipIf(!hasPlaywright)('navigate() sets lastUrl, close() preserves it, next getOrCreate recovers', async () => {
    const manager = new BrowserSessionManager(true);
    try {
      // 1. Create a session and navigate to a real, stable URL.
      await manager.navigate('recover-1', 'https://example.com/');
      // example.com may redirect (it currently 302s to https://www.iana.org/help/example-domains
      // or similar); the manager tracks the final URL.
      const lastAfterNav = manager.getLastUrl('recover-1');
      expect(lastAfterNav).toBeDefined();
      expect(lastAfterNav).not.toBe('about:blank');
      expect(lastAfterNav).toMatch(/^https:\/\//);

      // 2. Close the session (simulates the user closing the browser
      //    window manually). The browser/context/page are torn down, but
      //    the lastUrl must survive — that is the whole bug fix.
      await manager.close('recover-1');
      expect(manager.getLastUrl('recover-1')).toBe(lastAfterNav);

      // 3. Re-create the session. The new about:blank page should
      //    auto-navigate back to the last URL.
      const page2 = await manager.getOrCreate('recover-1');
      // Give the auto-navigate a moment to settle.
      try { await page2.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch { /* best effort */ }
      const recoveredUrl = page2.url();
      expect(recoveredUrl).not.toBe('about:blank');
      // The recovered URL should match the lastUrl (or its final-URL form
      // after a redirect) — same host at minimum.
      expect(new URL(recoveredUrl).host).toBe(new URL(lastAfterNav!).host);
    } finally {
      manager.closeAll();
    }
  }, 60_000);

  it.skipIf(!hasPlaywright)('clearLastUrl makes the next getOrCreate start on about:blank again', async () => {
    const manager = new BrowserSessionManager(true);
    try {
      await manager.navigate('recover-2', 'https://example.com/');
      expect(manager.getLastUrl('recover-2')).toBeDefined();
      await manager.close('recover-2');
      manager.clearLastUrl('recover-2');
      const page = await manager.getOrCreate('recover-2');
      expect(page.url()).toBe('about:blank');
    } finally {
      manager.closeAll();
    }
  }, 60_000);
});

