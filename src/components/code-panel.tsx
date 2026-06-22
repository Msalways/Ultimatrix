'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { Copy, Check, Download } from 'lucide-react'

function highlightSyntax(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const lines = escaped.split('\n')
  return lines.map(line => {
    let out = ''
    let i = 0

    while (i < line.length) {
      // Single-line comment: //
      if (line[i] === '/' && line[i + 1] === '/') {
        out += `<span class="text-green-500/70">${line.slice(i)}</span>`
        break
      }

      // String (double or single quote)
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const quote = line[i]
        let j = i + 1
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\') j++
          j++
        }
        out += `<span class="text-orange-400">${line.slice(i, j + 1)}</span>`
        i = j + 1
        continue
      }

      // Template literal ${...}
      if (line[i] === '$' && line[i + 1] === '{') {
        out += `<span class="text-yellow-400">${line[i]}${line[i + 1]}</span>`
        i += 2
        continue
      }

      // Keywords
      const wordEnd = /[\w$]/.test(line[i])
      if (wordEnd) {
        let j = i
        while (j < line.length && /[\w$]/.test(line[j])) j++
        const word = line.slice(i, j)
        const keywords = ['import', 'from', 'const', 'let', 'var', 'async', 'await', 'function', 'return', 'if', 'else', 'for', 'of', 'in', 'new', 'throw', 'try', 'catch', 'export', 'default', 'class', 'type', 'interface', 'extends', 'implements']
        const types = ['string', 'number', 'boolean', 'void', 'any', 'never', 'Page', 'Browser', 'Locator', 'ElementHandle', 'Response', 'Request', 'Frame']
        if (keywords.includes(word)) {
          out += `<span class="text-purple-400">${word}</span>`
        } else if (types.includes(word) || word[0] === word[0]?.toUpperCase()) {
          out += `<span class="text-blue-400">${word}</span>`
        } else if (word === 'true' || word === 'false' || word === 'null' || word === 'undefined') {
          out += `<span class="text-yellow-400">${word}</span>`
        } else {
          out += word
        }
        i = j
        continue
      }

      // Number literals
      if (/[0-9]/.test(line[i])) {
        let j = i
        while (j < line.length && /[0-9.]/.test(line[j])) j++
        out += `<span class="text-yellow-400">${line.slice(i, j)}</span>`
        i = j
        continue
      }

      // Operators & punctuation
      if (/[{}()\[\],;.:=+\-*/%!<>?|&^~]/.test(line[i])) {
        out += `<span class="text-muted-foreground">${line[i]}</span>`
        i++
        continue
      }

      out += line[i]
      i++
    }

    return out
  }).join('\n')
}

export function CodePanel() {
  const [codeSnippets, setCodeSnippets] = useState<string[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  useEffect(() => {
    function fetchCode() {
      fetch('/api/code')
        .then(r => r.json())
        .then(d => setCodeSnippets(d.code ?? []))
        .catch(() => {})
    }
    fetchCode()
    const id = setInterval(fetchCode, 3000)
    return () => clearInterval(id)
  }, [])

  const handleCopy = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-border px-6 py-3 flex items-center">
        <h2 className="text-sm font-semibold">Playwright Test Code</h2>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 max-w-3xl mx-auto">
          {codeSnippets.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No test code generated yet.</p>
          )}
          {codeSnippets.map((code, i) => (
            <Card key={i}>
              <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-mono text-muted-foreground">Test {i + 1}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => {
                    const blob = new Blob([code], { type: 'text/typescript' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `ultimatrix-test-${i + 1}.spec.ts`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}>
                    <Download size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleCopy(code, i)}>
                    {copiedIndex === i ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <pre className="text-xs font-mono bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: highlightSyntax(code) }} />
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
