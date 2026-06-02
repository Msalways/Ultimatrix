/**
 * src/agents/specialists/xss.ts
 *
 * XSS specialist — focused on cross-site scripting across HTML, attribute,
 * JS string, URL, and DOM contexts. Distinguishes stored vs reflected.
 *
 * Selection heuristic: include when the app has any text-accepting parameter
 * (search, name, comment, message, etc.) or any HTML/JS response context.
 */

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';

const XSS_SYSTEM_PROMPT = `You are a cross-site scripting specialist. Your job is to determine if a web endpoint is vulnerable to XSS by crafting and testing context-appropriate test strings.

## Output
You MUST call conclude() with the result. Schema:
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "context": "<html-body|attribute|js-string|url|dom-css>",
  "stored": boolean,
  "evidence": ["<verbatim quoted text from response>"],
  "payloads": ["<test strings used>"],
  "summary": "<one paragraph>"
}

## Approach
1. Send a baseline request with observe_response to learn the normal output
2. Identify the context: HTML body, attribute, JS string, URL, or DOM via CSS
3. Craft a UNIQUE marker string (e.g. "xssMARK12345") and embed in context-appropriate test strings:
   - HTML body: <script>alert('xssMARK12345')</script> or <img src=x onerror=alert('xssMARK12345')>
   - Attribute: " onmouseover=alert('xssMARK12345') " or ' onfocus=alert('xssMARK12345') '
   - JS string: ';alert('xssMARK12345');// or </script><script>alert('xssMARK12345')</script>
   - URL: javascript:alert('xssMARK12345')
4. Send the test string. observe_response for reflection.
5. If reflected verbatim, escalate: test for stored by re-fetching without payload.
6. Quote the EXACT response fragment containing your marker.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test string", "test input".
- Quote response text verbatim. Never paraphrase.
- If 4+ probes show no reflection, set vulnerable=false. False positives waste triage.`;

export const xssSpecialist: SpecialistFactory = {
  name: 'xss-specialist',
  description: 'XSS in HTML, attribute, JS, URL, and DOM contexts. Stored vs reflected.',
  build: (tools) => ({
    name: 'xss-specialist',
    description: 'XSS in HTML, attribute, JS, URL, and DOM contexts. Stored vs reflected.',
    systemPrompt: XSS_SYSTEM_PROMPT,
    tools: [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
  }),
  shouldInclude: (appModel: AppModel) => {
    const hasTextParam = (appModel.parameterClassifications || []).some((c) =>
      ['search', 'name', 'email'].includes(c.classifiedAs)
    );
    const hasTextEndpoint = (appModel.endpoints || []).some((e) =>
      e.contentType?.includes('html') || e.contentType?.includes('text')
    );
    const hasForm = (appModel.forms || []).length > 0;
    return hasTextParam || hasTextEndpoint || hasForm;
  },
};
