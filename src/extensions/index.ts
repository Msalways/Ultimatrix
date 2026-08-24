/**
 * Extension bootstrap: apply UltimatrixConfig to the global tool registry and
 * skill sources. Called once per session from the solver brain factory.
 *
 * - Registers configured MCP servers (with ${ENV_VAR} interpolation).
 * - Registers configured code plugins (by path, namespaced by id).
 * - Configures additional skill directories + exclusions (Phase 7.1).
 */

import type { DynamicToolRegistry } from './tool-registry'
import { resolveEnvVars } from './resolve-env'
import { configureSkillSources } from '../solver/skills/loader'
import type { UltimatrixConfig } from '../config'

export function applyConfigExtensions(config: UltimatrixConfig, reg: DynamicToolRegistry): void {

  for (const server of config.mcp ?? []) {
    reg.registerMcp(resolveEnvVars(server))
  }

  for (const plugin of config.plugins ?? []) {
    reg.registerPluginFromPath(plugin.id, plugin.path, resolveEnvVars(plugin.env ?? {}))
  }

  configureSkillSources(config.skillsDirs ?? [], config.skills?.exclude ?? [])
}

export { DynamicToolRegistry, CapabilityActivationError } from './tool-registry'
export type { ToolDescriptor, ToolInfo, MastraTool } from './types'
