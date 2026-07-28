'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore, type StreamMessage, type ToolCallMessage, type ChatMessage, nextId } from '@/stores/chat-store'
import { useBudgetStore } from '@/stores/budget-store'
import { useSessionStore } from '@/stores/session-store'
import { ToolCallCard } from './tool-call-card'
import { FindingCard } from './finding-card'
import { WorkerCard } from './worker-card'
import { ChatInput } from './chat-input'
import { cn } from '@/lib/utils'

export function ChatStream() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const { setPhase, incrementToolCalls, incrementFindings, setRunning, reset } = useBudgetStore()
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

    const body: Record<string, unknown> = { goal }
    if (activeTarget) body.target = activeTarget

    const es = new EventSource('/api/solve?' + new URLSearchParams({ goal, target: activeTarget || '' }))
    eventSourceRef.current = es

    let answerBuffer = ''
    let thinkingBuffer = ''
    let thinkingId = nextId()

    es.addEventListener('solver', (e) => {
      try {
        const msg = JSON.parse(e.data)
        switch (msg.kind) {
          case 'reasoning':
            thinkingBuffer += msg.text
            updateMessage(thinkingId, { content: thinkingBuffer } as any)
            break
          case 'answer':
            if (thinkingBuffer && thinkingBuffer.length > 0) {
              // Finalize thinking block
              thinkingBuffer = ''
              thinkingId = nextId()
            }
            answerBuffer += msg.text
            const existingAnswer = useChatStore.getState().messages.find(
              (m) => 'role' in m && m.role === 'assistant' && m.id !== msg.id
            )
            if (existingAnswer) {
              updateMessage(existingAnswer.id, { content: answerBuffer } as any)
            } else {
              addMessage({
                id: nextId(),
                role: 'assistant',
                content: answerBuffer,
                timestamp: Date.now(),
              })
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
            } as any)
            incrementToolCalls()
            break
          case 'tool-result': {
            const state = useChatStore.getState()
            const lastTool = [...state.messages].reverse().find(
              (m): m is ToolCallMessage => (m as any).type === 'tool-call' && (m as any).name === msg.name && (m as any).status === 'running'
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
            break
        }
      } catch {
        // parse error, ignore
      }
    })

    es.addEventListener('phase', (e) => {
      try {
        const data = JSON.parse(e.data)
        setPhase(data.phase, data.step)
      } catch {}
    })

    es.addEventListener('worker:spawned', (e) => {
      try {
        const data = JSON.parse(e.data)
        addMessage({
          id: nextId(),
          type: 'worker-spawned',
          workerId: data.workerId,
          name: data.workerName,
          skillId: data.skillId,
          task: data.task,
          timestamp: Date.now(),
        } as any)
      } catch {}
    })

    es.addEventListener('worker:completed', (e) => {
      try {
        const data = JSON.parse(e.data)
        addMessage({
          id: nextId(),
          type: 'worker-completed',
          workerId: data.workerId,
          name: data.workerName || 'Worker',
          status: 'completed',
          duration: data.durationMs,
          timestamp: Date.now(),
        } as any)
      } catch {}
    })

    es.addEventListener('finding:discovered', (e) => {
      try {
        const data = JSON.parse(e.data)
        addMessage({
          id: nextId(),
          type: 'finding',
          findingId: data.findingId,
          severity: data.severity,
          technique: data.technique,
          endpoint: data.endpoint,
          timestamp: Date.now(),
        } as any)
        incrementFindings()
      } catch {}
    })

    es.addEventListener('graph:node', (e) => {
      try {
        const data = JSON.parse(e.data)
        addMessage({
          id: nextId(),
          type: 'graph-update',
          nodeType: data.nodeType,
          nodeId: data.nodeId,
          label: data.label,
          timestamp: Date.now(),
        } as any)
      } catch {}
    })

    es.addEventListener('done', (e) => {
      try {
        const result = JSON.parse(e.data)
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
      } catch {}
      cleanup()
    })

    es.addEventListener('error', (e: MessageEvent) => {
      if (e.data) {
        try {
          addMessage({
            id: nextId(),
            type: 'error',
            content: JSON.parse(e.data).message || 'Unknown error',
            timestamp: Date.now(),
          } as any)
        } catch {
          addMessage({
            id: nextId(),
            type: 'error',
            content: String(e.data),
            timestamp: Date.now(),
          } as any)
        }
      }
      cleanup()
    })

    es.onerror = () => {
      cleanup()
    }

    function cleanup() {
      es.close()
      eventSourceRef.current = null
      setStreaming(false)
      setRunning(false)
      answerBuffer = ''
      thinkingBuffer = ''
    }
  }, [activeTarget, addMessage, updateMessage, setStreaming, setPhase, incrementToolCalls, incrementFindings, setRunning, reset])

  const handleStop = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setStreaming(false)
      setRunning(false)
    }
  }, [setStreaming, setRunning])

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
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
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

function MessageBubble({ message }: { message: StreamMessage }) {
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

  // Default: user or assistant text
  const chatMsg = message as ChatMessage
  const isUser = chatMsg.role === 'user'
  return (
    <div className={cn('my-2 px-4', isUser ? 'text-right' : '')}>
      <div className={cn(
        'inline-block max-w-[85%] text-sm leading-relaxed',
        isUser
          ? 'bg-zinc-800 text-zinc-100 rounded-xl rounded-tr-sm px-4 py-2'
          : 'text-zinc-200',
      )}>
        {chatMsg.content}
      </div>
    </div>
  )
}
