/**
 * @deprecated Stub for removed swarm result formatter.
 */
export function formatSwarmResult(input: { completed: number; results: any[]; chains: any[] }): string {
  return `Swarm completed: ${input.completed}/${input.results.length} workers succeeded, ${input.chains.length} chains detected`
}
