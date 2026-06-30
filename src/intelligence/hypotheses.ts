import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { AnyNodeData, ActionNode, PageNode } from '../graph/schema'
import type { SkillRegistry } from '../skills/registry'

export interface Hypothesis {
  id: string
  technique: string
  endpointId: string
  endpointUrl: string
  priority: number
  description: string
  actionType?: string
}

export function generateDynamicHypotheses(
  skillRegistry: SkillRegistry,
  targetFeatures: string[] = []
): Hypothesis[] {
  const hypotheses: Hypothesis[] = []
  let id = 0

  // Use skill search to find relevant techniques for target features
  for (const feature of targetFeatures) {
    const matchingSkills = skillRegistry.search(feature)
    for (const skill of matchingSkills.slice(0, 3)) {
      hypotheses.push({
        id: `h-${skill.id}-${++id}`,
        technique: skill.id,
        endpointId: 'dynamic',
        endpointUrl: feature,
        priority: calculatePriority(skill),
        description: skill.description,
      })
    }
  }

  // Also search for common patterns
  const commonPatterns = ['injection', 'xss', 'api', 'auth', 'upload', 'graphql']
  for (const pattern of commonPatterns) {
    const skills = skillRegistry.search(pattern)
    for (const skill of skills.slice(0, 2)) {
      if (!hypotheses.some(h => h.technique === skill.id)) {
        hypotheses.push({
          id: `h-${skill.id}-${++id}`,
          technique: skill.id,
          endpointId: 'pattern',
          endpointUrl: pattern,
          priority: calculatePriority(skill),
          description: skill.description,
        })
      }
    }
  }

  hypotheses.sort((a, b) => b.priority - a.priority)
  return hypotheses
}

function calculatePriority(skill: { id: string; description: string; toolRefs: string[] }): number {
  if (skill.toolRefs.length > 0) return 3
  if (skill.description.toLowerCase().includes('auth')) return 3
  if (skill.description.toLowerCase().includes('recon')) return 2
  return 1
}

export function generateHypotheses(): Hypothesis[] {
  const store = getGlobalGraphStore()
  const hypotheses: Hypothesis[] = []
  let id = 0

  const pages = store.queryNodes(NodeType.PAGE) as PageNode[]
  const untestedActions = store.getUntestedActions()

  const endpoints = new Map<string, PageNode>()
  for (const page of pages) {
    endpoints.set(page.id, page)
  }

  for (const action of untestedActions) {
    const page = endpoints.get(store.queryNodes(NodeType.PAGE).find(p => action.id.startsWith(p.id + ':'))?.id || '')

    if (!action.properties.url && !page) continue
    const url = (action.properties.url || page?.properties.url || '')

    if (url.includes('api/') || url.includes('/api')) {
      hypotheses.push({
        id: `h-${++id}`,
        technique: 'api-security',
        endpointId: action.id,
        endpointUrl: url,
        priority: 3,
        description: `API endpoint ${url} needs testing for IDOR, mass assignment, and authentication bypass`,
        actionType: action.properties.actionType,
      })
    }

    if (action.properties.actionType === 'fill' || action.properties.naturalLanguage) {
      hypotheses.push({
        id: `h-${++id}`,
        technique: 'xss',
        endpointId: action.id,
        endpointUrl: url,
        priority: 2,
        description: `Form input at ${url} should be tested for XSS injection`,
        actionType: action.properties.actionType,
      })
      hypotheses.push({
        id: `h-${++id}`,
        technique: 'sqli',
        endpointId: action.id,
        endpointUrl: url,
        priority: 2,
        description: `Form input at ${url} should be tested for SQL injection`,
        actionType: action.properties.actionType,
      })
    }

    if (action.properties.actionType === 'click') {
      hypotheses.push({
        id: `h-${++id}`,
        technique: 'business-logic',
        endpointId: action.id,
        endpointUrl: url,
        priority: 1,
        description: `Interactive element at ${url} may expose business logic vulnerabilities`,
        actionType: action.properties.actionType,
      })
    }
  }

  const allPages = pages
  for (const page of allPages) {
    if (page.properties.requiresAuth) {
      hypotheses.push({
        id: `h-${++id}`,
        technique: 'auth-bypass',
        endpointId: page.id,
        endpointUrl: page.properties.url,
        priority: 3,
        description: `Auth-gated page ${page.properties.url} should be tested for authentication bypass`,
      })
    }
  }

  hypotheses.sort((a, b) => b.priority - a.priority)

  return hypotheses
}

export function prioritizeHypotheses(hypotheses: Hypothesis[]): { breadth: Hypothesis[]; depth: Hypothesis[]; pivot: Hypothesis[] } {
  const seenTechniques = new Set<string>()

  return {
    breadth: hypotheses.filter(h => {
      if (!seenTechniques.has(h.technique)) {
        seenTechniques.add(h.technique)
        return true
      }
      return false
    }),
    depth: hypotheses.filter(h => h.priority >= 2),
    pivot: hypotheses.filter(h => h.priority >= 3),
  }
}