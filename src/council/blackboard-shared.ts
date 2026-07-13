/**
 * SharedBlackboard — council-compatible wrapper around the core Blackboard.
 *
 * T0.3 (Wave Core): the canonical Blackboard now lives in src/core/blackboard.ts.
 * This file re-exports it as SharedBlackboard and provides adapter methods so
 * council orchestrator code continues to work unchanged until T1.2 migrates it.
 */

import { Blackboard, IntentStatus, type BoardIntent } from '../core/blackboard'

export type IntentStatus_Council = 'open' | 'claimed' | 'blocked' | 'concluded'

export interface CouncilIntent {
  id: string
  owner: string
  summary: string
  status: IntentStatus_Council
}

function mapStatus(s: IntentStatus): IntentStatus_Council {
  if (s === IntentStatus.CLAIMED) return 'claimed'
  if (s === IntentStatus.BLOCKED) return 'blocked'
  if (s === IntentStatus.CONCLUDED) return 'concluded'
  return 'open'
}

function toCouncilIntent(i: BoardIntent): CouncilIntent {
  return {
    id: i.id,
    owner: i.owner ?? '',
    summary: i.description,
    status: mapStatus(i.status),
  }
}

export class SharedBlackboard extends Blackboard {
  /** Create a SharedBlackboard, optionally wrapping an existing Blackboard instance. */
  constructor(inner?: Blackboard) {
    if (inner) {
      // Initialize with the inner blackboard's origin/goal, then copy state
      super({ origin: (inner as any).origin ?? 'shared', goal: (inner as any).goal ?? '' })
      // Re-copy facts and intents to preserve sequential IDs
      for (const fact of inner.getFactStrings()) {
        super.addFact(fact, 'shared')
      }
    } else {
      super()
    }
  }
  /** Add a fact by plain string (council compat). */
  addFactString(fact: string): void {
    super.addFact(fact, 'council')
  }

  getFacts(): string[] {
    return this.getFactStrings()
  }

  /** Council: a member claims an intent before acting. */
  claimIntent(owner: string, summary: string): CouncilIntent {
    const intent = this.claimBy(owner, summary)
    return toCouncilIntent(intent)
  }

  /** Council: skeptic blocks a proposal. */
  blockIntent(summary: string, by: string): CouncilIntent {
    const intent = super.blockIntent(summary, by)
    return toCouncilIntent(intent)
  }

  /** Council: conclude an intent without creating a fact. */
  concludeIntent(id: string): void {
    this.concludeByMember(id)
  }

  /** Council: get all intents as CouncilIntent[]. */
  getIntents(): CouncilIntent[] {
    return this.getAllIntents().map(toCouncilIntent)
  }

  /** Council: get intents that are open or claimed. */
  openIntents(): CouncilIntent[] {
    return this.openOrClaimed().map(toCouncilIntent)
  }
}
