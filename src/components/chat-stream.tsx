'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  GitBranch,
  Loader2,
  PanelLeftOpen,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useChatStore, type StreamMessage, type ToolCallMessage, type ChatMessage, nextId } from '@/stores/chat-store'
import { useBudgetStore } from '@/stores/budget-store'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { useResourceStore } from '@/stores/resource-store'
import { ToolCallCard } from './tool-call-card'
import { FindingCard } from './finding-card'
import { WorkerCard } from './worker-card'
import { ChatInput, type InputMode } from './chat-input'
import { ChatSkeleton } from './skeletons'
import { MarkdownBlock } from './markdown-block'
import { appendDelta, visibleAssistantText } from '@/output/render-model'
import { deriveRunOutcome, shouldRenderRunSummary, type RunOutcomeInput, type RunOutcomeKind } from '@/core/run-outcome'
import { dataFetcher } from '@/services/data-fetcher'
import { spiderEventLine } from '@/spider/render'

function normalizeHydratedMessages(messages: unknown[]): StreamMessage[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return message as StreamMessage
    const candidate = message as any
    if (candidate.type === 'phase' || candidate.type === 'graph-update') return []
    if (candidate.type === 'stream-status' && (candidate.status === 'starting' || candidate.status === 'running')) {
      return [{
        ...candidate,
        status: 'aborted',
        label: 'Previous run interrupted',
      } as StreamMessage]
    }
    if (candidate.type === 'tool-call' && candidate.status === 'running') {
      return [{
        ...candidate,
        status: 'error',
        result: candidate.result || 'Interrupted before this tool returned.',
      } as StreamMessage]
    }
    return [candidate as StreamMessage]
  })
}

function isInternalTool(name?: string): boolean {
  if (!name) return false
  const normalized = name.toLowerCase()
  return normalized.includes('memory') ||
    normalized === 'gettargetsummary' ||
    normalized === 'listtools' ||
    normalized === 'loadtool'
}

function cleanAssistantContent(content?: string): string {
  if (!content) return ''
  return content
    .replace(/^\s*Let me update working memory[^\n]*(\n|$)/i, '')
    .replace(/^\s*According to the Talking vs\. Hunting rules[^\n]*(\n|$)/i, '')
    .trim()
}

export function ChatStream() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const addMessage = useChatStore((s) => s.addMessage)
  const setMessages = useChatStore((s) => s.setMessages)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const removeMessage = useChatStore((s) => s.removeMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const { setPhase, incrementToolCalls, incrementFindings, setRunning, setDuration, incrementTokens, reset } = useBudgetStore()
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const openSidebar = useUIStore((s) => s.openSidebar)
  const setHistoryState = useChatStore((s) => s.setHistoryState)
  const historyState = useChatStore((s) => s.historyState)
  const [historyReadyTarget, setHistoryReadyTarget] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const loadedTargetRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    loadedTargetRef.current = activeTarget
    setHistoryReadyTarget(null)

    if (!activeTarget) {
      setHistoryReadyTarget(null)
      return
    }

    const hasExistingMessages = messages.length > 0
    setHistoryState(hasExistingMessages ? 'refreshing' : 'loading')

    dataFetcher.loadChatHistory(activeTarget).then(({ messages: loaded }) => {
      if (loadedTargetRef.current === activeTarget) {
        setMessages(Array.isArray(loaded) ? normalizeHydratedMessages(loaded) : [])
        setHistoryReadyTarget(activeTarget)
        setHistoryState('ready')
      }
    })
  }, [activeTarget, setMessages, setHistoryState])

  useEffect(() => {
    if (!activeTarget || historyReadyTarget !== activeTarget) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/chat-history?target=${encodeURIComponent(activeTarget)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      }).catch(() => {})
    }, isStreaming ? 1200 : 250)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [activeTarget, historyReadyTarget, isStreaming, messages])

  const handleSend = useCallback((goal: string, mode: InputMode = 'auto') => {
    if (useChatStore.getState().isStreaming) return

    addMessage({
      id: nextId(),
      role: 'user',
      content: goal,
      timestamp: Date.now(),
    })

    setStreaming(true)
    reset()
    setRunning(true)

    let answerBuffer = ''
    let thinkingBuffer = ''
    let liveAnswerId: string | null = null // live preview message shown during streaming
    let liveThinkingId: string | null = null
    const streamStatusId = nextId()
    let aborted = false
    const startTime = Date.now()
    const durationInterval = setInterval(() => setDuration(Date.now() - startTime), 1000)

    const abortController = new AbortController()
    eventSourceRef.current = { close: () => abortController.abort() } as any

    addMessage({
      id: streamStatusId,
      type: 'stream-status',
      status: 'starting',
      label: 'Starting solver',
      timestamp: Date.now(),
    } as any)

    function handleSSEEvent(event: string, data: string) {
      if (aborted) return
      try {
        const parsed = data ? JSON.parse(data) : null
        if (event === 'solver') {
          const msg = parsed
          switch (msg.kind) {
            case 'reasoning':
              thinkingBuffer = appendDelta(thinkingBuffer, msg.text)
              if (!thinkingBuffer.trim()) break
              if (!liveThinkingId) {
                liveThinkingId = nextId()
                addMessage({
                  id: liveThinkingId,
                  type: 'thinking',
                  content: thinkingBuffer,
                  collapsed: false,
                  timestamp: Date.now(),
                } as any)
              } else {
                updateMessage(liveThinkingId, {
                  content: thinkingBuffer,
                  timestamp: Date.now(),
                } as any)
              }
              updateMessage(streamStatusId, {
                status: 'running',
                label: 'Thinking',
              } as any)
              break
            case 'answer':
              // Live answer preview: stream deltas into a message node so the
              // user sees the answer forming in real-time.
              answerBuffer = appendDelta(answerBuffer, msg.text)
              const visibleAnswer = visibleAssistantText(answerBuffer)
              if (!visibleAnswer && answerBuffer.trim().startsWith('{')) break
              if (!liveAnswerId) {
                liveAnswerId = nextId()
                addMessage({
                  id: liveAnswerId,
                  role: 'assistant',
                  content: visibleAnswer,
                  timestamp: Date.now(),
                })
              } else {
                updateMessage(liveAnswerId, {
                  content: visibleAnswer,
                  timestamp: Date.now(),
                } as any)
              }
              updateMessage(streamStatusId, {
                status: 'running',
                label: 'Drafting response',
              } as any)
              break
            case 'tool':
              if (isInternalTool(msg.name)) {
                incrementToolCalls()
                updateMessage(streamStatusId, {
                  status: 'running',
                  label: 'Updating session context',
                } as any)
                break
              }
              addMessage({
                id: nextId(),
                type: 'tool-call',
                name: msg.name,
                args: msg.args,
                status: 'running',
                timestamp: Date.now(),
                workerId: msg.workerId,
                workerName: msg.workerName,
                toolCallIndex: msg.toolCallIndex,
              } as any)
              incrementToolCalls()
              break
            case 'tool-result': {
              if (isInternalTool(msg.name)) {
                updateMessage(streamStatusId, {
                  status: 'running',
                  label: 'Session context updated',
                } as any)
                break
              }
              const state = useChatStore.getState()
              // B5: Match by workerId+name (more precise than just name)
              const lastTool = [...state.messages].reverse().find(
                (m): m is ToolCallMessage =>
                  (m as any).type === 'tool-call' &&
                  (m as any).name === msg.name &&
                  (m as any).status === 'running' &&
                  (!msg.workerId || (m as any).workerId === msg.workerId)
              )
              if (lastTool) {
                updateMessage(lastTool.id, {
                  status: msg.ok ? 'done' : 'error',
                  result: msg.result,
                  duration: msg.durationMs,
                } as any)
              }
              break
            }
            case 'event':
              updateMessage(streamStatusId, {
                status: msg.status === 'error' ? 'error' : msg.status === 'warn' ? 'running' : 'running',
                label: msg.label,
              } as any)
              addMessage({
                id: nextId(),
                type: 'phase',
                phase: msg.event,
                step: 0,
                label: msg.label,
                status: msg.status,
                timestamp: Date.now(),
              } as any)
              break
            case 'phase':
              setPhase(msg.phase, msg.step)
              updateMessage(streamStatusId, {
                status: 'running',
                label: `${msg.phase} step ${msg.step}`,
              } as any)
              break
            case 'done':
              // B4: Done event — live preview will be replaced by canonical answer
              if (msg.answer?.reasoning) {
                thinkingBuffer = msg.answer.reasoning
                if (liveThinkingId) {
                  updateMessage(liveThinkingId, {
                    content: thinkingBuffer,
                    collapsed: true,
                    timestamp: Date.now(),
                  } as any)
                } else {
                  liveThinkingId = nextId()
                  addMessage({
                    id: liveThinkingId,
                    type: 'thinking',
                    content: thinkingBuffer,
                    collapsed: true,
                    timestamp: Date.now(),
                  } as any)
                }
              }
              if (msg.answer?.content) {
                answerBuffer = msg.answer.content
                if (liveAnswerId) {
                  updateMessage(liveAnswerId, {
                    content: cleanAssistantContent(answerBuffer),
                    timestamp: Date.now(),
                  } as any)
                }
              }
              break
          }
        } else if (event === 'phase') {
          const d = parsed
          setPhase(d.phase, d.step)
          updateMessage(streamStatusId, {
            status: 'running',
            label: d.text || `${d.phase || 'running'} step ${d.step ?? 0}`,
          } as any)
        } else if (event === 'started') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Running against ${parsed.target || activeTarget || 'target'}`,
          } as any)
        } else if (event === 'heartbeat') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: 'Still running',
          } as any)
        } else if (event === 'aborted') {
          updateMessage(streamStatusId, {
            status: 'aborted',
            label: parsed.message || 'Run aborted',
          } as any)
        } else if (event === 'spider:progress') {
          const d = parsed
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Mapping target${d.steps ? ` · step ${d.steps}` : ''}`,
          } as any)
        } else if (event === 'spider:event') {
          // Slice 10 — typed spider event stream (parity with CLI renderer).
          const d = parsed
          updateMessage(streamStatusId, {
            status: 'running',
            label: spiderEventLine(d),
          } as any)
        } else if (event === 'worker:spawned') {
          const d = parsed
          addMessage({
            id: nextId(),
            type: 'worker-spawned',
            workerId: d.workerId,
            name: d.workerName,
            skillId: d.skillId,
            task: d.task,
            timestamp: Date.now(),
          } as any)
        } else if (event === 'worker:completed') {
          const d = parsed
          const state = useChatStore.getState()
          const spawned = [...state.messages].reverse().find(
            (m): m is any =>
              (m as any).type === 'worker-spawned' &&
              (m as any).workerId === d.workerId
          )
          if (spawned) {
            updateMessage(spawned.id, {
              type: 'worker-completed',
              name: d.workerName || spawned.name || 'Worker',
              status: 'completed',
              findings: d.findings,
              duration: d.durationMs,
              timestamp: Date.now(),
            } as any)
          } else {
            addMessage({
              id: nextId(),
              type: 'worker-completed',
              workerId: d.workerId,
              name: d.workerName || 'Worker',
              status: 'completed',
              duration: d.durationMs,
              timestamp: Date.now(),
            } as any)
          }
        } else if (event === 'worker:error') {
          const state = useChatStore.getState()
          const spawned = [...state.messages].reverse().find(
            (m): m is any =>
              (m as any).type === 'worker-spawned' &&
              (m as any).workerId === parsed.workerId
          )
          if (spawned) {
            updateMessage(spawned.id, {
              type: 'worker-completed',
              name: parsed.workerName || spawned.name || 'Worker',
              status: 'error',
              timestamp: Date.now(),
            } as any)
          } else {
            addMessage({
              id: nextId(),
              type: 'error',
              content: parsed.message || parsed.error || `${parsed.workerName || 'Worker'} failed`,
              timestamp: Date.now(),
            } as any)
          }
        } else if (event === 'finding:discovered') {
          const d = parsed
          addMessage({
            id: nextId(),
            type: 'finding',
            findingId: d.findingId,
            severity: d.severity,
            technique: d.technique,
            endpoint: d.endpoint,
            timestamp: Date.now(),
          } as any)
          incrementFindings()
        } else if (event === 'finding:verified') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Verified finding ${parsed.findingId || ''}`.trim(),
          } as any)
        } else if (event === 'graph:node') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Recorded ${parsed.nodeType || 'graph evidence'}`,
          } as any)
        } else if (event === 'graph:edge') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Linked ${parsed.type || 'graph evidence'}`,
          } as any)
        } else if (event === 'browser:starting') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: parsed.headless === false ? 'Starting visible browser' : 'Starting browser',
          } as any)
          addMessage({
            id: nextId(),
            type: 'phase',
            phase: 'browser',
            step: 0,
            label: parsed.headless === false ? 'Starting visible browser' : 'Starting browser',
            timestamp: Date.now(),
          } as any)
        } else if (event === 'browser:ready') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: parsed.headless === false ? 'Visible browser ready' : 'Browser ready',
          } as any)
          addMessage({
            id: nextId(),
            type: 'phase',
            phase: 'browser',
            step: 0,
            label: parsed.headless === false ? 'Visible browser ready' : 'Browser ready',
            timestamp: Date.now(),
          } as any)
        } else if (event === 'browser:failed') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: `Browser failed: ${parsed.error || 'unknown error'}`,
          } as any)
        } else if (event === 'evidence:recorded' || event === 'reflexion:escalation' || event === 'anti-loop:stale' || event === 'browser:reaction') {
          updateMessage(streamStatusId, {
            status: 'running',
            label: event.split(':').join(' '),
          } as any)
        } else if (event === 'done') {
          const result = parsed
          // UX5: Wire budget store from final result
          if (result.durationMs) setDuration(result.durationMs)
          if (result.tokensUsed) incrementTokens(result.tokensUsed)
          const finalContent = cleanAssistantContent(visibleAssistantText(result.answer?.content || result.text || ''))
          const newFindings = result.newFindings ?? 0
          const effectiveMode: RunOutcomeInput['interactionMode'] =
            result.interactionMode === 'run' ? 'run' : result.interactionMode === 'ask' ? 'ask' : undefined
          const outcomeInput: RunOutcomeInput = {
            interactionMode: effectiveMode,
            completed: result.completed,
            reason: result.reason,
            toolCalls: result.toolCalls,
            steps: result.steps,
            newFindings,
            durationMs: result.durationMs,
            error: result.error,
          }
          const outcome = deriveRunOutcome({
            ...outcomeInput,
          })
          removeMessage(streamStatusId)
          // Remove live streaming preview if present — canonical answer replaces it
          if (liveAnswerId) {
            removeMessage(liveAnswerId)
            liveAnswerId = null
          }
          if (finalContent) {
            addMessage({
              id: nextId(),
              role: 'assistant',
              content: finalContent,
              timestamp: Date.now(),
            })
          }
          if (!finalContent && !shouldRenderRunSummary(outcomeInput)) {
            addMessage({
              id: nextId(),
              type: 'error',
              content: 'No assistant answer was returned for this turn.',
              goal,
              timestamp: Date.now(),
            } as any)
          }
          if (shouldRenderRunSummary(outcomeInput)) {
            addMessage({
              id: nextId(),
              type: 'summary',
              content: finalContent || 'Analysis complete',
              steps: result.steps || 0,
              toolCalls: result.toolCalls || 0,
              findings: newFindings,
              durationMs: result.durationMs || 0,
              outcome: outcome.kind,
              label: outcome.label,
              detail: outcome.detail,
              reason: result.reason,
              goal,
              mode: effectiveMode,
              timestamp: Date.now(),
            } as any)
          }
        } else if (event === 'error') {
          removeMessage(streamStatusId)
          addMessage({
            id: nextId(),
            type: 'error',
            content: parsed.message || 'Unknown error',
            goal,
            mode,
            timestamp: Date.now(),
          } as any)
        }
      } catch (err) {
        addMessage({
          id: nextId(),
          type: 'error',
          content: err instanceof Error ? `Stream parse error: ${err.message}` : 'Stream parse error',
          timestamp: Date.now(),
        } as any)
      }
    }

    async function readSSE(res: Response) {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'message'
      let dataLines: string[] = []

      const dispatch = () => {
        if (dataLines.length === 0) {
          currentEvent = 'message'
          return
        }
        handleSSEEvent(currentEvent, dataLines.join('\n'))
        currentEvent = 'message'
        dataLines = []
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || aborted) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              dataLines.push(line.slice(6))
            } else if (line === '') {
              dispatch()
            }
          }
        }
        if (!aborted) dispatch()
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          removeMessage(streamStatusId)
          addMessage({
            id: nextId(),
            type: 'error',
            content: err.message || 'Stream error',
            goal,
            timestamp: Date.now(),
          } as any)
        }
      } finally {
        cleanup()
      }
    }

    fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, target: activeTarget || '', interactionMode: mode === 'run' ? 'run' : undefined }),
      signal: abortController.signal,
    })
      .then((res) => {
        if (!res.ok) {
          return res.text().then((body) => {
            let message = `HTTP ${res.status}`
            try {
              message = JSON.parse(body).error || message
            } catch {
              if (body) message = body.slice(0, 500)
            }
            addMessage({
              id: nextId(),
              type: 'error',
              content: message,
              goal,
              mode,
              timestamp: Date.now(),
            } as any)
            removeMessage(streamStatusId)
            cleanup()
          })
        }
        readSSE(res)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          addMessage({
            id: nextId(),
            type: 'error',
            content: err.message || 'Fetch failed',
            goal,
            mode,
            timestamp: Date.now(),
          } as any)
          removeMessage(streamStatusId)
        }
        cleanup()
      })

    function cleanup() {
      clearInterval(durationInterval)
      aborted = true
      eventSourceRef.current = null
      setStreaming(false)
      setRunning(false)
      answerBuffer = ''
    }
  }, [activeTarget, addMessage, updateMessage, removeMessage, setStreaming, setPhase, incrementToolCalls, incrementFindings, setRunning, setDuration, incrementTokens, reset])

  const handleStop = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      addMessage({
        id: nextId(),
        type: 'stream-status',
        status: 'aborted',
        label: 'Stopped by user',
        timestamp: Date.now(),
      } as any)
      setStreaming(false)
      setRunning(false)
    }
  }, [addMessage, setStreaming, setRunning])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && historyState === 'loading' ? (
          <ChatSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-2xl text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-emerald-300">
                <GitBranch size={22} />
              </div>
              <div className="text-base font-semibold text-zinc-200">Security research workbench</div>
              <div className="mt-2 text-sm text-zinc-600">
                {activeTarget ? 'Choose a focused pass or ask about persisted target context.' : 'Add a target to begin a scoped session.'}
              </div>
              {activeTarget && (
                <div className="mx-auto mt-4 max-w-full truncate rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-400">
                  {activeTarget}
                </div>
              )}
              {activeTarget && (
                <div className="mx-auto mt-5 grid max-w-xl gap-2 text-left sm:grid-cols-3">
                  <QuickStart
                    icon={Search}
                    label="Map attack surface"
                    onClick={() => handleSend('Map the target attack surface. Fingerprint the application, discover reachable endpoints, and record evidence.', 'run')}
                  />
                  <QuickStart
                    icon={ShieldCheck}
                    label="Run assessment"
                    onClick={() => handleSend('Perform a focused security assessment of the active target. Test the discovered surface, verify evidence, and record confirmed findings.', 'run')}
                  />
                  <QuickStart
                    icon={Sparkles}
                    label="Review session"
                    onClick={() => handleSend('Summarize what has already been tested, what was found, and the highest-value untested areas from persisted session context.', 'auto')}
                  />
                </div>
              )}
              {!activeTarget && (
                <button
                  onClick={openSidebar}
                  className="mx-auto mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
                >
                  <PanelLeftOpen size={14} />
                  Add target
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl py-4">
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && i === messages.length - 1}
                onSend={handleSend}
              />
            ))}
          </div>
        )}
      </div>
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        disabled={!activeTarget}
        isStreaming={isStreaming}
        placeholder={activeTarget ? `Ask about ${activeTarget}...` : 'Add a target to begin...'}
      />
    </div>
  )
}

function QuickStart({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Search
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700"
    >
      <Icon size={14} className="flex-shrink-0 text-zinc-500" />
      <span>{label}</span>
    </button>
  )
}

function phasePresentation(phase?: string): string {
  switch (phase) {
    case 'browser':
      return 'border-cyan-900/40 bg-cyan-950/10 text-cyan-300/80'
    case 'spider':
      return 'border-emerald-900/40 bg-emerald-950/10 text-emerald-300/80'
    case 'reason':
    case 'observe':
      return 'border-violet-900/40 bg-violet-950/10 text-violet-300/80'
    case 'attack':
    case 'explore':
      return 'border-amber-900/40 bg-amber-950/10 text-amber-300/80'
    case 'complete':
    case 'done':
      return 'border-emerald-900/40 bg-emerald-950/10 text-emerald-300/80'
    default:
      return 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
  }
}

function MessageBubble({
  message,
  isStreaming = false,
  onSend,
}: {
  message: StreamMessage
  isStreaming?: boolean
  onSend: (goal: string, mode?: InputMode) => void
}) {
  if ((message as any).type === 'tool-call') {
    return <ToolCallCard message={message as ToolCallMessage} />
  }
  if ((message as any).type === 'finding') {
    return <FindingCard message={message as any} />
  }
  if ((message as any).type === 'worker-spawned' || (message as any).type === 'worker-completed') {
    return <WorkerCard message={message as any} />
  }
  if ((message as any).type === 'phase') {
    const m = message as any
    const presentation = phasePresentation(m.phase)
    return (
      <div className={`ml-4 mr-4 my-1 inline-flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-md border px-2.5 py-1 text-xs sm:ml-8 ${presentation}`}>
        {m.phase === 'spider' ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
        <span className="capitalize font-medium">{m.phase}</span>
        <span className="truncate text-zinc-500">{m.label || `step ${m.step}`}</span>
      </div>
    )
  }
  if ((message as any).type === 'graph-update') {
    const m = message as any
    return (
      <div className="ml-4 mr-4 my-0.5 truncate font-mono text-xs text-zinc-600 sm:ml-8">
        + {m.nodeType}{m.label ? `: ${m.label}` : ''}
      </div>
    )
  }
  if ((message as any).type === 'summary') {
    const m = message as any
    const presentation = outcomePresentation(m.outcome)
    const action = outcomeAction(m.outcome, m.goal, m.mode)
    const Icon = presentation.icon
    return (
      <div className={`mx-4 my-3 rounded-md border px-3 py-3 sm:ml-8 ${presentation.frame}`}>
        <div className="flex items-start gap-2.5">
          <Icon size={15} className={`mt-0.5 flex-shrink-0 ${presentation.iconClass}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-200">{m.label}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{m.detail}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
              <span className="inline-flex items-center gap-1"><Clock3 size={11} />{formatRunDuration(m.durationMs)}</span>
              <span>{m.toolCalls} tool {m.toolCalls === 1 ? 'call' : 'calls'}</span>
              <span>{m.findings} new {m.findings === 1 ? 'finding' : 'findings'}</span>
            </div>
          </div>
          {action && (
            <button
              type="button"
              onClick={() => onSend(action.goal, action.mode)}
              className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
            >
              {action.retry ? <RotateCcw size={12} /> : <ArrowRight size={12} />}
              <span className="hidden sm:inline">{action.label}</span>
            </button>
          )}
        </div>
      </div>
    )
  }
  if ((message as any).type === 'stream-status') {
    const m = message as any
    const done = m.status === 'done'
    const aborted = m.status === 'aborted'
    return (
      <div className="ml-4 mr-4 my-1 flex items-center gap-2 rounded-md px-2 py-1 text-xs text-zinc-500 sm:ml-8">
        {m.status === 'running' || m.status === 'starting' ? (
          <Loader2 size={12} className="animate-spin text-zinc-600" />
        ) : done ? (
          <CheckCircle2 size={12} className="text-emerald-400/80" />
        ) : (
          <CircleAlert size={12} className="text-amber-400/80" />
        )}
        <span className={aborted ? 'text-amber-300/80' : 'text-zinc-500'}>{m.label}</span>
      </div>
    )
  }
  if ((message as any).type === 'error') {
    const errorMessage = message as any
    return (
      <div className="ml-4 mr-4 my-2 flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-3 text-xs text-red-300 sm:ml-8">
        <CircleAlert size={14} className="mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Run failed</div>
          <div className="mt-1 break-words text-red-300/80">{errorMessage.content || ''}</div>
        </div>
        {errorMessage.goal && (
          <button
            type="button"
            onClick={() => onSend(errorMessage.goal, errorMessage.mode === 'run' ? 'run' : 'auto')}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-900/70 px-2 text-[11px] text-red-200 transition-colors hover:bg-red-950/60"
          >
            <RotateCcw size={11} />
            Retry
          </button>
        )}
      </div>
    )
  }
  if ((message as any).type === 'thinking') {
    const m = message as any
    return (
      <div className="mx-4 my-1 rounded-md border border-violet-900/40 bg-violet-950/10 px-3 py-2 text-xs text-violet-200/80 sm:ml-8">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-violet-300/70">
          <Sparkles size={12} />
          Thinking
        </div>
        <div className={m.collapsed ? 'line-clamp-3 whitespace-pre-wrap text-violet-200/60' : 'whitespace-pre-wrap'}>
          {m.content}
        </div>
      </div>
    )
  }

  const chatMsg = message as ChatMessage
  const isUser = chatMsg.role === 'user'
  if (isUser) {
    return (
      <div className="my-2 px-4 text-right">
        <div className="inline-block max-w-[85%] rounded-md rounded-tr-sm bg-zinc-800 px-4 py-2 text-left text-sm leading-relaxed text-zinc-100 shadow-sm">
          {chatMsg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="my-2 px-4">
      <div className="max-w-[90%] text-sm leading-relaxed text-zinc-200">
        <MarkdownBlock content={chatMsg.content} streaming={isStreaming} />
      </div>
    </div>
  )
}

function formatRunDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function outcomePresentation(kind: RunOutcomeKind) {
  switch (kind) {
    case 'completed':
      return { icon: CheckCircle2, iconClass: 'text-emerald-400', frame: 'border-emerald-900/50 bg-emerald-950/10' }
    case 'answered':
      return { icon: CheckCircle2, iconClass: 'text-cyan-400', frame: 'border-zinc-800 bg-zinc-900/60' }
    case 'run_no_actions':
      return { icon: CircleAlert, iconClass: 'text-red-400', frame: 'border-red-900/50 bg-red-950/20' }
    case 'grounding_failed':
      return { icon: CircleAlert, iconClass: 'text-red-400', frame: 'border-red-900/50 bg-red-950/20' }
    case 'completed_no_findings':
      return { icon: Search, iconClass: 'text-amber-400', frame: 'border-amber-900/40 bg-amber-950/10' }
    case 'failed':
      return { icon: CircleAlert, iconClass: 'text-red-400', frame: 'border-red-900/50 bg-red-950/20' }
    default:
      return { icon: CircleAlert, iconClass: 'text-amber-400', frame: 'border-amber-900/40 bg-amber-950/10' }
  }
}

function outcomeAction(kind: RunOutcomeKind, previousGoal?: string, previousMode: InputMode = 'auto') {
  if (kind === 'run_no_actions') {
    return previousGoal ? { label: 'Start target grounding', goal: previousGoal, retry: true, mode: 'run' as const } : null
  }
  if (kind === 'answered') {
    return null
  }
  if (kind === 'grounding_failed') {
    return previousGoal ? { label: 'Retry grounding', goal: previousGoal, retry: true, mode: 'run' as const } : null
  }
  if (kind === 'completed_no_findings') {
    return {
      label: 'Continue deeper',
      goal: 'Continue the assessment from persisted state. Prioritize the highest-value untested attack paths and avoid repeating completed tests.',
      retry: false,
      mode: 'run' as const,
    }
  }
  if (kind === 'failed' || kind === 'interrupted' || kind === 'stopped') {
    return previousGoal ? { label: 'Retry', goal: previousGoal, retry: true, mode: previousMode } : null
  }
  return null
}
