import { loadConfig } from '../config'
import { checkDockerAvailable, detectPlatform, getPlatformCapabilities, getPlatformDiagnostic } from '../execution/platform'

/** Check host prerequisites without pulling images or starting containers. */
export async function sandboxCommand(args: string[] = []): Promise<void> {
  const config = loadConfig({ requireCredentials: false })
  const platform = await detectPlatform()
  const dockerAvailable = await checkDockerAvailable()
  const capabilities = getPlatformCapabilities(platform)
  const enabled = config.sandbox?.enabled === true
  const result = {
    enabled,
    platform,
    dockerAvailable,
    networkMode: config.sandbox?.networkMode ?? 'bridge',
    capabilities,
    diagnostic: dockerAvailable
      ? 'Docker daemon is reachable; run an engagement to create/reuse the configured tool container.'
      : getPlatformDiagnostic() ?? 'Docker daemon is unavailable.',
  }
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } else {
    process.stdout.write(`Sandbox enabled: ${enabled}\nPlatform: ${platform}\nDocker reachable: ${dockerAvailable}\nNetwork: ${result.networkMode}\n${result.diagnostic}\n`)
  }
  if (enabled && !dockerAvailable) process.exitCode = 2
}
