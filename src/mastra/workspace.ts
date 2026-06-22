/**
 * Mastra Workspace integration for skill discovery.
 *
 * Note: @mastra/core/workspace may not be available in all versions.
 * This module provides a compatible layer that falls back to SkillRegistry.
 */

import { SkillRegistry } from '../skills/registry'

export interface WorkspaceConfig {
  filesystem: { basePath: string }
  skills: string[]
  bm25: boolean
}

export const ultimatrixWorkspace: WorkspaceConfig = {
  filesystem: { basePath: './workspace' },
  skills: ['skills/exploit', 'skills/recon', 'skills/code'],
  bm25: true,
}

export function createSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  registry.loadFromDirectory('./skills')
  return registry
}
