/**
 * Extension bootstrap: apply UltimatrixConfig to the global tool registry and
 * skill sources. Called once per session from the solver brain factory.
 *
 * - Registers configured MCP servers (with ${ENV_VAR} interpolation).
 * - Registers configured code plugins (by path, namespaced by id).
 * - Configures additional skill directories + exclusions (Phase 7.1).
 */

import { getGlobalToolRegistry } from './tool-registry.js'
import { resolveEnvVars } from './resolve-env.js'
import { configureSkillSources } from '../solver/skills/loader.js'
import type { UltimatrixConfig } from '../config.js'

export function applyConfigExtensions(config: UltimatrixConfig): void {
  const reg = getGlobalToolRegistry()

  for (const server of config.mcp ?? []) {
    reg.registerMcp(resolveEnvVars(server))
  }

  for (const plugin of config.plugins ?? []) {
    reg.registerPluginFromPath(plugin.id, plugin.path, resolveEnvVars(plugin.env ?? {}))
  }

  configureSkillSources(config.skillsDirs ?? [], config.skills?.exclude ?? [])
}
