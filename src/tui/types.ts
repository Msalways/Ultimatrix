export interface TuiMessage {
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
}

export interface TuiActivity {
  type: string
  message: string
  timestamp: number
}

export interface TuiGraphStats {
  pages: number
  actions: number
  tests: number
  findings: number
  authFlows: number
  rbacRoles: number
}

export interface TuiState {
  messages: TuiMessage[]
  activities: TuiActivity[]
  graphStats: TuiGraphStats
  inputText: string
  isResponding: boolean
}
