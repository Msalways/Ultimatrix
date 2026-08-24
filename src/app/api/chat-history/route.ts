import { NextRequest, NextResponse } from 'next/server'
import { resolve } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { getTargetWorkspaceDir } from '@/workspace'
import { persistWebSession } from '@/web/session-registry'

export const dynamic = 'force-dynamic'

interface PersistedMessage {
  id: string
  timestamp: number
  [key: string]: unknown
}

function historyPath(target: string): string {
  return resolve(getTargetWorkspaceDir(target), 'web-chat-history.json')
}

function sanitizeMessages(messages: unknown): PersistedMessage[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message): message is PersistedMessage => {
      if (!message || typeof message !== 'object') return false
      const candidate = message as Record<string, unknown>
      return typeof candidate.id === 'string' && typeof candidate.timestamp === 'number'
    })
    .slice(-300)
}

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    if (!target) {
      return NextResponse.json({ messages: [] })
    }

    try {
      const file = await readFile(historyPath(target), 'utf8')
      const parsed = JSON.parse(file)
      return NextResponse.json({ messages: sanitizeMessages(parsed.messages) })
    } catch {
      return NextResponse.json({ messages: [] })
    }
  } catch (err) {
    return NextResponse.json({ messages: [], error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    if (!target) {
      return NextResponse.json({ error: 'target is required' }, { status: 400 })
    }

    const body = await req.json()
    const messages = sanitizeMessages(body.messages)
    const targetDir = getTargetWorkspaceDir(target)
    await mkdir(targetDir, { recursive: true })
    await persistWebSession(target)
    await writeFile(
      historyPath(target),
      JSON.stringify({ target, updatedAt: new Date().toISOString(), messages }, null, 2),
      'utf8',
    )
    return NextResponse.json({ ok: true, count: messages.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target')?.trim()
  if (!target) return Response.json({ error: 'target is required' }, { status: 400 })

  try {
    await writeFile(historyPath(target), JSON.stringify({ target, messages: [], updatedAt: new Date().toISOString() }, null, 2), 'utf8')
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
