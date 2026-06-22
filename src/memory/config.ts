import { Memory } from '@mastra/memory'
import type { UltimatrixConfig } from '../config'

export function createMemoryFromConfig(config: UltimatrixConfig) {
  return new Memory({
    options: {
      lastMessages: config.memory.lastMessages,
      semanticRecall: config.memory.semanticRecall,
      workingMemory: {
        enabled: config.memory.workingMemory,
        template: `
## Working Memory
- Target: {{target}}
- Phase: {{phase}}
- Findings Count: {{findingsCount}}
- Endpoints Tested: {{endpointsTested}}
- Status: {{status}}
`,
      },
    },
  })
}
