import type { TaskState } from '../workflow/types'

/** Unclaimed tasks default to a workflow-wide state lock; only graph-only entity analysis is parallel by default. */
export function taskResourceClaims(task: Pick<TaskState, 'kind' | 'resourceClaims' | 'contextRefs'>): string[] {
  const declared = task.resourceClaims ?? []
  if (task.kind === 'entity_relationships') return [...new Set(declared)].sort()
  if (task.kind) return [...new Set([...declared, ...task.contextRefs])].sort()
  if (declared.length) return [...new Set(declared)].sort()
  return ['shared-target-state']
}
