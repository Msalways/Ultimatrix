import { registerAllTools } from './registry'

const toolRegistry = new Map<string, any>()

function initializeToolRegistry() {
  if (toolRegistry.size > 0) return
  const tools = registerAllTools()
  for (const [name, tool] of Object.entries(tools)) {
    // Use the tool's id if available, otherwise the export name
    const key = (tool as any)?.id ?? name
    toolRegistry.set(key, tool)
    // Also register by export name for convenience
    toolRegistry.set(name, tool)
  }
}

export function getToolRegistry(): Map<string, any> {
  initializeToolRegistry()
  return toolRegistry
}

export function resolveTools(toolRefs: string[]): Record<string, any> {
  const tools: Record<string, any> = {}
  const registry = getToolRegistry()

  for (const ref of toolRefs) {
    const tool = registry.get(ref)
    if (!tool) throw new Error(`Unknown tool: ${ref}`)
    tools[ref] = tool
  }

  return tools
}

export function getTool(name: string): any | undefined {
  initializeToolRegistry()
  return toolRegistry.get(name)
}
