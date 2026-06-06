import { describe, it, expect } from 'vitest';
import { BrowserSessionManager } from '../../src/core/browser-session';

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

// Block 9a/9c.1: __name shim for tsx/esbuild keepNames. These tests run a
// real Playwright browser via BrowserSessionManager. They will be skipped
// automatically if Playwright is unavailable in the test environment.
//
// Block 9c.1 changed the shim from page.addInitScript to
// context.addInitScript so the shim is available on the initial
// about:blank page WITHOUT any prior navigation. The tests below now
// exercise that property directly (no goto needed).
describe('Block 9a/9c.1: __name shim (Playwright integration)', () => {
  const hasPlaywright = (() => {
    try {
      require.resolve('playwright');
      return true;
    } catch {
      return false;
    }
  })();

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

