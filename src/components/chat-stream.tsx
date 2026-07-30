'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore, type StreamMessage, type ToolCallMessage, type ChatMessage, nextId } from '@/stores/chat-store'
import { useBudgetStore } from '@/stores/budget-store'
import { useSessionStore } from '@/stores/session-store'
import { ToolCallCard } from './tool-call-card'
import { FindingCard } from './finding-card'
import { WorkerCard } from './worker-card'
import { ChatInput } from './chat-input'
import { MarkdownBlock } from './markdown-block'
import { cn } from '@/lib/utils'
import { appendDelta } from '@/output/render-model'

export function ChatStream() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const { setPhase, incrementToolCalls, incrementFindings, setRunning, setDuration, incrementTokens, reset } = useBudgetStore()
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSend = useCallback((goal: string) => {
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
    let thinkingId: string | null = null // B1: null until first chunk
    let answerId: string | null = null   // B4: track answer message
    let aborted = false

    const abortController = new AbortController()
    eventSourceRef.current = { close: () => abortController.abort() } as any

    function handleSSEEvent(event: string, data: string) {
      if (aborted) return
      try {
        if (event === 'solver') {
          const msg = JSON.parse(data)
          switch (msg.kind) {
            case 'reasoning':
              // B1: Create thinking message on FIRST chunk, then update
              if (thinkingId === null) {
                thinkingId = nextId()
                addMessage({
                  id: thinkingId,
                  type: 'thinking',
                  content: msg.text,
                  collapsed: false,
                  timestamp: Date.now(),
                } as any)
              } else {
                thinkingBuffer = appendDelta(thinkingBuffer, msg.text)
                updateMessage(thinkingId, { content: thinkingBuffer } as any)
              }
              break
            case 'answer':
              // B3: Use appendDelta for cumulative provider support
              answerBuffer = appendDelta(answerBuffer, msg.text)
              if (answerId === null) {
                // B4: Create answer message on first chunk
                answerId = nextId()
                addMessage({
                  id: answerId,
                  role: 'assistant',
                  content: answerBuffer,
                  timestamp: Date.now(),
                })
              } else {
                updateMessage(answerId, { content: answerBuffer } as any)
              }
              break
            case 'tool':
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
                } as any)
              }
              break
            }
            case 'phase':
              setPhase(msg.phase, msg.step)
              addMessage({
                id: nextId(),
                type: 'phase',
                phase: msg.phase,
                step: msg.step,
                timestamp: Date.now(),
              } as any)
              break
            case 'done':
              // B4: Done event — finalize answer buffer if we have one
              break
          }
        } else if (event === 'phase') {
          const d = JSON.parse(data)
          setPhase(d.phase, d.step)
        } else if (event === 'spider:progress') {
          const d = JSON.parse(data)
          addMessage({
            id: nextId(),
            type: 'phase',
            phase: 'spider',
            step: d.steps || 0,
            timestamp: Date.now(),
          } as any)
        } else if (event === 'worker:spawned') {
          const d = JSON.parse(data)
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
          const d = JSON.parse(data)
          addMessage({
            id: nextId(),
            type: 'worker-completed',
            workerId: d.workerId,
            name: d.workerName || 'Worker',
            status: 'completed',
            duration: d.durationMs,
            timestamp: Date.now(),
          } as any)
        } else if (event === 'finding:discovered') {
          const d = JSON.parse(data)
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
        } else if (event === 'graph:node') {
          const d = JSON.parse(data)
          addMessage({
            id: nextId(),
            type: 'graph-update',
            nodeType: d.nodeType,
            nodeId: d.nodeId,
            label: d.label,
            timestamp: Date.now(),
          } as any)
        } else if (event === 'done') {
          const result = JSON.parse(data)
          // UX5: Wire budget store from final result
          if (result.durationMs) setDuration(result.durationMs)
          if (result.tokensUsed) incrementTokens(result.tokensUsed)
          addMessage({
            id: nextId(),
            type: 'summary',
            content: result.answer?.content || 'Analysis complete',
            steps: result.steps || 0,
            toolCalls: result.toolCalls || 0,
            findings: result.answer?.findings?.length || 0,
            durationMs: result.durationMs || 0,
            timestamp: Date.now(),
          } as any)
        } else if (event === 'error') {
          try {
            addMessage({
              id: nextId(),
              type: 'error',
              content: JSON.parse(data).message || 'Unknown error',
              timestamp: Date.now(),
            } as any)
          } catch {
            addMessage({
              id: nextId(),
              type: 'error',
              content: String(data),
              timestamp: Date.now(),
            } as any)
          }
        }
      } catch {
        // parse error, ignore
      }
    }

    async function readSSE(res: Response) {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'message'

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
              const data = line.slice(6)
              handleSSEEvent(currentEvent, data)
              currentEvent = 'message'
            } else if (line === '') {
              currentEvent = 'message'
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          addMessage({
            id: nextId(),
            type: 'error',
            content: err.message || 'Stream error',
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
      body: JSON.stringify({ goal, target: activeTarget || '' }),
      signal: abortController.signal,
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((err) => {
            addMessage({
              id: nextId(),
              type: 'error',
              content: err.error || `HTTP ${res.status}`,
              timestamp: Date.now(),
            } as any)
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
            timestamp: Date.now(),
          } as any)
        }
        cleanup()
      })

    function cleanup() {
      aborted = true
      eventSourceRef.current = null
      setStreaming(false)
      setRunning(false)
      answerBuffer = ''
      thinkingBuffer = ''
      thinkingId = null
      answerId = null
    }
  }, [activeTarget, addMessage, updateMessage, setStreaming, setPhase, incrementToolCalls, incrementFindings, setRunning, setDuration, incrementTokens, reset])

  const handleStop = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setStreaming(false)
      setRunning(false)
    }
  }, [setStreaming, setRunning])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="text-2xl font-light text-zinc-600 mb-2">Ultimatrix</div>
              <div className="text-sm text-zinc-600">Security research agent</div>
              {activeTarget && (
                <div className="mt-4 text-xs text-zinc-500 font-mono">{activeTarget}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto py-4">
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} message={msg} isStreaming={isStreaming && i === messages.length - 1} />
            ))}
          </div>
        )}
      </div>
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        placeholder={activeTarget ? `Test ${activeTarget}...` : 'Enter a target URL to begin...'}
      />
    </div>
  )
}

function MessageBubble({ message, isStreaming = false }: { message: StreamMessage; isStreaming?: boolean }) {
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
    return (
      <div className="ml-8 my-1 text-xs text-zinc-500 flex items-center gap-2">
        <span className="text-zinc-600">▸</span>
        <span className="capitalize">{m.phase}</span>
        <span className="text-zinc-700">step {m.step}</span>
      </div>
    )
  }
  if ((message as any).type === 'graph-update') {
    const m = message as any
    return (
      <div className="ml-8 my-0.5 text-xs text-zinc-600">
        + {m.nodeType}{m.label ? `: ${m.label}` : ''}
      </div>
    )
  }
  if ((message as any).type === 'summary') {
    const m = message as any
    return (
      <div className="ml-8 my-2 px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-xs">
        <span className="text-emerald-400/80">✓</span>
        <span className="text-zinc-400 ml-2">
          Done in {(m.durationMs / 1000).toFixed(0)}s · {m.toolCalls} tool calls · {m.findings} findings
        </span>
      </div>
    )
  }
  if ((message as any).type === 'error') {
    return (
      <div className="ml-8 my-2 px-3 py-2 rounded-md bg-red-950/20 border border-red-900/30 text-xs text-red-400/80">
        {'content' in message ? message.content : ''}
      </div>
    )
  }
  if ((message as any).type === 'thinking') {
    const m = message as any
    if (!m.content) return null
    return (
      <details className="ml-8 my-1">
        <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-500">
          thinking
        </summary>
        <div className="mt-1 text-xs text-zinc-500 italic whitespace-pre-wrap">
          {m.content}
        </div>
      </details>
    )
  }

  // Default: user or assistant text — B2: use MarkdownBlock for assistant
  const chatMsg = message as ChatMessage
  const isUser = chatMsg.role === 'user'
  if (isUser) {
    return (
      <div className="my-2 px-4 text-right">
        <div className="inline-block max-w-[85%] text-sm leading-relaxed bg-zinc-800 text-zinc-100 rounded-xl rounded-tr-sm px-4 py-2">
          {chatMsg.content}
        </div>
      </div>
    )
  }
  // Assistant: render as markdown
    return (
      <div className="my-2 px-4">
        <div className="max-w-[85%] text-sm leading-relaxed text-zinc-200">
          <MarkdownBlock content={chatMsg.content} streaming={isStreaming} />
        </div>
      </div>
    )
}
