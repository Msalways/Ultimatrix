import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { SKILLS_DIR } from '../lib/project-root'

export interface Skill {
  name: string
  description: string
  content: string
  category: string
  filePath: string
}

export interface SkillCategory {
  name: string
  description: string
  skills: Skill[]
}

const DEFAULT_SKILLS_DIR = SKILLS_DIR

export async function loadSkill(name: string, skillsDir: string = DEFAULT_SKILLS_DIR): Promise<Skill | null> {
  const entries = await readdir(skillsDir).catch(() => [])

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry)
    const entryStat = await stat(entryPath).catch(() => null)
    if (!entryStat) continue

    if (entryStat.isDirectory()) {
      const files = await readdir(entryPath)
      for (const file of files) {
        if (file === `${name}.md` || file.replace('.md', '') === name) {
          const content = await readFile(join(entryPath, file), 'utf-8')
          return parseSkill(content, name, entry, join(entryPath, file))
        }
      }
    }
  }

  return null
}

export async function loadAllSkills(skillsDir: string = DEFAULT_SKILLS_DIR): Promise<Skill[]> {
  const skills: Skill[] = []

  try {
    const entries = await readdir(skillsDir)

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry)
      const entryStat = await stat(entryPath).catch(() => null)
      if (!entryStat || !entryStat.isDirectory()) continue

      try {
        const files = await readdir(entryPath)
        for (const file of files) {
          if (file.endsWith('.md')) {
            const content = await readFile(join(entryPath, file), 'utf-8')
            const name = file.replace('.md', '')
            skills.push(parseSkill(content, name, entry, join(entryPath, file)))
          }
        }
      } catch {
        // Skip directory read errors
      }
    }
  } catch {
    // Skills directory doesn't exist
  }

  return skills
}

export async function getSkillsByCategory(category: string, skillsDir: string = DEFAULT_SKILLS_DIR): Promise<Skill[]> {
  const allSkills = await loadAllSkills(skillsDir)
  return allSkills.filter(s => s.category === category)
}

export async function getCategories(skillsDir: string = DEFAULT_SKILLS_DIR): Promise<SkillCategory[]> {
  const allSkills = await loadAllSkills(skillsDir)
  const categoryMap = new Map<string, Skill[]>()

  for (const skill of allSkills) {
    const existing = categoryMap.get(skill.category) || []
    existing.push(skill)
    categoryMap.set(skill.category, existing)
  }

  return Array.from(categoryMap.entries()).map(([name, skills]) => ({
    name,
    description: `Skills related to ${name}`,
    skills,
  }))
}

function parseSkill(content: string, name: string, category: string, filePath: string): Skill {
  // Extract description from first paragraph or frontmatter
  const lines = content.split('\n')
  let description = ''

  // Check for YAML frontmatter
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.indexOf('---', 1)
    if (endIndex > 0) {
      const frontmatter = lines.slice(1, endIndex).join('\n')
      const descMatch = frontmatter.match(/description:\s*(.+)/)
      if (descMatch) {
        description = descMatch[1].trim()
      }
    }
  }

  // Fallback to first non-empty, non-heading line
  if (!description) {
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        description = trimmed
        break
      }
    }
  }

  return {
    name,
    description: description.substring(0, 200),
    content,
    category,
    filePath,
  }
}

// Built-in knowledge-based skills (no hardcoding, just concepts)
export const BUILTIN_SKILLS: Record<string, string> = {
  'authorization': `
# Authorization Testing

## What is Authorization Testing?
Authorization testing verifies that users can only access resources they're permitted to access. It checks whether the application properly enforces access controls across all endpoints.

## Key Concepts
- **Broken Access Control**: Users accessing resources they shouldn't
- **IDOR (Insecure Direct Object Reference)**: Accessing objects by manipulating identifiers
- **Privilege Escalation**: Regular users gaining admin access
- **Forced Browsing**: Accessing authenticated pages without credentials

## Reasoning Framework
1. Identify all endpoints that require authentication
2. Map user roles and their expected permissions
3. Test each endpoint with different user contexts
4. Verify that access is denied when appropriate
5. Check for information disclosure in error responses

## What to Look For
- Endpoints that return data for other users
- Admin functionality accessible to regular users
- Missing role checks on sensitive operations
- Predictable resource identifiers
`,

  'business-logic': `
# Business Logic Testing

## What is Business Logic Testing?
Business logic testing identifies flaws in application workflows that allow users to manipulate intended business processes for malicious purposes.

## Key Concepts
- **Workflow Bypass**: Skipping steps in multi-step processes
- **Data Manipulation**: Modifying data during processing
- **Race Conditions**: Exploiting timing in concurrent operations
- **Price/Quantity Manipulation**: Altering values in e-commerce flows

## Reasoning Framework
1. Understand the intended business flow
2. Identify all validation points
3. Test each step for bypass opportunities
4. Check for data integrity across steps
5. Verify final state matches expectations

## What to Look For
- Missing validation on client-side only
- Steps that can be skipped or reordered
- Values that can be modified mid-process
- Concurrent requests that bypass checks
`,

  'information-disclosure': `
# Information Disclosure Testing

## What is Information Disclosure Testing?
Information disclosure testing identifies unintended data exposure through responses, error messages, headers, or other channels.

## Key Concepts
- **Verbose Errors**: Stack traces, database errors, internal paths
- **Sensitive Data in Responses**: Hidden fields, comments, metadata
- **Server Information**: Version numbers, technology stack
- **Debug Information**: Development data in production

## Reasoning Framework
1. Analyze all response headers for information leaks
2. Check error responses for internal details
3. Examine HTML source for comments and hidden data
4. Review API responses for excessive data
5. Check for debug endpoints and verbose logging

## What to Look For
- Server headers revealing technology versions
- Error messages with database details
- HTML comments with sensitive information
- API responses with unnecessary fields
- Stack traces in error pages
`,

  'race-conditions': `
# Race Condition Testing

## What is Race Condition Testing?
Race condition testing identifies vulnerabilities where concurrent requests can bypass security controls or manipulate application state.

## Key Concepts
- **TOCTOU (Time of Check to Time of Use)**: Gap between validation and action
- **Double-Spend**: Using same resource twice before update
- **Privilege Escalation**: Concurrent requests gaining higher access
- **Data Corruption**: Simultaneous modifications causing inconsistency

## Reasoning Framework
1. Identify state-changing operations
2. Test with concurrent requests
3. Verify atomicity of operations
4. Check for proper locking mechanisms
5. Validate final state consistency

## What to Look For
- Balance transfers with concurrent requests
- Coupon/voucher redemption with multiple uses
- Resource allocation with concurrent access
- Form submissions with rapid resubmission
`,
}

export function getBuiltinSkill(name: string): string | undefined {
  return BUILTIN_SKILLS[name]
}
