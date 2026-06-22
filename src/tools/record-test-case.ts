import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'

export const recordTestCase = createTool({
  id: 'recordTestCase',
  description: 'Proactively record a test case for a discovered endpoint. Call this after every test attempt to build a coverage map. Automatically links to the parent action/page node via the graph store.',
  inputSchema: z.object({
    parentActionId: z.string().describe('The ID of the parent action or page node this test targets'),
    testType: z.enum(['xss', 'sqli', 'idor', 'jwt', 'race', 'logic', 'graphql', 'mass-assignment', 'waf-bypass', 'second-order', 'oauth', 'other']).describe('Category of the security test'),
    status: z.enum(['pass', 'fail', 'vulnerable', 'error', 'inconclusive']).describe('Result of the test attempt'),
    endpoint: z.string().describe('The full URL or endpoint path that was tested'),
    technique: z.string().describe('Specific technique used, e.g. "reflected-xss-get", "time-based-blind-sqli", "horizontal-idor"'),
    payload: z.string().describe('The payload or parameter value used in this test'),
    tags: z.array(z.string()).optional().default([]).describe('Optional tags like "blind", "authenticated", "parameter-pollution"'),
    expectedResult: z.string().optional().describe('What behavior was expected if vulnerable'),
    actualResult: z.string().optional().describe('What actually happened (status code, response text, timing)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    testId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const node = store.addTest(input.parentActionId, {
        testType: input.testType,
        status: input.status,
        endpoint: input.endpoint,
        technique: input.technique,
        payload: input.payload,
        tags: input.tags,
        expectedResult: input.expectedResult,
        actualResult: input.actualResult,
      })
      return { ok: true, testId: node.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
