// src/agents/specialists-v2/types.ts
//
// Shared types for the 9 specialists. Each specialist is a factory that
// builds an agent descriptor with name, description, systemPrompt, and
// tools. The actual probes and pattern matchers live in the same file
// or in dedicated probe files.

import type { AppModel } from '../../core/app-model';

/** Minimal tool shape needed by specialists. Real tool objects are richer. */
export interface ToolLike {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** Loose map of tool-name -> tool. Specialists pick what they need. */
export type AgentTools = Record<string, ToolLike> & { poolTools?: Record<string, ToolLike> };

export interface SpecialistAgent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolLike[];
}

export interface SpecialistFactory {
  name: string;
  description: string;
  shouldInclude: (appModel: AppModel) => boolean;
  build: (tools: AgentTools) => SpecialistAgent;
}
