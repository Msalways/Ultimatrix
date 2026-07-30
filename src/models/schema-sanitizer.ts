/**
 * JSON Schema sanitizer — strips unsupported keywords per LLM provider.
 *
 * Some providers (NVIDIA NIM, etc.) reject valid JSON Schema draft-07 keywords
 * like `propertyNames`, `patternProperties`, and object-form `additionalProperties`.
 * This utility recursively walks a JSON Schema object and strips keywords that
 * the target provider doesn't support.
 *
 * What gets stripped (strict mode — NVIDIA):
 *   propertyNames, patternProperties, $ref, $defs,
 *   minItems, maxItems, minLength, maxLength, pattern,
 *   exclusiveMinimum, exclusiveMaximum, if/then/else, const, format
 *   additionalProperties (object form → coerced to boolean false)
 *
 * What gets stripped (moderate mode — Google, Bedrock):
 *   propertyNames, patternProperties, $ref, $defs
 *
 * What is NEVER stripped (LLM comprehension keywords):
 *   type, properties, required, description, enum, default, items, title
 */

import {
  standardSchemaToJSONSchema,
  type StandardSchemaWithJSON,
} from "@mastra/schema-compat/schema";

const KEYWORDS_STRICT = [
  "propertyNames",
  "patternProperties",
  "$ref",
  "$defs",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "if",
  "then",
  "else",
  "const",
  "format",
];

const KEYWORDS_MODERATE = [
  "propertyNames",
  "patternProperties",
  "$ref",
  "$defs",
];

type SanitizeLevel = "strict" | "moderate" | "none";

function getLevelForProvider(provider: string): SanitizeLevel {
  switch (provider) {
    case "nvidia":
      return "strict";
    case "google":
    case "bedrock":
      return "moderate";
    default:
      return "none";
  }
}

export function sanitizeJsonSchema(
  schema: Record<string, unknown>,
  provider?: string,
): Record<string, unknown> {
  const level = provider ? getLevelForProvider(provider) : "strict";
  if (level === "none") return schema;
  const unsupported = level === "strict" ? KEYWORDS_STRICT : KEYWORDS_MODERATE;
  return stripKeywords(schema, unsupported) as Record<string, unknown>;
}

function stripKeywords(obj: unknown, keywords: string[]): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj))
    return obj.map((item) => stripKeywords(item, keywords));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (
      key === "additionalProperties" &&
      typeof value === "object" &&
      value !== null
    ) {
      result[key] = false;
      continue;
    }
    if (keywords.includes(key)) continue;
    result[key] = stripKeywords(value, keywords);
  }
  return result;
}

/**
 * Create a sanitized inputSchema for a Mastra tool.
 *
 * Converts the Zod Standard Schema to JSON Schema, strips provider-incompatible
 * keywords, and returns a hybrid object that:
 *   - Has `$schema` header → Mastra uses it directly as `parameters` (bypasses standardSchemaToJSONSchema)
 *   - Has `~standard` → runtime validation via original Zod schema
 *
 * See: Mastra chunk-TRXIXO5J.js line 176 — checks "$schema" first
 */
export function createSanitizedInputSchema(
  standardSchema: StandardSchemaWithJSON,
  provider?: string,
): Record<string, unknown> {
  const level = provider ? getLevelForProvider(provider) : "none";

  // Convert Zod → JSON Schema (draft-07) using Mastra's compat layer
  const rawJsonSchema = standardSchemaToJSONSchema(standardSchema, {
    io: "input",
    target: "draft-07",
  }) as Record<string, unknown>;

  // If provider doesn't need sanitization, just add $schema header for direct use
  if (level === "none") {
    return {
      ...(rawJsonSchema as Record<string, unknown>),
      $schema: "http://json-schema.org/draft-07/schema#",
      "~standard": (standardSchema as unknown as Record<string, unknown>)["~standard"],
    };
  }

  // Sanitize for strict provider
  const unsupported = level === "strict" ? KEYWORDS_STRICT : KEYWORDS_MODERATE;
  const sanitized = stripKeywords(rawJsonSchema, unsupported) as Record<
    string,
    unknown
  >;

  return {
    ...sanitized,
    $schema: "http://json-schema.org/draft-07/schema#",
    "~standard": (standardSchema as unknown as Record<string, unknown>)["~standard"],
  };
}

/**
 * Apply schema compatibility to a tool registry.
 * For strict/moderate providers, replaces each tool's inputSchema with a
 * pre-sanitized version that bypasses standardSchemaToJSONSchema at runtime.
 */
export function applySchemaCompat<
  T extends { inputSchema?: unknown; id?: string },
>(tools: Record<string, T>, provider?: string): Record<string, T> {
  if (!provider) return tools;
  const level = getLevelForProvider(provider);
  if (level === "none") return tools;

  const result: Record<string, T> = {};
  for (const [key, tool] of Object.entries(tools)) {
    if (
      tool.inputSchema &&
      typeof tool.inputSchema === "object" &&
      "~standard" in (tool.inputSchema as object)
    ) {
      const sanitized = createSanitizedInputSchema(
        tool.inputSchema as StandardSchemaWithJSON,
        provider,
      );
      result[key] = { ...tool, inputSchema: sanitized } as T;
    } else {
      result[key] = tool;
    }
  }
  return result;
}

function _sanitizeToolParamsInArray(
  tools: unknown[],
  keywords: string[],
): unknown[] {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (tool && typeof tool === "object") {
      const t = tool as Record<string, unknown>;
      // OpenAI format: { type: 'function', function: { name, parameters } }
      if (t.function && typeof t.function === "object") {
        const fn = t.function as Record<string, unknown>;
        if (fn.parameters && typeof fn.parameters === "object") {
          return {
            ...t,
            function: {
              ...fn,
              parameters: stripKeywords(fn.parameters, keywords),
            },
          };
        }
      }
      // Direct format: { type: 'function', name, parameters }
      if (t.parameters && typeof t.parameters === "object") {
        return { ...t, parameters: stripKeywords(t.parameters, keywords) };
      }
    }
    return tool;
  });
}

export function getSanitizeKeywords(provider: string): string[] | null {
  const level = getLevelForProvider(provider);
  if (level === "none") return null;
  return level === "strict" ? KEYWORDS_STRICT : KEYWORDS_MODERATE;
}

/**
 * Recursively walk a request body object and sanitize all JSON Schema
 * sub-objects (tools[].function.parameters, response_format.json_schema.schema, etc.).
 * Used as transformRequestBody — the absolute last stop before the HTTP wire.
 */
export function sanitizeRequestBody(
  body: Record<string, unknown>,
  keywords: string[],
): Record<string, unknown> {
  const audit: string[] = [];
  auditKeywords(body, keywords, "", audit);
  const result = stripKeywords(body, keywords) as Record<string, unknown>;
  // if (audit.length > 0) {
  //   console.error(`[schema-sanitizer] Stripped ${audit.length} unsupported keyword(s):`)
  //   for (const entry of audit.slice(0, 20)) {
  //     console.error(`  ${entry}`)
  //   }
  //   if (audit.length > 20) {
  //     console.error(`  ... and ${audit.length - 20} more`)
  //   }
  // }
  return result;
}

function auditKeywords(
  obj: unknown,
  keywords: string[],
  path: string,
  audit: string[],
): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      auditKeywords(item, keywords, `${path}[${i}]`, audit),
    );
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const curPath = path ? `${path}.${key}` : key;
    if (
      key === "additionalProperties" &&
      typeof value === "object" &&
      value !== null
    ) {
      audit.push(`${curPath} (object → coerced to false)`);
      continue;
    }
    if (keywords.includes(key)) {
      const preview =
        typeof value === "string"
          ? ` = "${value.slice(0, 50)}"`
          : typeof value === "object"
            ? ` (${Array.isArray(value) ? "array" : "object"})`
            : ` = ${value}`;
      audit.push(`${curPath}${preview}`);
      continue;
    }
    auditKeywords(value, keywords, curPath, audit);
  }
}
