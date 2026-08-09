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
