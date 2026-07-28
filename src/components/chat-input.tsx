'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isStreaming?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, onStop, disabled, isStreaming, placeholder = 'Type a message...' }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

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
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isStreaming}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3',
            'text-sm text-zinc-100 placeholder:text-zinc-500',
            'focus:outline-none focus:ring-1 focus:ring-zinc-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'max-h-[200px] overflow-y-auto',
          )}
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 p-3 rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
            title="Stop"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className={cn(
              'flex-shrink-0 p-3 rounded-lg transition-colors',
              value.trim() && !disabled
                ? 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                : 'bg-zinc-900 text-zinc-600 cursor-not-allowed',
            )}
            title="Send"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
