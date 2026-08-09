# 06. Identity Role Reachability

## Goal

Track which identity or role reached each page, endpoint, form, and workflow.

## Current State

Auth detection and RBAC learner modules exist, but role-specific reachability is not yet a first-class spider output or workflow state concern.

## Gaps Addressed

- Crawl output cannot reliably answer which identity reached which resource.
- Auth transitions are not consistently represented in typed state.
- Role-specific access data is not attached to pages/forms/endpoints.

## In Scope

- Add identity labels: anonymous, authenticated, admin, tenant, and role-specific.
- Attach identity/role context to pages, forms, endpoints, and workflows.
- Integrate auth detection from browser/session state.
- Record role-specific reachability in spider output.

## Out of Scope

- Creating test accounts.
- Bypassing authentication.
- Full RBAC matrix inference beyond observed reachability.

## Implementation Tasks

1. Define identity and role labels.
2. Add identity context to spider frontier entries and discovered resources.
3. Connect browser auth detection to workflow identity state.
4. Record auth transitions as typed state.
5. Emit role-aware discovery events.
6. Persist reachability in workflow state and graph.
7. Add tests for anonymous-to-authenticated transitions and role-specific endpoint reachability.

## Public Types / Interfaces

```typescript
export type IdentityKind =
  | 'anonymous'
  | 'authenticated'
  | 'admin'
  | 'tenant'
  | 'role'

export interface IdentityContext {
  id: string
  kind: IdentityKind
  label: string
  tenantId?: string
  roleName?: string
}

export interface ReachabilityRecord {
  workflowId: string
  identityId: string
  resourceId: string
  resourceType: 'page' | 'endpoint' | 'form' | 'workflow'
  reachedAt: string
}
```

## Data Flow

Browser/session auth detection updates active identity context. Spider discovery attaches that context to resources and emits role-aware events. Workflow state and graph persistence store reachability records.

## Failure Modes

- Authenticated resources are attributed to anonymous identity.
- Tenant-specific pages are merged across tenants.
- Auth transition is detected but not attached to following crawl output.

## Tests

- Anonymous crawl discovery.
- Auth transition updates identity.
- Role-specific endpoint reachability.
- Resume preserves identity context.

## Acceptance Criteria

- Crawl output can answer which role reached which endpoint/page/form.
- Auth transitions are represented in typed state.
- Reachability survives workflow resume.

## Dependencies

- Slice 01 for spider resource state.
- Slice 02 for workflow persistence.
- Slice 07 for provenance of auth transitions.

## Completion Status

Mostly pending.

