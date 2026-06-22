export enum InteractionType {
  GOTO = 'goto',
  CLICK = 'click',
  FILL = 'fill',
  ASSERT = 'assert',
  EXTRACT = 'extract',
  ACT = 'act',
  DELEGATE = 'delegate',
  EVALUATE = 'evaluate',
  SNAPSHOT = 'snapshot',
  API_CALL = 'api_call',
}

export interface Interaction {
  id: string
  type: InteractionType
  timestamp: number
  sessionId: string
  parentId?: string
  description: string
  url?: string
  selector?: string
  value?: string
  naturalLanguage?: string
  metadata?: Record<string, unknown>
}

export interface Assertion {
  id: string
  interactionId: string
  type: 'visible' | 'enabled' | 'text' | 'value' | 'url' | 'custom'
  selector?: string
  expected?: string
  condition?: string
  passed?: boolean
  actual?: string
}

export interface TestCase {
  id: string
  name: string
  type: 'happy' | 'sad' | 'edge' | 'security'
  description: string
  interactions: Interaction[]
  assertions: Assertion[]
  tags: string[]
  endpoint?: string
  method?: string
}

export interface Session {
  id: string
  name: string
  targetUrl: string
  startedAt: number
  interactions: Interaction[]
  testCases: TestCase[]
}