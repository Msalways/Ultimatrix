import { loadConfig } from './src/config'
import { createReconWorker } from './src/workers/recon'
import { Memory } from '@mastra/memory'
import { InMemoryStore } from '@mastra/core/storage'

async function main() {
  const config = loadConfig()
  console.log('Model:', config.model)

  const memory = new Memory({ storage: new InMemoryStore() })
  const worker = createReconWorker(config.model as any, undefined, memory)
  
  console.log('\n=== Calling worker directly ===')
  try {
    const result = await worker.generate(
      'Check http://example.com. List what endpoints and technologies you find. Return a short summary.'
    )
    console.log('Result text:', result.text)
    if (result.toolResults) {
      console.log('Tool results:', JSON.stringify(result.toolResults, null, 2).slice(0, 2000))
    }
  } catch (err) {
    console.error('Worker error:', err)
  }
}

main().catch(console.error)