import { describe, it, expect, vi } from 'vitest'
import { sanitizeJsonSchema, createSanitizedInputSchema, applySchemaCompat, getSanitizeKeywords, sanitizeRequestBody } from '../../src/models/schema-sanitizer.js'
import { z } from 'zod'
import { createTool } from '@mastra/core/tools'
import type { StandardSchemaV1 } from '@mastra/schema-compat/schema'

describe('schema-sanitizer', () => {
  describe('sanitizeJsonSchema', () => {
    it('returns schema unchanged for non-restricted providers', () => {
      const schema = {
        type: 'object',
        properties: {
          headers: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: { type: 'string' },
          },
        },
      }
      const result = sanitizeJsonSchema(schema, 'openai')
      expect(result).toEqual(schema)
    })

    it('returns schema unchanged when no provider specified (defaults to strict)', () => {
      const schema = {
        type: 'object',
        properties: {
          headers: { type: 'object' },
        },
      }
      const result = sanitizeJsonSchema(schema)
      expect(result).toEqual(schema)
    })

    it('strips propertyNames for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          headers: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: { type: 'string' },
          },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.headers).not.toHaveProperty('propertyNames')
      expect(result.properties!.headers.additionalProperties).toBe(false)
    })

    it('strips format for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.url).not.toHaveProperty('format')
    })

    it('strips pattern for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[a-z]+$' },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.name).not.toHaveProperty('pattern')
    })

    it('strips minItems/maxItems for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.tags).not.toHaveProperty('minItems')
      expect(result.properties!.tags).not.toHaveProperty('maxItems')
      expect(result.properties!.tags).toHaveProperty('items')
    })

    it('strips minLength/maxLength for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.name).not.toHaveProperty('minLength')
      expect(result.properties!.name).not.toHaveProperty('maxLength')
    })

    it('strips $ref and $defs for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          data: { $ref: '#/$defs/Foo' },
        },
        $defs: {
          Foo: { type: 'string' },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result).not.toHaveProperty('$ref')
      expect(result).not.toHaveProperty('$defs')
    })

    it('strips if/then/else for nvidia', () => {
      const schema = {
        type: 'object',
        if: { properties: { type: { const: 'a' } } },
        then: { required: ['extra'] },
        else: {},
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result).not.toHaveProperty('if')
      expect(result).not.toHaveProperty('then')
      expect(result).not.toHaveProperty('else')
    })

    it('converts object-form additionalProperties to boolean false for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          data: { type: 'object', additionalProperties: { type: 'string' } },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.data.additionalProperties).toBe(false)
    })

    it('preserves boolean additionalProperties false', () => {
      const schema = {
        type: 'object',
        properties: {
          data: { type: 'object', additionalProperties: false },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.data.additionalProperties).toBe(false)
    })

    it('preserves LLM keywords: type, properties, required, description, enum, default', () => {
      const schema = {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['GET', 'POST'],
            default: 'GET',
            description: 'HTTP method',
          },
        },
        required: ['method'],
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result).toEqual(schema)
    })

    it('strips exclusiveMinimum/exclusiveMaximum for nvidia', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'integer', exclusiveMinimum: 0, maximum: 100 },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.count).not.toHaveProperty('exclusiveMinimum')
      expect(result.properties!.count).toHaveProperty('maximum')
    })

    it('moderate mode only strips propertyNames, patternProperties, $ref, $defs', () => {
      const schema = {
        type: 'object',
        properties: {
          headers: {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: { type: 'string' },
          },
          url: { type: 'string', format: 'uri' },
        },
      }
      const result = sanitizeJsonSchema(schema, 'google')
      expect(result.properties!.headers).not.toHaveProperty('propertyNames')
      // additionalProperties is NOT an object in the moderate list, so it stays as-is
      expect(result.properties!.headers).toHaveProperty('additionalProperties')
      // format is NOT in the moderate list
      expect(result.properties!.url).toHaveProperty('format')
    })

    it('handles deeply nested schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: { type: 'string' },
              },
            },
          },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect((result.properties!.outer as any).properties!.inner).not.toHaveProperty('propertyNames')
      expect((result.properties!.outer as any).properties!.inner.additionalProperties).toBe(false)
    })

    it('handles array items schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', pattern: '^[a-z]+$' },
              },
            },
          },
        },
      }
      const result = sanitizeJsonSchema(schema, 'nvidia')
      expect(result.properties!.items.items.properties!.name).not.toHaveProperty('pattern')
    })
  })

  describe('createSanitizedInputSchema', () => {
    it('creates a hybrid schema with $schema header and ~standard', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })

      const result = createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, 'nvidia')
      expect(result).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#')
      expect(result).toHaveProperty('~standard')
      expect(result).toHaveProperty('type', 'object')
      expect(result).toHaveProperty('properties')
    })

    it('strips propertyNames from z.record fields for nvidia', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({
          headers: z.record(z.string(), z.string()).optional(),
        }),
        execute: async () => 'ok',
      })

      const result = createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, 'nvidia')
      const headers = (result.properties as any).headers
      expect(headers).not.toHaveProperty('propertyNames')
      expect(headers.additionalProperties).toBe(false)
    })

    it('preserves description fields for nvidia', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({
          url: z.string().url().describe('Target URL'),
          method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
        }),
        execute: async () => 'ok',
      })

      const result = createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, 'nvidia')
      expect((result.properties as any).url.description).toBe('Target URL')
      expect((result.properties as any).method.description).toBe('HTTP method')
      expect((result.properties as any).method.enum).toEqual(['GET', 'POST'])
      expect((result.properties as any).method.default).toBe('GET')
    })

    it('adds $schema header even for non-restricted providers', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })

      const result = createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, 'openai')
      expect(result).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#')
      expect(result).toHaveProperty('~standard')
      // openai is 'none' — no keyword stripping, but $schema header is added
      expect(result).toHaveProperty('type', 'object')
    })

    it('preserves required array', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({
          url: z.string().url(),
          body: z.string().optional(),
        }),
        execute: async () => 'ok',
      })

      const result = createSanitizedInputSchema(tool.inputSchema as StandardSchemaV1, 'nvidia')
      expect(result.required).toEqual(['url'])
    })
  })

  describe('applySchemaCompat', () => {
    it('returns tools unchanged for non-restricted providers', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })

      const result = applySchemaCompat({ test: tool } as any, 'openai')
      expect(result.test.inputSchema).toBe(tool.inputSchema)
    })

    it('returns tools unchanged when no provider', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })

      const result = applySchemaCompat({ test: tool } as any)
      expect(result.test.inputSchema).toBe(tool.inputSchema)
    })

    it('sanitizes tools for nvidia provider', () => {
      const tool = createTool({
        id: 'test',
        description: 'test',
        inputSchema: z.object({
          headers: z.record(z.string(), z.string()).optional(),
          url: z.string().url(),
        }),
        execute: async () => 'ok',
      })

      const result = applySchemaCompat({ test: tool } as any, 'nvidia')
      expect(result.test.inputSchema).not.toBe(tool.inputSchema)
      expect(result.test.inputSchema).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#')
      const headers = (result.test.inputSchema as any).properties.headers
      expect(headers).not.toHaveProperty('propertyNames')
    })

    it('sanitizes multiple tools', () => {
      const tool1 = createTool({
        id: 'test1',
        description: 'test1',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })
      const tool2 = createTool({
        id: 'test2',
        description: 'test2',
        inputSchema: z.object({ headers: z.record(z.string(), z.string()) }),
        execute: async () => 'ok',
      })

      const result = applySchemaCompat({ test1: tool1, test2: tool2 } as any, 'nvidia')
      expect(result.test1.inputSchema).toHaveProperty('$schema')
      expect(result.test2.inputSchema).toHaveProperty('$schema')
    })

    it('preserves tool metadata (id, description, execute)', () => {
      const tool = createTool({
        id: 'test',
        description: 'test tool',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async () => 'ok',
      })

      const result = applySchemaCompat({ test: tool } as any, 'nvidia')
      expect(result.test.id).toBe('test')
      expect(result.test.description).toBe('test tool')
      expect(typeof result.test.execute).toBe('function')
    })
  })

  describe('getSanitizeKeywords', () => {
    it('returns strict keywords for nvidia', () => {
      const k = getSanitizeKeywords('nvidia')
      expect(k).toContain('propertyNames')
      expect(k).toContain('format')
      expect(k).toContain('pattern')
    })

    it('returns moderate keywords for google', () => {
      const k = getSanitizeKeywords('google')
      expect(k).toContain('propertyNames')
      expect(k).not.toContain('format')
    })

    it('returns null for openai', () => {
      expect(getSanitizeKeywords('openai')).toBeNull()
    })
  })

  describe('sanitizeRequestBody', () => {
    it('strips propertyNames from tool function parameters', () => {
      const body = {
        model: 'nvidia/nemotron-3-super-120b-a12b',
        tools: [
          {
            type: 'function',
            function: {
              name: 'httpRequest',
              description: 'Send HTTP request',
              parameters: {
                type: 'object',
                properties: {
                  headers: {
                    type: 'object',
                    propertyNames: { type: 'string' },
                    additionalProperties: { type: 'string' },
                  },
                  url: { type: 'string', format: 'uri' },
                },
                required: ['url'],
              },
            },
          },
        ],
      }

      const keywords = getSanitizeKeywords('nvidia')!
      const result = sanitizeRequestBody(body, keywords)

      const fn = (result.tools as any[])[0].function
      expect(fn.parameters.properties.headers).not.toHaveProperty('propertyNames')
      expect(fn.parameters.properties.headers.additionalProperties).toBe(false)
      expect(fn.parameters.properties.url).not.toHaveProperty('format')
      expect(fn.parameters.properties.url.type).toBe('string')
    })

    it('strips propertyNames from response_format schema', () => {
      const body = {
        model: 'test',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'output',
            schema: {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  propertyNames: { type: 'string' },
                },
              },
            },
          },
        },
      }

      const keywords = getSanitizeKeywords('nvidia')!
      const result = sanitizeRequestBody(body, keywords)

      const schema = (result.response_format as any).json_schema.schema
      expect(schema.properties.data).not.toHaveProperty('propertyNames')
    })

    it('strips deeply nested propertyNames', () => {
      const body = {
        tools: [
          {
            type: 'function',
            function: {
              name: 'test',
              parameters: {
                type: 'object',
                properties: {
                  outer: {
                    type: 'object',
                    properties: {
                      inner: {
                        type: 'object',
                        propertyNames: { type: 'string' },
                        additionalProperties: { type: 'number' },
                        pattern: '^[a-z]+$',
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      }

      const keywords = getSanitizeKeywords('nvidia')!
      const result = sanitizeRequestBody(body, keywords)

      const inner = ((result.tools as any[])[0].function.parameters as any).properties.outer.properties.inner
      expect(inner).not.toHaveProperty('propertyNames')
      expect(inner).not.toHaveProperty('pattern')
      expect(inner.additionalProperties).toBe(false)
    })

    it('preserves model and other non-schema fields', () => {
      const body = {
        model: 'nvidia/nemotron-3-super-120b-a12b',
        temperature: 0.7,
        max_tokens: 1024,
      }

      const keywords = getSanitizeKeywords('nvidia')!
      const result = sanitizeRequestBody(body, keywords)

      expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b')
      expect(result.temperature).toBe(0.7)
      expect(result.max_tokens).toBe(1024)
    })
  })
})
