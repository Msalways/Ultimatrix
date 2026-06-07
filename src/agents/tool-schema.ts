// src/agents/tool-schema.ts
//
// JSON schemas for the 21 primitives + 2 orchestration tools. These are the
// "floor" — the only hardcoded thing in the agent architecture. Everything
// above (finding types, sub-agent tasks, strategies, payload crafting) is the
// LLM's call. The schemas just tell the LLM what arguments each tool accepts.
//
// The LLM responds with one tool call per turn:
//   { "thought": "...", "tool": "httpRequest", "args": { ... } }
//
// The system parses this, executes the tool, returns the result, and the LLM
// continues. The LLM is free to name findings however it wants — the schema
// for writeFinding.type is just "string", not a literal union.

import type { PrimitiveName } from '../primitives/types';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, SchemaNode>;
    required?: string[];
  };
}

export type SchemaNode =
  | { type: 'string'; description?: string }
  | { type: 'number'; description?: string }
  | { type: 'integer'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'object'; properties?: Record<string, SchemaNode>; required?: string[]; description?: string; additionalProperties?: boolean }
  | { type: 'array'; items: SchemaNode; description?: string };

// ---------------------------------------------------------------------------
// Reusable structural schemas
// ---------------------------------------------------------------------------

const PRIMITIVE_REQUEST_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'An HTTP request template',
  properties: {
    method: { type: 'string', description: 'GET, POST, PUT, DELETE, etc.' },
    url: { type: 'string', description: 'Absolute or relative URL' },
    headers: { type: 'object', description: 'Map of header name to value' },
    body: { type: 'string', description: 'Request body (string)' },
    cookies: { type: 'object', description: 'Map of cookie name to value' },
    timeoutMs: { type: 'number', description: 'Per-request timeout in ms' },
  },
  required: ['method', 'url'],
};

const PRIMITIVE_RESPONSE_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'An HTTP response with status, headers, body, timing',
  properties: {
    status: { type: 'number', description: 'HTTP status code' },
    url: { type: 'string' },
    finalUrl: { type: 'string' },
    headers: { type: 'object' },
    body: { type: 'string', description: 'Response body as text' },
    durationMs: { type: 'number' },
    redirects: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------------
// 21 primitive schemas (the floor)
// ---------------------------------------------------------------------------

export const PRIMITIVE_SCHEMAS: Record<PrimitiveName, ToolSchema> = {
  httpRequest: {
    name: 'httpRequest',
    description:
      'Execute a single HTTP request with the given method/headers/body/cookies. Does NOT follow redirects — use followRedirects for that. Returns the response.',
    parameters: {
      type: 'object',
      properties: { request: PRIMITIVE_REQUEST_SCHEMA },
      required: ['request'],
    },
  },

  multipartUpload: {
    name: 'multipartUpload',
    description:
      'Upload a file via multipart/form-data. Used for file-upload attack testing (path traversal in filename, SVG XSS, etc.).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        filename: { type: 'string', description: 'The filename to send (can be malicious)' },
        contentType: { type: 'string' },
        content: { type: 'string', description: 'File contents (string or base64)' },
        headers: { type: 'object' },
      },
      required: ['url', 'filename', 'contentType', 'content'],
    },
  },

  followRedirects: {
    name: 'followRedirects',
    description: 'Follow 3xx redirects from an initial response. Returns the final response and the redirect chain.',
    parameters: {
      type: 'object',
      properties: {
        initial: PRIMITIVE_RESPONSE_SCHEMA,
        maxHops: { type: 'number', description: 'Max redirects to follow (default 5)' },
      },
      required: ['initial'],
    },
  },

  craftPayload: {
    name: 'craftPayload',
    description:
      'Generate attack payloads for a given type and injection context. HELPER PRIMITIVE — you can also craft payloads inline in injectInContext.args.payload. The LLM is free to use this or skip it.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Free-form. E.g. "xss", "sqli", "weird-thing". The primitive does its best.' },
        context: { type: 'string', description: 'Where the payload lands. E.g. "html", "attr", "js", "url".' },
        engine: { type: 'string', description: 'Optional. E.g. "angular", "react", "mustache".' },
        count: { type: 'number', description: 'How many variations to return.' },
      },
      required: ['type'],
    },
  },

  craftBypass: {
    name: 'craftBypass',
    description:
      'Generate WAF-bypass variants of a payload using common mutation techniques (URL encoding, double encoding, unicode escape, comment split, case mixing, null byte, MySQL comment, parameter pollution).',
    parameters: {
      type: 'object',
      properties: {
        payload: { type: 'string', description: 'The base payload to mutate' },
        wafType: { type: 'string', description: 'The WAF type to bypass (free-form, e.g. "cloudflare", "modsecurity", "generic")' },
      },
      required: ['payload'],
    },
  },

  craftXmlEntity: {
    name: 'craftXmlEntity',
    description: 'Craft an XML external entity payload for XXE attacks. Returns the full XML string ready to POST.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Free-form. E.g. "file", "ssrf", "rce"' },
        path: { type: 'string', description: 'For file target: the path to read' },
        host: { type: 'string', description: 'For ssrf target: the URL to fetch' },
      },
      required: ['target'],
    },
  },

  craftMultipart: {
    name: 'craftMultipart',
    description: 'Build a multipart/form-data body with a crafted filename. For file-upload path-traversal and SVG-XSS.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The crafted filename (can be malicious)' },
        content: { type: 'string', description: 'File contents' },
        contentType: { type: 'string' },
        fieldName: { type: 'string' },
      },
      required: ['filename', 'content'],
    },
  },

  injectInContext: {
    name: 'injectInContext',
    description:
      'Take a base request and inject a payload at a specified location (query, body, header, cookie, path, filename, xml-entity). Returns a new request the agent can pass to httpRequest.',
    parameters: {
      type: 'object',
      properties: {
        payload: { type: 'string', description: 'The payload string to inject' },
        location: {
          type: 'string',
          description: 'Free-form. E.g. "query", "body", "header", "cookie", "path", "filename", "xml-entity"',
        },
        base: PRIMITIVE_REQUEST_SCHEMA,
        paramName: { type: 'string', description: 'For path/filename, the param name to substitute' },
      },
      required: ['payload', 'location', 'base'],
    },
  },

  omitHeader: {
    name: 'omitHeader',
    description: 'Remove a header from a request. Used for CSRF testing (omit Cookie/Authorization to confirm the request still succeeds).',
    parameters: {
      type: 'object',
      properties: {
        headers: { type: 'object', description: 'The headers map' },
        name: { type: 'string', description: 'The header name to remove' },
      },
      required: ['headers', 'name'],
    },
  },

  parseResponse: {
    name: 'parseResponse',
    description:
      'Normalize a PrimitiveResponse: extract JSON, collect text snippets for later matching, capture DOM as string. Returns status, body, headers, json, dom, textSnippets.',
    parameters: {
      type: 'object',
      properties: { response: PRIMITIVE_RESPONSE_SCHEMA },
      required: ['response'],
    },
  },

  evaluateRendered: {
    name: 'evaluateRendered',
    description:
      'Open a URL in a Playwright browser, inject the payload into the query, and check if it appears in the rendered DOM. The "real" XSS check — not the response body.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        payload: { type: 'string' },
        matchMode: { type: 'string', description: 'Free-form. E.g. "exact", "unescaped", "event-fires"' },
      },
      required: ['url', 'payload'],
    },
  },

  measureTiming: {
    name: 'measureTiming',
    description:
      'Time-based blind detection. Run baseline (no payload) N times, then payload N times, and report the median delta. >3s delta on time-based payloads = vulnerable.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        baseline: { type: 'number', description: 'Expected baseline response time in ms' },
        payload: { type: 'string' },
        iterations: { type: 'number' },
        paramName: { type: 'string' },
        method: { type: 'string' },
      },
      required: ['url', 'baseline', 'payload'],
    },
  },

  compareResponses: {
    name: 'compareResponses',
    description:
      'Compare two responses: status, body size, and (if both JSON) normalized structural divergence. 0 = identical, 1 = fully different. Reports divergence and whether the target response is "vulnerable" (divergence > 0.2).',
    parameters: {
      type: 'object',
      properties: {
        baseline: PRIMITIVE_RESPONSE_SCHEMA,
        target: PRIMITIVE_RESPONSE_SCHEMA,
        ignoreKeys: { type: 'array', items: { type: 'string' } },
      },
      required: ['baseline', 'target'],
    },
  },

  checkWaf: {
    name: 'checkWaf',
    description: 'Inspect response headers + status for WAF fingerprints. Returns the detected vendor and a 0-1 confidence score.',
    parameters: {
      type: 'object',
      properties: { response: PRIMITIVE_RESPONSE_SCHEMA },
      required: ['response'],
    },
  },

  findEndpointsInResponse: {
    name: 'findEndpointsInResponse',
    description: 'Extract URLs, href targets, and form actions from an HTML response.',
    parameters: {
      type: 'object',
      properties: {
        html: { type: 'string' },
        baseUrl: { type: 'string' },
      },
      required: ['html', 'baseUrl'],
    },
  },

  extractSessionCookie: {
    name: 'extractSessionCookie',
    description: 'Parse Set-Cookie headers and return a {name: value} map.',
    parameters: {
      type: 'object',
      properties: { response: PRIMITIVE_RESPONSE_SCHEMA },
      required: ['response'],
    },
  },

  extractCsrfToken: {
    name: 'extractCsrfToken',
    description: 'Scan HTML for CSRF token inputs in forms. Returns the most likely token + a list of all candidates.',
    parameters: {
      type: 'object',
      properties: { html: { type: 'string' } },
      required: ['html'],
    },
  },

  useSession: {
    name: 'useSession',
    description: 'Switch the active session to the given role. The new cookies/token replace ctx.cookies used by all subsequent primitives.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Free-form. E.g. "guest", "user", "admin", or any role the app has' },
        cookies: { type: 'object' },
        bearerToken: { type: 'string' },
      },
      required: ['role'],
    },
  },

  spawnSubtask: {
    name: 'spawnSubtask',
    description: 'Spawn a specialist sub-composer. The specialist runs in its own LLM context, has access to a restricted primitive subset, and can recursively spawn further sub-composers (depth-capped).',
    parameters: {
      type: 'object',
      properties: {
        specialist: { type: 'string', description: 'Free-form specialist name. The LLM picks.' },
        reason: { type: 'string' },
        payload: { type: 'object', description: 'Optional payload for the specialist' },
      },
      required: ['specialist', 'reason'],
    },
  },

  recordEvidence: {
    name: 'recordEvidence',
    description: 'Append an evidence item to the composer context. Evidence is later copied into the AppModelFinding when writeFinding is called.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Free-form. E.g. "text", "screenshot", "har_entry", "raw_request", "raw_response"' },
        data: { type: 'string' },
        label: { type: 'string' },
        timestamp: { type: 'number' },
        session: { type: 'string' },
      },
      required: ['type', 'data', 'label'],
    },
  },

  writeFinding: {
    name: 'writeFinding',
    description:
      'Emit a finalized finding. type, severity, and param are FREE-FORM STRINGS — the LLM names the finding however it wants. Will be triaged for confirmation; only call when you have concrete evidence.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Free-form. E.g. "xss", "sqli", "weird-csp-bypass", "i-dont-know-but-heres-evidence"' },
        endpoint: { type: 'string' },
        param: { type: 'string', description: 'Free-form. The affected param name, or empty string' },
        method: { type: 'string' },
        payload: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', description: 'Free-form. E.g. "critical", "high", "medium", "low", "info", or "this-is-bad"' },
        confidence: { type: 'number', description: '0-1' },
      },
      required: ['type', 'endpoint', 'param', 'severity', 'confidence'],
    },
  },

  recordTestStep: {
    name: 'recordTestStep',
    description:
      'Append a step to the live Playwright spec on disk. Use this whenever you complete an action you want to be re-runnable as a regression test — a request, a fill, a navigation, an XSS check, etc. The spec stays always-valid Playwright code. No effect (returns ok: false) if no live spec is attached to this context.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What this step verifies. Goes into a // comment. Free-form.' },
        action: { type: 'string', description: 'Single-line Playwright code. E.g. "await page.goto(\'https://target/\')".' },
        assertion: { type: 'string', description: 'Optional single-line assertion. E.g. "await expect(page.locator(\'#x\')).toBeVisible()".' },
      },
      required: ['description', 'action'],
    },
  },

  spiderCrawl: {
    name: 'spiderCrawl',
    description:
      'Run the Playwright-driven spider starting from a URL. Returns a compact list of discovered routes (path, title, depth, form count, link count), the detected tech stack, the first 30 visited URLs, and any crawl errors. Use this when you don\'t know what URLs exist on the target — the result is condensed to fit in one LLM turn. Heavier than httpRequest (opens a headless browser and crawls up to N levels); call sparingly.',
    parameters: {
      type: 'object',
      properties: {
        targetUrl: { type: 'string', description: 'Starting URL. Defaults to the context base URL.' },
        maxDepth: { type: 'number', description: 'How many link levels to follow. 1 = start page only, 2 = links from start (default 2), max 5.' },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 2 orchestration tool schemas (free-form args)
// ---------------------------------------------------------------------------

export const ORCHESTRATION_SCHEMAS: Record<string, ToolSchema> = {
  spawnAgent: {
    name: 'spawnAgent',
    description:
      'Create a sub-agent with a chosen tool subset and a free-form task. The sub-agent runs its own ReAct loop with the tools YOU give it. Returns the sub-agent\'s findings + observations when complete.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Free-form. Describe what the sub-agent should look for.' },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of primitive names from the 21 available. E.g. ["craftPayload", "httpRequest", "evaluateRendered"]. 3-7 tools is good.',
        },
        maxAttempts: { type: 'number', description: 'Max turns the sub-agent gets (default 5).' },
        strategy: { type: 'string', description: 'Free-form strategy guidance. E.g. "be exhaustive", "try bypasses only", "one quick probe".' },
      },
      required: ['task', 'tools'],
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function allToolSchemas(): ToolSchema[] {
  return [
    ...Object.values(PRIMITIVE_SCHEMAS),
    ...Object.values(ORCHESTRATION_SCHEMAS),
  ];
}

export function schemasForToolNames(names: string[]): ToolSchema[] {
  const out: ToolSchema[] = [];
  for (const n of names) {
    const s = PRIMITIVE_SCHEMAS[n as PrimitiveName] ?? ORCHESTRATION_SCHEMAS[n];
    if (s) out.push(s);
  }
  return out;
}

/**
 * Format tool schemas as a JSON string the LLM can read. Used to inject
 * the tool catalog into the system prompt.
 */
export function formatToolSchemasForPrompt(schemas: ToolSchema[]): string {
  return JSON.stringify(
    schemas.map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    })),
    null,
    2,
  );
}
