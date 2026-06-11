import { Memory } from '@mastra/memory'

export interface MemoryConfig {
  lastMessages?: number
  semanticRecall?: boolean
  workingEnabled?: boolean
}

export function createMemoryConfig(opts?: MemoryConfig) {
  return new Memory({
    options: {
      lastMessages: opts?.lastMessages ?? 50,
      semanticRecall: opts?.semanticRecall ?? true,
      workingMemory: {
        enabled: opts?.workingEnabled ?? true,
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