'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

/**
 * MarkdownBlock — reusable markdown renderer with syntax highlighting.
 * Extracted from BuddyMessage.tsx for reuse in chat-stream.tsx.
 *
 * Streaming: react-markdown tolerates an unclosed code fence (renders the tail
 * as plain text). No `rehype-raw`, so user/LLM HTML cannot inject (XSS-safe).
 */

export function MarkdownBlock({ content, streaming = false }: { content: string; streaming?: boolean }) {
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
