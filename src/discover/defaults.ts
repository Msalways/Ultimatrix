import type { ParamDiscoverer, DiscoveredParam, DiscoverContext } from './types';

/**
 * url-query: extract params from the URL query string.
 * Free — purely syntactic, no I/O.
 */
export const urlQueryDiscoverer: ParamDiscoverer = {
  id: 'url-query',
  name: 'URL Query String Parser',
  cost: 'free',
  async discover(ctx: DiscoverContext): Promise<DiscoveredParam[]> {
    const params: DiscoveredParam[] = [];
    try {
      const url = new URL(ctx.url, 'http://localhost');
      url.searchParams.forEach((_, key) => {
        params.push({
          name: key,
          type: 'query',
          confidence: 1.0,
          source: 'url-query',
        });
      });
    } catch {
      // URL parse failure — nothing to extract
    }
    return params;
  },
};

/**
 * form-field: extract input names from the DOM snapshot's forms and
 * standalone inputs. These are real HTML form fields the spider found
 * during crawl, not guesses.
 */
export const formFieldDiscoverer: ParamDiscoverer = {
  id: 'form-field',
  name: 'DOM Form Field Extractor',
  cost: 'free',
  async discover(ctx: DiscoverContext): Promise<DiscoveredParam[]> {
    const params: DiscoveredParam[] = [];
    const snap = ctx.domSnapshot;
    if (!snap) return params;

    // Form fields
    for (const form of snap.forms) {
      for (const f of form.fields) {
        if (!f.name) continue;
        params.push({
          name: f.name,
          type: form.method?.toUpperCase() === 'GET' ? 'query' : 'body',
          confidence: 0.9,
          source: 'form-field',
          required: f.required,
        });
      }
    }

    // Standalone inputs
    for (const inp of snap.inputs) {
      const fieldName = inp.resolvedParam || inp.name;
      if (!fieldName) continue;
      params.push({
        name: fieldName,
        type: 'query',
        confidence: 0.7,
        source: 'form-field',
      });
    }

    return params;
  },
};

/**
 * json-body: extract top-level keys from JSON response body.
 * Free — only parses the already-captured response body.
 */
export const jsonBodyDiscoverer: ParamDiscoverer = {
  id: 'json-body',
  name: 'JSON Response Body Key Extractor',
  cost: 'free',
  async discover(ctx: DiscoverContext): Promise<DiscoveredParam[]> {
    const params: DiscoveredParam[] = [];
    if (!ctx.responseBody) return params;

    try {
      const parsed = JSON.parse(ctx.responseBody);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const key of Object.keys(parsed)) {
          params.push({
            name: key,
            type: 'body',
            confidence: 0.8,
            source: 'json-body',
          });
        }
      }
    } catch {
      // Not JSON — skip
    }

    return params;
  },
};

/**
 * trace-body: extract request body fields from trace entries matching
 * this endpoint. Uses the existing parseBodyFields logic to handle
 * JSON, form-urlencoded, XML, GraphQL, etc.
 */
export const traceBodyDiscoverer: ParamDiscoverer = {
  id: 'trace-body',
  name: 'Trace Request Body Field Extractor',
  cost: 'free',
  async discover(ctx: DiscoverContext): Promise<DiscoveredParam[]> {
    const params: DiscoveredParam[] = [];
    if (!ctx.trace || ctx.trace.length === 0) return params;

    const seen = new Set<string>();

    for (const entry of ctx.trace) {
      if (!entry.requestBody) continue;
      const contentType =
        entry.requestHeaders?.['content-type'] ||
        entry.requestHeaders?.['Content-Type'] ||
        ctx.contentType ||
        '';

      // Parse the request body the same way spider-bridge does
      const { fields } = parseBodyFields(entry.requestBody, contentType);
      for (const f of fields) {
        const key = f.name;
        if (seen.has(key)) continue;
        seen.add(key);
        params.push({
          name: f.name,
          type: f.type === 'form-field' ? 'body' : 'body',
          confidence: 0.95,
          source: 'trace-body',
        });
      }
    }

    return params;
  },
};

/** Minimal inline copy of parseBodyFields to avoid circular deps. */
function parseBodyFields(
  body: string,
  contentType: string,
): { format?: string; fields: Array<{ name: string; type: string }> } {
  if (!body) return { fields: [] };
  const ct = contentType || '';

  try {
    if (ct.includes('json')) {
      const parsed = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
        const fields = Object.entries(parsed).map(([k, v]) => ({
          name: k,
          type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v,
        }));
        return { format: 'json', fields };
      }
    }
    if (ct.includes('xml') || ct.includes('soap')) {
      const tags = body.match(/<(\w+)[^>]*>/g) || [];
      const fields = [...new Set(tags.map((t) => t.replace(/[<>/]/g, '').split(/\s/)[0]))]
        .filter((t) => !['xml', 'soap', 'env', 'body'].includes(t.toLowerCase()))
        .map((t) => ({ name: t, type: 'xml-element' }));
      return { format: 'xml', fields };
    }
    if (ct.includes('graphql')) {
      const opMatch = body.match(/(query|mutation)\s+(\w+)/i);
      const field = opMatch ? opMatch[2] : 'query';
      const vars = body.match(/\$(\w+)/g) || [];
      const fields = vars.map((v) => ({ name: v.replace('$', ''), type: 'graphql-variable' }));
      if (!fields.length) fields.push({ name: field, type: 'graphql-operation' });
      return { format: 'graphql', fields };
    }
    if (ct.includes('form-urlencoded') || ct.includes('form-data')) {
      const params = new URLSearchParams(body);
      const fields = [...params.keys()].map((k) => ({ name: k, type: 'form-field' }));
      return { format: 'form', fields };
    }
  } catch {
    /* best-effort parse */
  }

  // Fallback: try JSON regardless of content type
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const fields = Object.entries(parsed).map(([k, v]) => ({
        name: k,
        type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v,
      }));
      return { format: 'json', fields };
    }
  } catch {}

  return { fields: [] };
}

/**
 * form-submit-api: extract request body fields from trace entries
 * that were generated by form submissions (tagged by the spider's
 * exploreFormsOnPage). Captures real API params the browser sent
 * when the user filled and submitted a form.
 */
export const formSubmitApiDiscoverer: ParamDiscoverer = {
  id: 'form-submit-api',
  name: 'Form Submission API Extractor',
  cost: 'free',
  async discover(ctx: DiscoverContext): Promise<DiscoveredParam[]> {
    const params: DiscoveredParam[] = [];
    if (!ctx.trace || ctx.trace.length === 0) return params;

    const seen = new Set<string>();

    for (const entry of ctx.trace) {
      const isFormSubmit = entry.tags?.some((t) => t.startsWith('form-submit:'));
      if (!isFormSubmit) continue;
      if (!entry.requestBody) continue;

      const contentType =
        entry.requestHeaders?.['content-type'] ||
        entry.requestHeaders?.['Content-Type'] ||
        ctx.contentType ||
        '';

      const { fields } = parseBodyFields(entry.requestBody, contentType);
      for (const f of fields) {
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        params.push({
          name: f.name,
          type: 'body',
          confidence: 0.85,
          source: 'form-submit-api',
        });
      }
    }

    return params;
  },
};

/** Default set of discoverers shipped with the framework. */
export const DEFAULT_DISCOVERERS: ParamDiscoverer[] = [
  urlQueryDiscoverer,
  formFieldDiscoverer,
  jsonBodyDiscoverer,
  traceBodyDiscoverer,
  formSubmitApiDiscoverer,
];
