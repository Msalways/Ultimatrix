/**
 * ${ENV_VAR} interpolation for config values (env / headers / args).
 *
 * - Substitutes `${VAR}` → `process.env.VAR` (or a provided env map).
 * - Accepts literal values unchanged.
 * - Emits a warning when a literal value looks like a plaintext secret
 *   (never throws — discovery must never block). No substring scanning of
 *   free-form text; only a conservative heuristic over config values.
 */

const SECRET_HINTS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /client[_-]?secret/i,
  /bearer/i,
]

function looksLikeSecret(key: string, value: string): boolean {
  // Structured enum check — not free-form text scanning.
  if (!SECRET_HINTS.some(r => r.test(key))) return false
  // Long high-entropy-ish strings are the risk; short ones are often placeholders.
  return value.length >= 8
}

function interpolate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const v = env[name]
    return v !== undefined ? v : ''
  })
}

function warnOnce(key: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[ultimatrix] config value for "${key}" looks like a plaintext secret — prefer \${ENV_VAR} referencing an environment variable.`)
}

/**
 * Recursively interpolate `${ENV_VAR}` tokens in any string-valued structure.
 * `envMap` overrides process.env for deterministic tests.
 */
export function resolveEnvVars<T>(input: T, envMap?: Record<string, string>): T {
  const env: Record<string, string | undefined> = envMap ?? (process.env as Record<string, string>)
  const seen = new Set<string>()

  function walk(node: unknown, keyPath: string): unknown {
    if (typeof node === 'string') {
      const out = interpolate(node, env)
      if (out !== node && keyPath && SECRET_HINTS.some(r => r.test(keyPath)) && !seen.has(keyPath)) {
        seen.add(keyPath)
        if (looksLikeSecret(keyPath, node)) warnOnce(keyPath)
      }
      return out
    }
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${keyPath}[${i}]`))
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        out[k] = walk(v, keyPath ? `${keyPath}.${k}` : k)
      }
      return out
    }
    return node
  }

  return walk(input, '') as T
}
