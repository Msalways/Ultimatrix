'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string, mode: InputMode) => void
  onSteer?: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isStreaming?: boolean
  placeholder?: string
}

export type InputMode = 'auto' | 'run'

export function ChatInput({ onSend, onSteer, onStop, disabled, isStreaming, placeholder = 'Type a message...' }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<InputMode>('auto')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (isStreaming) onSteer?.(trimmed)
    else {
      onSend(trimmed, mode)
      setMode('auto')
    }
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, isStreaming, onSend, onSteer, mode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleInput = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
    }
  }, [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-950 p-3">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit rounded-md border border-zinc-800 bg-zinc-900 p-0.5" role="group" aria-label="Execution mode">
            <button
              type="button"
              aria-pressed={mode === 'auto'}
              disabled={disabled || isStreaming}
              onClick={() => setMode('auto')}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-50',
                mode === 'auto' ? 'bg-zinc-200 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              Ask
            </button>
            <button
              type="button"
              aria-pressed={mode === 'run'}
              disabled={disabled || isStreaming}
              onClick={() => setMode('run')}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50',
                mode === 'run' ? 'bg-amber-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              Run tests
            </button>
          </div>
          <p id="chat-input-mode-help" className={cn('text-xs', mode === 'run' ? 'text-amber-300/90' : 'text-zinc-500')} aria-live="polite">
            {mode === 'run'
              ? 'Run mode applies to your next message. State-changing requests show a secret-redacted request summary for approval.'
              : 'Ask about the target or plan work. Choose Run tests to start active experiments.'}
          </p>
        </div>
        <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-describedby="chat-input-mode-help"
          disabled={disabled || (isStreaming && !onSteer)}
          rows={1}
          className={cn(
            'max-h-[180px] min-h-11 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 px-3.5 py-3',
            'text-sm text-zinc-100 placeholder:text-zinc-500',
            'transition-colors focus:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-800',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        {isStreaming && (
          <button
            onClick={onStop}
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-red-950/50 text-red-300 transition-colors hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800"
            title="Stop"
            aria-label="Stop"
          >
            <Square size={16} />
          </button>
        )}
        {(!isStreaming || onSteer) && (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled || (isStreaming && !onSteer)}
            className={cn(
              'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600',
              value.trim() && !disabled
                ? 'bg-zinc-100 text-zinc-950 hover:bg-white'
                : 'bg-zinc-900 text-zinc-600 cursor-not-allowed',
            )}
            title="Send"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        )}
        </div>
      </div>
    </div>
  )
}
