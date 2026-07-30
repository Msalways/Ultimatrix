import { getGlobalGraphStore } from '../graph/store'
import {EdgeType} from '../graph/schema'
import type { RBACRoleNode } from '../graph/schema'

export interface MatrixRole {
  role: string
  baseUrl: string
  headers: Record<string, string>
  ownedObjectIds: string[]
  reachableEndpoints: string[]
  marker?: string
}

export interface RoleObservation {
  roleName: string
  accessibleEndpoints: string[]
  visibleUIElements: string[]
  apiCalls: string[]
}

export function observeRole(
  roleName: string,
  accessibleEndpoints: string[],
  visibleUIElements: string[],
  _apiCalls: string[]
): RBACRoleNode {
  const store = getGlobalGraphStore()
  const node = store.addRBACRole({
    roleName,
    accessibleEndpoints,
    inaccessibleEndpoints: [],
    visibleUIElements,
  })
  store.save()
  return node
}

export function compareRoles(
  role1: RoleObservation,
  role2: RoleObservation
): {
  adminOnlyEndpoints: string[]
  userOnlyEndpoints: string[]
  differencesInUI: string[]
  permissions: Array<{ role: string; endpoint: string; access: 'granted' | 'denied' }>
} {
  const adminOnlyEndpoints = role1.accessibleEndpoints.filter(
    e => !role2.accessibleEndpoints.includes(e)
  )
  const userOnlyEndpoints = role2.accessibleEndpoints.filter(
    e => !role1.accessibleEndpoints.includes(e)
  )
  const differencesInUI = role1.visibleUIElements.filter(
    e => !role2.visibleUIElements.includes(e)
  )

  const permissions: Array<{ role: string; endpoint: string; access: 'granted' | 'denied' }> = [
    ...role1.accessibleEndpoints.map(e => ({ role: role1.roleName, endpoint: e, access: 'granted' as const })),
    ...role2.accessibleEndpoints.map(e => ({ role: role2.roleName, endpoint: e, access: 'granted' as const })),
    ...adminOnlyEndpoints.map(e => ({ role: role2.roleName, endpoint: e, access: 'denied' as const })),
  ]

  return { adminOnlyEndpoints, userOnlyEndpoints, differencesInUI, permissions }
}

export function buildRBACTestSuite(
  permissionMatrix: Array<{ role: string; endpoint: string; access: 'granted' | 'denied' }>
): Array<{ name: string; role: string; endpoint: string; expectedStatus: number }> {
  return permissionMatrix.map(p => ({
    name: `${p.role} can${p.access === 'denied' ? 'not' : ''} access ${p.endpoint}`,
    role: p.role,
    endpoint: p.endpoint,
    expectedStatus: p.access === 'granted' ? 200 : 403,
  }))
}

/**
 * Activate the RBAC learner from a real multi-identity session matrix.
 *
 * For each role we record an RBACRoleNode (accessed endpoints) and instantiate
 * the relational REQUIRES_ROLE / HAS_ROLE / PERMISSION edges that were declared
 * in schema.ts but previously never created. This makes "which endpoints
 * require admin" answerable from structured graph data, not prose.
 *
 * No hardcoded role vocabulary — roles + endpoints come straight from the
 * caller-supplied matrix.
 */
export function learnRBACFromMatrix(roles: MatrixRole[]): RBACRoleNode[] {
  const store = getGlobalGraphStore()
  const created: RBACRoleNode[] = []

  // Find the Endpoint nodes whose `endpoint` url matches a reachable endpoint,
  // so we can wire typed edges to real node ids (relation-native, no string
  // matching over prose).
  const endpointNodes = store.queryNodes('Endpoint' as any) as Array<{ id: string; properties: { endpoint?: string; url?: string } }>
  const endpointByUrl = new Map<string, string>()
  for (const e of endpointNodes) {
    const url = e.properties.endpoint ?? e.properties.url
    if (url) endpointByUrl.set(url, e.id)
  }

  for (const r of roles) {
    const roleNode = store.addRBACRole({
      roleName: r.role,
      accessibleEndpoints: r.reachableEndpoints,
      inaccessibleEndpoints: [],
      visibleUIElements: [],
    })
    created.push(roleNode)

    for (const ep of r.reachableEndpoints) {
      const endpointId = endpointByUrl.get(ep) ?? ep
      store.addEdge({ fromId: endpointId, toId: roleNode.id, type: EdgeType.REQUIRES_ROLE })
      store.addEdge({ fromId: roleNode.id, toId: endpointId, type: EdgeType.HAS_ROLE })
      store.addEdge({
        fromId: roleNode.id,
        toId: endpointId,
        type: EdgeType.PERMISSION,
        properties: { access: 'granted' },
      })
    }
  }

  store.save()
  return created
}