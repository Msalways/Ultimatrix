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

// Block 9a: __name shim for tsx/esbuild keepNames. These tests run a real
// Playwright browser via BrowserSessionManager. They will be skipped
// automatically if Playwright is unavailable in the test environment.
describe('Block 9a: __name shim (Playwright integration)', () => {
  const hasPlaywright = (() => {
    try {
      require.resolve('playwright');
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasPlaywright)('installs __name global in every page', async () => {
    const manager = new BrowserSessionManager(true); // headless=true for tests
    try {
      const page = await manager.getOrCreate('shim-test-1');
      // addInitScript runs on every navigation, including the initial about:blank.
      // Trigger an explicit navigation to make sure the script fires.
      await page.goto('about:blank');
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
      await page.goto('about:blank');
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
});

