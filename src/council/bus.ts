/**
 * ConversationBus — the coordination channel between council members.
 *
 * A single append-only log all members read/write. The orchestrator feeds each
 * member a SLIDING-WINDOW transcript (not the full history every turn) so the
 * council stays within its token budget.
 */

import type { CouncilMessage, CouncilMemberRole, CouncilMessageType } from './types'

export class ConversationBus {
  private messages: CouncilMessage[] = []
  private seq = 0

  post(
    from: CouncilMemberRole,
    type: CouncilMessageType,
    text: string,
    opts: { round: number; to?: CouncilMemberRole; claim?: CouncilMessage['claim'] } = { round: 0 },
  ): CouncilMessage {
    const msg: CouncilMessage = {
      id: `m_${++this.seq}`,
      round: opts.round,
      from,
      to: opts.to,
      type,
      text,
      ...(opts.claim ? { claim: opts.claim } : {}),
      timestamp: Date.now(),
    }
    this.messages.push(msg)
    return msg
  }

  all(): CouncilMessage[] {
    return [...this.messages]
  }

  /** Sliding-window transcript (most recent `limit` messages), formatted for a prompt. */
  transcript(limit = 20): string {
    const recent = this.messages.slice(-limit)
    return recent
      .map(m => `[${m.round}|${m.from}${m.to ? `→${m.to}` : ''}|${m.type}] ${m.text}`)
      .join('\n')
  }

  /** Messages directed at (or from) a specific role. */
  forRole(role: CouncilMemberRole): CouncilMessage[] {
    return this.messages.filter(m => m.from === role || m.to === role)
  }

  clear(): void {
    this.messages = []
    this.seq = 0
  }
}
