/**
 * ApprovalOverlay — HITL tool-approval prompt. Renders the termcn
 * `ToolApproval` component bound to the pending `store.approval` request and
 * resolves it back into the store on [y]/[n]/[a]. The store's
 * `requestApproval()` promise resolves when `resolveApproval()` is called, so
 * the awaiting gate (anywhere in the engine) continues. Single owner: the store.
 */

import { ToolApproval } from '@/components/ui/tool-approval'
import type { UiStore } from './store'

export function ApprovalOverlay({ store }: { store: UiStore }) {
  const req = store.approval
  if (!req) return null

  return (
    <ToolApproval
      name={req.name}
      description={req.description}
      args={req.args}
      risk={req.risk}
      timeout={req.timeout}
      onApprove={() => store.resolveApproval('approve')}
      onDeny={() => store.resolveApproval('deny')}
      onAlwaysAllow={() => store.resolveApproval('always')}
    />
  )
}
