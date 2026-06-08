import type { PrimitiveContext, PrimitiveResult } from '../primitives/types';
import type { Plugin, PluginPrimitiveDefinition, PluginHooks } from './types';

type HookName = keyof PluginHooks;

export interface PrimitivePluginRegistry {
  getPrimitive(name: string): PluginPrimitiveDefinition | undefined;
  hasPrimitive(name: string): boolean;
  listPrimitives(): string[];
  executePrimitive<N = unknown>(name: string, args: unknown, ctx: PrimitiveContext): Promise<PrimitiveResult<N>>;
  registerPlugin(plugin: Plugin): void;
  removePlugin(name: string): void;
  applyHooks(hook: HookName, ...args: Parameters<Required<PluginHooks>[HookName]>): Promise<void>;
}

let globalRegistry: PrimitivePluginRegistryImpl | null = null;

export function getGlobalRegistry(): PrimitivePluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PrimitivePluginRegistryImpl();
  }
  return globalRegistry;
}

export function resetGlobalRegistry(): void {
  globalRegistry = null;
}

class PrimitivePluginRegistryImpl implements PrimitivePluginRegistry {
  private plugins = new Map<string, Plugin>();
  private primitives = new Map<string, PluginPrimitiveDefinition>();
  private hookQueues: Map<HookName, Array<(...args: unknown[]) => unknown | Promise<unknown>>> = new Map();

  getPrimitive(name: string): PluginPrimitiveDefinition | undefined {
    return this.primitives.get(name);
  }

  hasPrimitive(name: string): boolean {
    return this.primitives.has(name);
  }

  listPrimitives(): string[] {
    return Array.from(this.primitives.keys());
  }

  async executePrimitive<N = unknown>(name: string, args: unknown, ctx: PrimitiveContext): Promise<PrimitiveResult<N>> {
    const prim = this.primitives.get(name);
    if (!prim) {
      return { ok: false, error: `unknown primitive "${name}"`, durationMs: 0 };
    }
    await this.applyHooks('beforePrimitive', name, args, ctx);
    const t0 = Date.now();
    let result: PrimitiveResult;
    try {
      result = await Promise.resolve(prim.execute(args, ctx));
    } catch (e) {
      result = { ok: false, error: (e as Error).message, durationMs: Date.now() - t0 };
    }
    if (typeof result.durationMs !== 'number') {
      result.durationMs = Date.now() - t0;
    }
    await this.applyHooks('afterPrimitive', name, args, result, ctx);
    return result as PrimitiveResult<N>;
  }

  registerPlugin(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      this.removePlugin(plugin.name);
    }
    this.plugins.set(plugin.name, plugin);
    for (const [pName, pDef] of Object.entries(plugin.primitives)) {
      this.primitives.set(pName, pDef);
    }
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        const hk = hookName as HookName;
        if (!this.hookQueues.has(hk)) {
          this.hookQueues.set(hk, []);
        }
        this.hookQueues.get(hk)!.push(handler as (...args: unknown[]) => unknown);
      }
    }
  }

  removePlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    this.plugins.delete(name);
    for (const pName of Object.keys(plugin.primitives)) {
      this.primitives.delete(pName);
    }
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        const hk = hookName as HookName;
        const queue = this.hookQueues.get(hk);
        if (queue) {
          const idx = queue.indexOf(handler as (...args: unknown[]) => unknown);
          if (idx >= 0) queue.splice(idx, 1);
        }
      }
    }
  }

  async applyHooks(hook: HookName, ...args: Parameters<Required<PluginHooks>[HookName]>): Promise<void> {
    const queue = this.hookQueues.get(hook);
    if (!queue || queue.length === 0) return;
    for (const handler of queue) {
      try {
        await Promise.resolve((handler as (...args: unknown[]) => unknown)(...args));
      } catch {
        // never let a hook break the hunt
      }
    }
  }
}
