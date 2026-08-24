import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { SkillRegistry } from '@/solver/skills/registry'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    const engine = target
      ? targetManager.getEngine(target)
      : (await targetManager.listTargets()).length > 0
        ? targetManager.getEngine((await targetManager.listTargets()).pop()!.target)
        : null

    const registry = engine?.isInitialized() ? engine.getSkillRegistry() : new SkillRegistry()
    if (!engine?.isInitialized()) registry?.loadFromDirectory('skills')
    if (!registry) return NextResponse.json({ skills: [] })
    const skills = registry.list()
    const skillData = skills.map((s: any) => ({
      id: s.id,
      name: s.name ?? s.id,
      description: s.description ?? '',
      domain: s.domain ?? 'general',
      tier: s.tier ?? 'balanced',
      tags: s.tags ?? [],
      state: 'available' as const,
    }))

    return NextResponse.json({ skills: skillData })
  } catch (err) {
    return NextResponse.json({ skills: [], error: (err as Error).message }, { status: 500 })
  }
}

/**
 * Phase D (D8) — runtime skill import. Accepts pasted markdown or a server-
 * local path, routes through the SAME manageSkills path the brain uses
 * (validation gate + hot reload). No restart required.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { markdown?: string; path?: string }
      | null

    const { manageSkills } = await import('@/tools/skill-manage-tools')
    const input = body?.markdown !== undefined
      ? { action: 'add' as const, markdown: body.markdown }
      : body?.path !== undefined
        ? { action: 'add' as const, path: body.path }
        : null
    if (!input) {
      return NextResponse.json({ ok: false, errors: ['provide markdown or path'] }, { status: 400 })
    }

    const result = await (manageSkills as any).execute(input)
    if (!result?.ok) {
      return NextResponse.json({ ok: false, errors: result?.errors ?? ['import failed'] }, { status: 400 })
    }
    return NextResponse.json({ ok: true, message: result.message })
  } catch (err) {
    return NextResponse.json({ ok: false, errors: [(err as Error).message] }, { status: 500 })
  }
}

/** Remove an imported skill by id (user/<name>). */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, errors: ['id required'] }, { status: 400 })

    const { manageSkills } = await import('@/tools/skill-manage-tools')
    const result = await (manageSkills as any).execute({ action: 'remove', id })
    if (!result?.ok) {
      return NextResponse.json({ ok: false, errors: result?.errors ?? ['remove failed'] }, { status: 400 })
    }
    return NextResponse.json({ ok: true, message: result.message })
  } catch (err) {
    return NextResponse.json({ ok: false, errors: [(err as Error).message] }, { status: 500 })
  }
}
