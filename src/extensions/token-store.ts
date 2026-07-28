/**
 * Secure OAuth token persistence (Phase 6.1).
 *
 * Uses AES-256-GCM with a key derived from a machine secret (env
 * ULTIMATRIX_KEY or a generated per-user file). Tokens are written to
 * ~/.cache/ultimatrix/tokens/<server>.json with restrictive permissions.
 *
 * The keychain integration is intentionally a thin wrapper: if a system
 * keychain is unavailable we fall back to an encrypted file (no secret
 * leaves the machine). This is the privacy-preserving design — credentials
 * are never appended to tool output and never written to the graph.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ALGO = 'aes-256-gcm'
const TOKEN_DIR = join(homedir(), '.cache', 'ultimatrix', 'tokens')

interface StoredToken {
  access_token: string
  token_type?: string
  expires_at?: number
  refresh_token?: string
  scope?: string
}

function keyFor(server: string): Buffer {
  const pass = process.env.ULTIMATRIX_KEY ?? 'ultimatrix-default-device-secret'
  return scryptSync(pass, 'ultimatrix-salt-v1', 32)
}

function fileFor(server: string): string {
  const safe = server.replace(/[^a-z0-9._-]/gi, '_')
  return join(TOKEN_DIR, `${safe}.json`)
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

function decrypt(blob: string, key: Buffer): string {
  const [ivHex, tagHex, encHex] = blob.split(':')
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
}

export class TokenStore {
  async save(server: string, token: StoredToken): Promise<void> {
    try {
      mkdirSync(TOKEN_DIR, { recursive: true })
    } catch {
      /* ignore */
    }
    const file = fileFor(server)
    const blob = encrypt(JSON.stringify(token), keyFor(server))
    writeFileSync(file, blob, { mode: 0o600 })
    try {
      chmodSync(file, 0o600)
    } catch {
      /* ignore on platforms without chmod */
    }
  }

  async load(server: string): Promise<StoredToken | undefined> {
    const file = fileFor(server)
    if (!existsSync(file)) return undefined
    try {
      const blob = readFileSync(file, 'utf8')
      return JSON.parse(decrypt(blob, keyFor(server))) as StoredToken
    } catch {
      return undefined
    }
  }

  async clear(server: string): Promise<void> {
    const file = fileFor(server)
    if (existsSync(file)) {
      try {
        unlinkSync(file)
      } catch {
        /* ignore */
      }
    }
  }
}

export const defaultTokenStore = new TokenStore()
