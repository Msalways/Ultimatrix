import type { AppModelFinding } from '../core/app-model';
import type { PrimitiveContext, PrimitiveResult, PrimitiveDefinition } from '../primitives/types';

export type PluginPrimitiveDefinition = PrimitiveDefinition;

export interface PluginHooks {
  beforePrimitive?: (name: string, args: unknown, ctx: PrimitiveContext) => void | Promise<void>;
  afterPrimitive?: (name: string, args: unknown, result: PrimitiveResult, ctx: PrimitiveContext) => void | Promise<void>;
  onFinding?: (finding: AppModelFinding) => void | Promise<void>;
}

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  primitives: Record<string, PluginPrimitiveDefinition>;
  hooks?: PluginHooks;
}
