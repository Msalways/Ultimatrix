/**
 * Swarm Foundation — shared message bus for multi-debate coordination.
 *
 * Adapted from PWN Swarm. Enables structured messages between council members,
 * shared knowledge space, and coordinated state without tight coupling.
 *
 * Messages are typed and time-stamped. Subscribers receive all messages or
 * filtered by type/sender. No global state, no shared mutable objects.
 *
 * Purpose: Foundation for multi-agent coordination beyond council debate.
 */

export type SwarmMessageType =
  | 'finding'       // new finding discovered
  | 'endpoint'      // endpoint discovered
  | 'hypothesis'    // attack hypothesis proposed
  | 'decision'      // decision made (approve/reject)
  | 'progress'      // task progress update
  | 'evidence'      // evidence recorded
  | 'reflexion'     // lesson learned from failure

export interface SwarmMessage {
  id: string
  type: SwarmMessageType
  sender: string      // agent/member id
  payload: Record<string, unknown>
  timestamp: number
  priority?: 'low' | 'normal' | 'high'
}

export type MessageFilter = {
  types?: SwarmMessageType[]
  senders?: string[]
  since?: number  // timestamp
}

export class SwarmBus {
  private messages: SwarmMessage[] = []
  private listeners: Array<{ filter: MessageFilter; callback: (msg: SwarmMessage) => void }> = []
  private seq = 0

  /** Publish a message to the bus. Notifies matching subscribers. */
  publish(
    type: SwarmMessageType,
    sender: string,
    payload: Record<string, unknown>,
    priority?: SwarmMessage['priority'],
  ): SwarmMessage {
    const msg: SwarmMessage = {
      id: `swarm-${Date.now()}-${++this.seq}`,
      type,
      sender,
      payload,
      timestamp: Date.now(),
      priority: priority ?? 'normal',
    }

    this.messages.push(msg)

    for (const sub of this.listeners) {
      if (matchesFilter(msg, sub.filter)) {
        sub.callback(msg)
      }
    }

    return msg
  }

  /** Subscribe to messages matching a filter. Returns unsubscribe function. */
  subscribe(
    filter: MessageFilter,
    callback: (msg: SwarmMessage) => void,
  ): () => void {
    const sub = { filter, callback }
    this.listeners.push(sub)
    return () => {
      this.listeners = this.listeners.filter(l => l !== sub)
    }
  }

  /** Get all messages (optionally filtered). */
  getMessages(filter?: MessageFilter): SwarmMessage[] {
    if (!filter) return [...this.messages]
    return this.messages.filter(m => matchesFilter(m, filter))
  }

  /** Get the latest message of a given type. */
  latest(type: SwarmMessageType): SwarmMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === type) return this.messages[i]
    }
    return undefined
  }

  /** Get message count. */
  count(): number {
    return this.messages.length
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = []
  }
}

function matchesFilter(msg: SwarmMessage, filter: MessageFilter): boolean {
  if (filter.types && !filter.types.includes(msg.type)) return false
  if (filter.senders && !filter.senders.includes(msg.sender)) return false
  if (filter.since && msg.timestamp < filter.since) return false
  return true
}
