/** @jsxRuntime automatic */
/** @jsxImportSource terminui */
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline'
import { createTerminal, terminalResize, createSize, Color, fillConstraint, lengthConstraint, percentageConstraint } from 'terminui'
import { Column, Row, Panel, Box, Text } from 'terminui/jsx'
import { terminalDrawJsx } from 'terminui/jsx'
import { createAnsiBackend } from './backend'
import { getGlobalEmitter } from '../events/emitter'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'

interface Message { role: string; text: string; timestamp: number }
interface Activity { type: string; message: string; timestamp: number }
interface GraphStats { pages: number; actions: number; tests: number; findings: number; authFlows: number; rbacRoles: number }

interface TuiState {
  messages: Message[]
  activities: Activity[]
  graphStats: GraphStats
  sessionTime: number
  input: string
  scrollFromBottom: number
}

function buildChatText(messages: Message[]): string {
  if (messages.length === 0) return '  Welcome to Ultimatrix v5\n  Type a message to begin.'
  return messages.map(m => {
    const role = m.role === 'user' ? 'You' : 'Ultimatrix'
    return `${role}\n  ${m.text}`
  }).join('\n\n')
}

function buildActivityText(activities: Activity[]): string {
  if (activities.length === 0) return 'No activity yet...'
  return activities.slice(-50).reverse().map(a => `[${a.type}] ${a.message}`).join('\n')
}

function buildGraphText(stats: GraphStats): string {
  const items: Array<[string, number, string]> = [
    ['Pages', stats.pages, 'blue'],
    ['Actions', stats.actions, 'yellow'],
    ['Tests', stats.tests, 'green'],
    ['Findings', stats.findings, stats.findings > 0 ? 'red' : 'green'],
    ['Auth Flows', stats.authFlows, 'cyan'],
    ['RBAC Roles', stats.rbacRoles, 'magenta'],
  ]
  const maxLabel = Math.max(...items.map(i => i[0].length))
  return items.map(([label, val]) => `${label.padEnd(maxLabel)}  ${val}`).join('\n')
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

let _renderTimer: ReturnType<typeof setTimeout> | undefined
let _heartbeatTimer: ReturnType<typeof setInterval> | undefined
let _shuttingDown = false

export function startTUI(
  targetUrl?: string,
  modelName?: string,
  sendMessage?: (text: string) => Promise<string>,
): void {
  if (!input.isTTY || !output.isTTY) {
    output.write('Interactive TTY required for TUI mode.\n')
    process.exitCode = 1
    return
  }

  const backend = createAnsiBackend()
  const terminal = createTerminal(backend)

  const state: TuiState = {
    messages: [],
    activities: [],
    graphStats: { pages: 0, actions: 0, tests: 0, findings: 0, authFlows: 0, rbacRoles: 0 },
    sessionTime: 0,
    input: '',
    scrollFromBottom: 0,
  }

  const safeCleanup = () => {
    if (_shuttingDown) return
    _shuttingDown = true
    if (_renderTimer !== undefined) { clearTimeout(_renderTimer); _renderTimer = undefined }
    if (_heartbeatTimer !== undefined) { clearInterval(_heartbeatTimer); _heartbeatTimer = undefined }
    output.off('resize', onResize)
    input.off('keypress', onKeypress)
    try { input.setRawMode(false) } catch { /* ignore */ }
    output.write('\u001B[0m\u001B[?25h')
    output.write('\u001B[?1049l')
    output.write('\u001B[2J\u001B[3J\u001B[H')
  }

  const requestRender = () => {
    if (_shuttingDown || _renderTimer !== undefined) return
    _renderTimer = setTimeout(() => {
      _renderTimer = undefined
      renderNow()
    }, 16)
  }

  const onResize = () => {
    terminalResize(terminal, createSize(backend.size().width, backend.size().height))
    renderNow()
  }

  const renderNow = () => {
    if (_shuttingDown) return
    terminalDrawJsx(terminal, () => {
      const chatContent = buildChatText(state.messages)
      const activityContent = buildActivityText(state.activities)
      const graphContent = buildGraphText(state.graphStats)
      const statusParts = [
        targetUrl ? `Target: ${targetUrl}` : 'No target',
        modelName ? `Model: ${modelName}` : '',
        `Findings: ${state.graphStats.findings}`,
        formatTime(state.sessionTime),
      ].filter(Boolean)
      const statusLine = statusParts.join('  |  ')
      const displayInput = state.input || 'type a message and press Enter'
      const promptPrefix = '> '

      return (
        <Row constraints={[percentageConstraint(70), percentageConstraint(30)]} gap={1}>
          <Column constraints={[fillConstraint(1), lengthConstraint(1), lengthConstraint(1)]} gap={0}>
            <Box>
              <Text text={chatContent} wrap={{ trim: true }} />
            </Box>
            <Box>
              <Text text={`${promptPrefix}${displayInput}`} />
            </Box>
            <Box>
              <Text text={statusLine} />
            </Box>
          </Column>
          <Column constraints={[fillConstraint(1), fillConstraint(1)]} gap={0}>
            <Panel title="Activity" p={1}>
              <Text text={activityContent} wrap={{ trim: true }} />
            </Panel>
            <Panel title="Graph" p={1}>
              <Text text={graphContent} />
            </Panel>
          </Column>
        </Row>
      )
    })
  }

  // ---------- Event subscriptions ----------

  const emitter = getGlobalEmitter()

  const onActivityStart = (p: { worker: string; task: string }) => {
    state.activities.push({ type: 'START', message: `[${p.worker}] ${p.task}`, timestamp: Date.now() })
    requestRender()
  }
  const onActivityComplete = (p: { worker: string; result: string }) => {
    state.activities.push({ type: 'DONE', message: `[${p.worker}] ${p.result.slice(0, 120)}`, timestamp: Date.now() })
    requestRender()
  }
  const onActivityError = (p: { worker: string; error: string }) => {
    state.activities.push({ type: 'ERROR', message: `[${p.worker}] ${p.error.slice(0, 120)}`, timestamp: Date.now() })
    requestRender()
  }
  const onFinding = (p: { technique: string; severity: string; endpoint: string }) => {
    state.activities.push({ type: 'FIND', message: `${p.severity.toUpperCase()}: ${p.technique} @ ${p.endpoint}`, timestamp: Date.now() })
    state.graphStats.findings++
    requestRender()
  }
  const onSpiderProgress = (p: { url: string; status: number }) => {
    state.activities.push({ type: 'SPIDER', message: `${p.url} → ${p.status}`, timestamp: Date.now() })
    requestRender()
  }
  const onRecorderInteraction = (p: { type: string; description: string }) => {
    state.activities.push({ type: 'REC', message: `${p.type}: ${p.description.slice(0, 100)}`, timestamp: Date.now() })
    requestRender()
  }
  const onGraphUpdate = () => {
    try {
      const gs = getGlobalGraphStore()
      state.graphStats = {
        pages: gs.queryNodes(NodeType.PAGE).length,
        actions: gs.queryNodes(NodeType.ACTION).length,
        tests: gs.queryNodes(NodeType.TEST).length,
        findings: gs.queryNodes(NodeType.FINDING).length,
        authFlows: gs.queryNodes(NodeType.AUTH_FLOW).length,
        rbacRoles: gs.queryNodes(NodeType.RBAC_ROLE).length,
      }
      requestRender()
    } catch { /* not critical */ }
  }

  emitter.on('activity:start', onActivityStart)
  emitter.on('activity:complete', onActivityComplete)
  emitter.on('activity:error', onActivityError)
  emitter.on('finding', onFinding)
  emitter.on('spider:progress', onSpiderProgress)
  emitter.on('recorder:interaction', onRecorderInteraction)
  emitter.on('graph:update', onGraphUpdate)

  // ---------- Keyboard ----------

  readline.emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()

  const onKeypress = (str: string | undefined, key: readline.Key | undefined) => {
    if (_shuttingDown) return
    if (key?.ctrl && key.name === 'c') { safeCleanup(); process.exit(0); return }
    if (key?.name === 'escape') { safeCleanup(); process.exit(0); return }

    if (key?.name === 'up') {
      state.scrollFromBottom = clamp(state.scrollFromBottom + 1, 0, 100)
      requestRender()
      return
    }
    if (key?.name === 'down') {
      state.scrollFromBottom = clamp(state.scrollFromBottom - 1, 0, 100)
      requestRender()
      return
    }

    if (key?.name === 'return' || key?.name === 'enter' || str === '\r' || str === '\n') {
      if (state.input.trim() && sendMessage) {
        const text = state.input.trim()
        state.input = ''
        state.messages.push({ role: 'user', text, timestamp: Date.now() })
        requestRender()
        sendMessage(text).then(reply => {
          state.messages.push({ role: 'assistant', text: reply, timestamp: Date.now() })
          requestRender()
        }).catch(err => {
          state.messages.push({ role: 'assistant', text: `Error: ${err instanceof Error ? err.message : String(err)}`, timestamp: Date.now() })
          requestRender()
        })
      } else {
        requestRender()
      }
      return
    }

    if (key?.name === 'backspace') {
      if (state.input.length > 0) {
        state.input = state.input.slice(0, -1)
        requestRender()
      }
      return
    }

    if (typeof str !== 'string' || str.length === 0) return
    const code = str.codePointAt(0)
    if (code === undefined || code < 32 || code === 127) return
    state.input += str
    requestRender()
  }

  // ---------- Startup ----------

  output.write('\u001B[?1049h')
  output.write('\u001B[2J\u001B[3J\u001B[H')
  output.write('\u001B[?25l')

  input.on('keypress', onKeypress)
  output.on('resize', onResize)
  _heartbeatTimer = setInterval(() => {
    state.sessionTime++
    requestRender()
  }, 1000)
  onResize()

  process.on('exit', () => safeCleanup())
  process.on('SIGTERM', () => { safeCleanup(); process.exit(0) })
  process.on('SIGINT', () => { safeCleanup(); process.exit(0) })
}
