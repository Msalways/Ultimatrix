import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { RBACRoleNode } from '../graph/schema'

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
  apiCalls: string[]
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