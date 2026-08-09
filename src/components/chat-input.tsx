'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { MessageCircle, Play, Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string, mode: InputMode) => void
  onStop?: () => void
  disabled?: boolean
  isStreaming?: boolean
  placeholder?: string
}

export type InputMode = 'ask' | 'run'

export function ChatInput({ onSend, onStop, disabled, isStreaming, placeholder = 'Type a message...' }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<InputMode>('run')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, mode)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend, mode])

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
        <div className="mb-2 flex items-center gap-1" role="group" aria-label="Interaction mode">
          <button
            type="button"
            onClick={() => setMode('ask')}
            disabled={isStreaming}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              mode === 'ask' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <MessageCircle size={12} /> Ask
          </button>
          <button
            type="button"
            onClick={() => setMode('run')}
            disabled={isStreaming}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              mode === 'run' ? 'bg-emerald-950/60 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Play size={12} /> Run
          </button>
        </div>
        <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'run' ? 'Describe the assessment task to execute...' : placeholder}
          disabled={disabled || isStreaming}
          rows={1}
          className={cn(
            'max-h-[180px] min-h-11 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 px-3.5 py-3',
            'text-sm text-zinc-100 placeholder:text-zinc-500',
            'transition-colors focus:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-800',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-red-950/50 text-red-300 transition-colors hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800"
            title="Stop"
            aria-label="Stop"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
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
