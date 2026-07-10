import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { delegate, getToolDescription, type ToolName } from './delegator'

function buildScannerTool(name: ToolName) {
  return createTool({
    id: name,
    description: `${getToolDescription(name)} Delegates to the local ${name} binary via the tool delegator.`,
    inputSchema: z.object({
      target: z.string().describe('Target URL or host for the scanner'),
      options: z.record(z.string(), z.unknown()).optional().describe('Tool-specific options (templates, ports, scripts, severity, etc.)'),
    }),
    execute: async ({ target, options }) => {
      return delegate({ tool: name, target, options: options ?? {} })
    },
  })
}

export const nucleiTool = buildScannerTool('nuclei')
export const nmapTool = buildScannerTool('nmap')
export const sqlmapTool = buildScannerTool('sqlmap')
export const ffufTool = buildScannerTool('ffuf')

export const scannerTools = {
  nuclei: nucleiTool,
  nmap: nmapTool,
  sqlmap: sqlmapTool,
  ffuf: ffufTool,
}
