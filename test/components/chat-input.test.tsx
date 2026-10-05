import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChatInput } from '../../src/components/chat-input'

describe('ChatInput execution mode', () => {
  it('defaults to Ask and exposes an accessible Run tests option', () => {
    const markup = renderToStaticMarkup(createElement(ChatInput, { onSend: vi.fn() }))

    expect(markup).toContain('role="group" aria-label="Execution mode"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('>Ask</button>')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('>Run tests</button>')
    expect(markup).toContain('aria-describedby="chat-input-mode-help"')
    expect(markup).toContain('Choose Run tests to start active experiments.')
  })
})
