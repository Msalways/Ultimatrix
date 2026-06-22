export function formatSwarmResult(result: any): string {
  const completed = result.completed || 0
  const totalResults = result.results?.length || 0
  const chains = result.chains || []

  const lines: string[] = [
    '## Swarm Results',
    `- Workers executed: ${completed}`,
    `- Findings: ${totalResults}`,
    `- Cross-technique chains: ${chains.length}`,
  ]

  if (chains.length > 0) {
    lines.push('')
    lines.push('### Detected Chains')
    for (const chain of chains) {
      lines.push(`- **Chain**: ${chain.rule?.name || 'Unknown'} (${chain.rule?.severity || 'medium'})`)
    }
  }

  return lines.join('\n')
}
