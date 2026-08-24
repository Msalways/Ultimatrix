export interface RuntimeIdentity {
  threadId: string
  resourceId: string
  workflowId: string
  target: string
}

export function childRuntimeIdentity(identity: RuntimeIdentity, suffix: string): RuntimeIdentity {
  return {
    ...identity,
    threadId: `${identity.threadId}-${suffix}`,
    resourceId: `${identity.resourceId}-${suffix}`,
  }
}
