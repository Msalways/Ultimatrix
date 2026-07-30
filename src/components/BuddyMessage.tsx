'use client'

import type { RenderModel } from '../output/render-model'
import { MarkdownBlock } from './markdown-block'

/**
 * BuddyMessage — renders the buddy's reasoning + answer as highlighted Markdown.
 *
 * Now uses the shared MarkdownBlock component from markdown-block.tsx.
 */

interface BuddyMessageProps {
  model: RenderModel
  streaming?: boolean
}

export function BuddyMessage({ model, streaming = false }: BuddyMessageProps) {
  const reasoning = model.reasoning.trim()
  const answer = model.answer.trim()

  return (
    <div className="buddy-message space-y-3 text-sm text-foreground">
      {reasoning && (
        <div className="buddy-reasoning opacity-70">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            ⟢ thinking
          </div>
          <MarkdownBlock content={reasoning} />
        </div>
      )}

      {answer && (
        <div className="buddy-answer">
          <MarkdownBlock content={answer} streaming={streaming} />
        </div>
      )}

      {!reasoning && !answer && (
        <div className="text-muted-foreground text-xs">Waiting for the buddy…</div>
      )}
    </div>
  )
}
