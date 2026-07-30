import { writeFile, mkdir, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {dirname} from 'node:path'
import { TestCase, Interaction, InteractionType } from './interaction'

export function generateSpecCode(testCases: TestCase[], specName?: string): string {
  const lines: string[] = []
  lines.push(`import { test, expect } from '@playwright/test'`)
  lines.push('')
  if (specName) {
    lines.push(`// Spec: ${specName}`)
    lines.push(`// Generated: ${new Date().toISOString()}`)
    lines.push('')
  }

  for (const tc of testCases) {
    lines.push(`test('${escapeQuotes(tc.name)}', async ({ page }) => {`)

    for (const interaction of tc.interactions) {
      lines.push(...interactionToPlaywright(interaction))
    }

    for (const assertion of tc.assertions) {
      if (assertion.selector && assertion.expected) {
        lines.push(`  await expect(page.locator('${escapeQuotes(assertion.selector)}')).toHaveText('${escapeQuotes(assertion.expected)}')`)
      }
    }

    tc.interactions.filter(i => i.type === InteractionType.GOTO).forEach(i => {
      if (i.url) {
        lines.push(`  await expect(page).toHaveURL(/.*${escapeRegex(i.url)}/)`)
      }
    })

    lines.push(`})`)
    lines.push('')
  }

  return lines.join('\n')
}

function interactionToPlaywright(interaction: Interaction): string[] {
  const lines: string[] = []
  const indent = '  '

  switch (interaction.type) {
    case InteractionType.GOTO:
      if (interaction.url) {
        lines.push(`${indent}// ${interaction.description}`)
        lines.push(`${indent}await page.goto('${escapeQuotes(interaction.url)}')`)
        lines.push(`${indent}await page.waitForLoadState('networkidle')`)
      }
      break

    case InteractionType.CLICK:
      if (interaction.selector) {
        lines.push(`${indent}// ${interaction.description}`)
        lines.push(`${indent}await page.click('${escapeQuotes(interaction.selector)}')`)
      }
      break

    case InteractionType.FILL:
      if (interaction.selector) {
        lines.push(`${indent}// ${interaction.description}`)
        if (interaction.value === '') {
          lines.push(`${indent}await page.fill('${escapeQuotes(interaction.selector)}', '')`)
        } else if (interaction.value) {
          lines.push(`${indent}await page.fill('${escapeQuotes(interaction.selector)}', '${escapeQuotes(interaction.value)}')`)
        }
      }
      break

    case InteractionType.SNAPSHOT:
      lines.push(`${indent}// ${interaction.description}`)
      lines.push(`${indent}await page.screenshot({ path: 'screenshots/${interaction.id}.png' })`)
      break

    case InteractionType.EVALUATE:
      lines.push(`${indent}// ${interaction.description}`)
      lines.push(`${indent}const result = await page.evaluate(() => document.title)`)
      break

    case InteractionType.EXTRACT:
      lines.push(`${indent}// ${interaction.description}`)
      lines.push(`${indent}const content = await page.textContent('body')`)
      break

    case InteractionType.ASSERT:
      lines.push(`${indent}// ${interaction.description}`)
      if (interaction.selector) {
        lines.push(`${indent}await expect(page.locator('${escapeQuotes(interaction.selector)}')).toBeVisible()`)
      }
      break

    case InteractionType.API_CALL: {
      const method = (interaction.metadata?.method as string) || 'GET'
      const url = interaction.url || ''
      const methodLower = method.toLowerCase()
      const methodVar = methodLower === 'delete' ? 'del' : methodLower
      if (['get', 'post', 'put', 'patch', 'del'].includes(methodVar)) {
        lines.push(`${indent}// ${interaction.description}`)
        if (interaction.metadata?.body) {
          lines.push(`${indent}const response = await page.request.${methodVar}('${escapeQuotes(url)}', { data: ${JSON.stringify(interaction.metadata.body)} })`)
        } else {
          lines.push(`${indent}const response = await page.request.${methodVar}('${escapeQuotes(url)}')`)
        }
        lines.push(`${indent}expect(response.ok()).toBeTruthy()`)
      }
      break
    }
  }

  return lines
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'").replace(/`/g, '\\`')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function streamToFile(filePath: string, testCases: TestCase[]): Promise<void> {
  const code = generateSpecCode(testCases)

  try {
    await access(filePath)
    const { appendFile } = await import('node:fs/promises')
    await appendFile(filePath, '\n' + code, 'utf-8')
  } catch {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(filePath, code, 'utf-8')
  }
}

export type { TestCase }