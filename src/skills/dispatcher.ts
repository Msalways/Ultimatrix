import { loadSkill, searchSkills, type Skill } from './loader'

const SKILL_ROUTES: Array<{ patterns: string[]; skillIds: string[] }> = [
  { patterns: ['sql injection', 'sqli', 'sqlmap', 'union', 'blind'], skillIds: ['pentest-flow'] },
  { patterns: ['xss', 'cross-site', 'script', 'reflected', 'stored'], skillIds: ['pentest-flow'] },
  { patterns: ['ssrf', 'server-side request', 'internal', 'gopher'], skillIds: ['pentest-flow'] },
  { patterns: ['idor', 'authorization', 'privilege', 'access control', 'role'], skillIds: ['pentest-flow'] },
  { patterns: ['race condition', 'concurrent', 'parallel request', 'toctou'], skillIds: ['pentest-flow'] },
  { patterns: ['file upload', 'multipart', 'webshell'], skillIds: ['pentest-flow'] },
  { patterns: ['command injection', 'rce', 'exec', 'shell'], skillIds: ['pentest-flow'] },
  { patterns: ['waf', 'blocked', 'firewall', '403'], skillIds: ['pentest-flow'] },
  { patterns: ['jwt', 'token', 'session', 'cookie', 'auth'], skillIds: ['pentest-flow'] },
  { patterns: ['recon', 'enumerate', 'scan', 'discover', 'map'], skillIds: ['pentest-flow'] },
  { patterns: ['information disclosure', 'leak', '.git', '.env', 'backup', 'source code'], skillIds: ['pentest-flow'] },
  { patterns: ['config', 'misconfiguration', 'default', 'debug'], skillIds: ['pentest-flow'] },
]

export interface DispatchResult {
  skills: Skill[]
  matchedRoutes: string[]
}

export function dispatch(userInput: string): DispatchResult {
  const input = userInput.toLowerCase()
  const matchedSkillIds = new Set<string>()
  const matchedRoutes: string[] = []

  for (const route of SKILL_ROUTES) {
    if (route.patterns.some(p => input.includes(p))) {
      for (const id of route.skillIds) {
        matchedSkillIds.add(id)
      }
      matchedRoutes.push(route.patterns[0])
    }
  }

  if (matchedSkillIds.size === 0) {
    const results = searchSkills(userInput)
    return {
      skills: results.slice(0, 3),
      matchedRoutes: results.length > 0 ? ['keyword_search'] : [],
    }
  }

  const skills = [...matchedSkillIds]
    .map(id => loadSkill(id))
    .filter((s): s is Skill => s !== null)

  return { skills, matchedRoutes }
}
