/**
 * `ultimatrix mcp` — manage MCP server registrations in ultimatrix.yaml.
 *
 * Commands:
 *   mcp add <name> --command "<cmd>" [--args "a b"] [--env K=V ...]
 *   mcp add <name> --url <url> [--header K=V ...]
 *   mcp remove <name>
 *   mcp list
 *   mcp detect            (auto-detect .mcp.json in cwd)
 *
 * This only edits config; it never auto-loads tools. Use the `loadTool` brain
 * tool at runtime to actually acquire a tool.
 */

import { resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { load, dump } from 'js-yaml'
import { log } from '../utils/logger'
import type { McpServerConfig } from '../config'

function yamlPath(): string {
  return resolve(process.cwd(), 'ultimatrix.yaml')
}

function readYaml(): Record<string, unknown> {
  const p = yamlPath()
  if (!existsSync(p)) return {}
  try {
    const parsed = load(readFileSync(p, 'utf-8'))
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {}
}

function writeYaml(data: Record<string, unknown>): void {
  writeFileSync(yamlPath(), dump(data), 'utf-8')
}

function getServers(data: Record<string, unknown>): McpServerConfig[] {
  return Array.isArray(data.mcp) ? (data.mcp as McpServerConfig[]) : []
}

export async function mcpCommand(args: string[]): Promise<void> {
  const action = args[0]
  const rest = args.slice(1)
  const data = readYaml()
  const servers = getServers(data)

  switch (action) {
    case 'add': {
      const name = rest[0]
      if (!name) {
        log.error('mcp add requires a name: ultimatrix mcp add <name> --command "..."')
        process.exit(1)
      }
      const commandIdx = rest.indexOf('--command')
      const urlIdx = rest.indexOf('--url')
      const argsIdx = rest.indexOf('--args')
      const envIdx = rest.indexOf('--env')
      const headerIdx = rest.indexOf('--header')
      const server: McpServerConfig = { name }

      if (commandIdx !== -1) {
        server.command = rest[commandIdx + 1]
        if (argsIdx !== -1) server.args = rest[argsIdx + 1].split(/\s+/).filter(Boolean)
        if (envIdx !== -1) server.env = parseKv(rest.slice(envIdx + 1))
      } else if (urlIdx !== -1) {
        server.url = rest[urlIdx + 1]
        server.type = 'http'
        if (headerIdx !== -1) server.headers = parseKv(rest.slice(headerIdx + 1))
      } else {
        log.error('mcp add requires --command "<cmd>" or --url <url>')
        process.exit(1)
      }

      const existing = servers.findIndex((s) => s.name === name)
      if (existing !== -1) servers[existing] = server
      else servers.push(server)
      data.mcp = servers
      writeYaml(data)
      log.success(`Registered MCP server "${name}" in ultimatrix.yaml (tools NOT loaded until requested).`)
      break
    }

    case 'remove': {
      const name = rest[0]
      const next = servers.filter((s) => s.name !== name)
      data.mcp = next
      writeYaml(data)
      log.success(`Removed MCP server "${name}".`)
      break
    }

    case 'list': {
      if (servers.length === 0) {
        log.info('No MCP servers configured.')
        break
      }
      for (const s of servers) {
        const loc = s.command ? `stdio: ${s.command}` : `http: ${s.url}`
        log.info(`- ${s.name} (${loc})${s.auth ? ` auth=${s.auth.kind}` : ''}`)
      }
      break
    }

    case 'detect': {
      const dot = resolve(process.cwd(), '.mcp.json')
      if (!existsSync(dot)) {
        log.warn('No .mcp.json found in current directory.')
        break
      }
      try {
        const parsed = load(readFileSync(dot, 'utf-8')) as { mcpServers?: Record<string, McpServerConfig> }
        const found = parsed.mcpServers ?? {}
        const added: string[] = []
        for (const [name, cfg] of Object.entries(found)) {
          const server: McpServerConfig = { ...cfg, name }
          if (!servers.some((s) => s.name === name)) {
            servers.push(server)
            added.push(name)
          }
        }
        if (added.length) {
          data.mcp = servers
          writeYaml(data)
          log.success(`Detected and registered: ${added.join(', ')}`)
        } else {
          log.info('No new MCP servers found in .mcp.json.')
        }
      } catch (err) {
        log.error('Failed to parse .mcp.json: ' + (err instanceof Error ? err.message : String(err)))
      }
      break
    }

    default:
      log.info('Usage: ultimatrix mcp <add|remove|list|detect> ...')
  }
}

function parseKv(items: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items) {
    const eq = item.indexOf('=')
    if (eq === -1) break
    out[item.slice(0, eq)] = item.slice(eq + 1)
  }
  return out
}
