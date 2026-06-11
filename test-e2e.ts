import { createSupervisor } from './src/manager/agent'
import { loadConfig } from './src/config'
import { closeBrowser } from './src/browser/manager'

async function main() {
  const config = loadConfig()
  console.log('Model:', config.model)

  const supervisor = createSupervisor(config)

  // Test: Full flow — delegate recon on example.com
  console.log('\n=== Full flow: Test http://example.com ===')
  const r = await supervisor.generate(
    'Target is http://example.com. Delegate to the recon worker to discover endpoints and technologies. Report what you find back to me.',
  )
  console.log('Response:', r.text)
  if (r.toolResults) {
    console.log('\nTool results:', JSON.stringify(r.toolResults, null, 2).slice(0, 3000))
  }

  await closeBrowser()
}

main().catch((err) => {
  console.error('E2E test failed:', err)
  process.exit(1)
})