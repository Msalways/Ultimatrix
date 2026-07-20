'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { RenderModel } from '../output/render-model'

/**
 * BuddyMessage — renders the buddy's reasoning + answer as highlighted Markdown.
 *
 * Co-relation rule: Markdown is PROSE FORMATTING ONLY. Severity/status live in
 * structured RenderModel fields (findings, phase) — never in the markdown. The
 * Evidence Ledger + phase rail are separate panes, not this component.
 *
 * Streaming: react-markdown tolerates an unclosed code fence (renders the tail
 * as plain text) — this is the web equivalent of the terminal open-fence
 * fallback. No `rehype-raw`, so user/LLM HTML cannot inject (XSS-safe).
 */

interface BuddyMessageProps {
  model: RenderModel
  /** While streaming, show a blinking caret at the live tail. */
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

function MarkdownBlock({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <>
      <div className="markdown-body ultimatrix-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="text-base font-bold uppercase tracking-wide text-primary mt-2 mb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-sm font-bold uppercase tracking-wide text-primary mt-2 mb-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-semibold uppercase tracking-wide text-primary mt-2 mb-1">{children}</h3>,
            strong: ({ children }) => <strong className="font-semibold text-[var(--instrument,#36C9E6)]">{children}</strong>,
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer" className="text-[var(--instrument,#36C9E6)] underline underline-offset-2">
                {children}
              </a>
            ),
            code({ className: cls, children, ...rest }) {
              const match = /language-(\w+)/.exec(cls || '')
              const isBlock = Boolean(cls)
              if (isBlock && match) {
                return (
                  <SyntaxHighlighter
                    language={match[1]}
                    style={oneDark}
                    customStyle={{
                      margin: '0.5rem 0',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(43,224,138,0.25)',
                      background: 'rgba(43,224,138,0.04)',
                      fontSize: '0.8rem',
                    }}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                )
              }
              return (
                <code className="rounded bg-[rgba(43,224,138,0.12)] px-1 py-0.5 text-[0.8em] text-primary" {...rest}>
                  {children}
                </code>
              )
            },
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border bg-muted/50 px-2 py-1 text-left font-semibold text-primary">{children}</th>
            ),
            td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-primary animate-pulse" aria-hidden />}
    </>
  )
}
