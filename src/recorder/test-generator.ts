import {
  Interaction,
  InteractionType,
  TestCase,
} from './interaction'

export function generateTestCases(interaction: Interaction): TestCase[] {
  const testCases: TestCase[] = []
  const baseId = interaction.id

  switch (interaction.type) {
    case InteractionType.GOTO:
      testCases.push({
        id: `${baseId}-happy`,
        name: `navigate to ${interaction.url} - happy`,
        type: 'happy',
        description: `Navigate to ${interaction.url} successfully`,
        interactions: [interaction],
        assertions: [],
        tags: ['navigation', 'happy'],
        endpoint: interaction.url,
        method: 'GET',
      })
      break

    case InteractionType.CLICK:
      testCases.push({
        id: `${baseId}-happy`,
        name: `click ${interaction.selector} - happy`,
        type: 'happy',
        description: `Click element ${interaction.selector} successfully`,
        interactions: [interaction],
        assertions: [],
        tags: ['click', 'happy'],
      })
      break

    case InteractionType.FILL:
      testCases.push({
        id: `${baseId}-happy`,
        name: `fill ${interaction.selector} - happy`,
        type: 'happy',
        description: `Fill field ${interaction.selector} with valid value`,
        interactions: [interaction],
        assertions: [],
        tags: ['input', 'happy'],
      })
      testCases.push({
        id: `${baseId}-sad`,
        name: `fill ${interaction.selector} - empty`,
        type: 'sad',
        description: `Fill field ${interaction.selector} with empty string`,
        interactions: [{ ...interaction, value: '', description: `${interaction.description} (empty)` }],
        assertions: [],
        tags: ['input', 'sad', 'empty'],
      })
      testCases.push({
        id: `${baseId}-edge`,
        name: `fill ${interaction.selector} - long string`,
        type: 'edge',
        description: `Fill field ${interaction.selector} with very long string (5000 chars)`,
        interactions: [{ ...interaction, value: 'A'.repeat(5000), description: `${interaction.description} (long)` }],
        assertions: [],
        tags: ['input', 'edge', 'overflow'],
      })
      testCases.push({
        id: `${baseId}-security`,
        name: `fill ${interaction.selector} - XSS payload`,
        type: 'security',
        description: `Fill field ${interaction.selector} with XSS payload <script>alert(1)</script>`,
        interactions: [{ ...interaction, value: '<script>alert(1)</script>', description: `${interaction.description} (xss)` }],
        assertions: [],
        tags: ['input', 'security', 'xss'],
      })
      testCases.push({
        id: `${baseId}-security-sqli`,
        name: `fill ${interaction.selector} - SQLi payload`,
        type: 'security',
        description: `Fill field ${interaction.selector} with SQLi payload ' OR 1=1--`,
        interactions: [{ ...interaction, value: "' OR 1=1--", description: `${interaction.description} (sqli)` }],
        assertions: [],
        tags: ['input', 'security', 'sqli'],
      })
      break

    case InteractionType.ACT:
      testCases.push({
        id: `${baseId}-happy`,
        name: `act: ${interaction.naturalLanguage?.slice(0, 40)}`,
        type: 'happy',
        description: interaction.description,
        interactions: [interaction],
        assertions: [],
        tags: ['act', 'happy'],
      })
      break

    case InteractionType.EXTRACT:
      testCases.push({
        id: `${baseId}-happy`,
        name: `extract: ${interaction.description.slice(0, 40)}`,
        type: 'happy',
        description: interaction.description,
        interactions: [interaction],
        assertions: [],
        tags: ['extract', 'happy'],
      })
      break

    case InteractionType.API_CALL: {
      const method = (interaction.metadata?.method as string) || 'GET'
      testCases.push({
        id: `${baseId}-happy`,
        name: `api ${method} ${interaction.url?.slice(0, 40)}`,
        type: 'happy',
        description: interaction.description,
        interactions: [interaction],
        assertions: [],
        tags: ['api', 'happy'],
        endpoint: interaction.url,
        method,
      })
      break
    }
  }

  return testCases
}