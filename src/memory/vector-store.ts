/**
 * VectorStore — cosine similarity search over graph nodes.
 *
 * Uses LibSQL for persistence with local TF-IDF embeddings.
 * When a provider embedder is configured, can upgrade to real ML embeddings.
 *
 * Design: PentAGI pgvector (adapted to LibSQL/SQLite)
 * Purpose: "Find similar findings to this one" across engagements
 */

import { createClient, type Client } from '@libsql/client'
import { resolve, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { log } from '../utils/logger'
import { NodeType, type GraphNodeData } from '../graph/schema'

// ─── Types ──────────────────────────────────────────────────────────

export interface VectorDocument {
  id: string
  nodeType: NodeType
  nodeId: string
  text: string
  embedding: number[]
  createdAt: string
  engagementId?: string
}

export interface SearchResult {
  document: VectorDocument
  score: number
}

export interface VectorStoreConfig {
  dbPath?: string
  dimension?: number
  similarityThreshold?: number
  maxResults?: number
}

// ─── Local Embedding (TF-IDF-like) ─────────────────────────────────

const DIMENSION = 128
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this', 'it',
  'its', 'http', 'https', 'www', 'com', 'org', 'net', 'api',
])

/**
 * Simple hash-based embedding — deterministic, fast, no external model.
 * Maps text to a fixed-dimension vector using weighted character n-grams.
 * Quality is lower than ML embeddings but sufficient for similarity search.
 */
export function hashEmbed(text: string, dimension: number = DIMENSION): number[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const tokens = normalized.split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t))

  const vector = new Array(dimension).fill(0)

  // Character trigram hashing
  for (const token of tokens) {
    for (let i = 0; i <= token.length - 3; i++) {
      const trigram = token.slice(i, i + 3)
      let hash = 0
      for (let j = 0; j < trigram.length; j++) {
        hash = ((hash << 5) - hash + trigram.charCodeAt(j)) | 0
      }
      const idx = Math.abs(hash) % dimension
      vector[idx] += 1
    }

    // Single token hashing (weighted higher)
    let tokenHash = 0
    for (let j = 0; j < token.length; j++) {
      tokenHash = ((tokenHash << 5) - tokenHash + token.charCodeAt(j)) | 0
    }
    const idx = Math.abs(tokenHash) % dimension
    vector[idx] += 2
  }

  // L2 normalize
  let norm = 0
  for (let i = 0; i < dimension; i++) {
    norm += vector[i] * vector[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dimension; i++) {
    vector[i] /= norm
  }

  return vector
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─── Serialize graph nodes to text ───────────────────────────────────

/** Extract searchable text from a graph node for embedding. */
export function serializeNode(node: GraphNodeData): string {
  const props = node.properties as Record<string, unknown>
  const parts: string[] = [node.type]

  // Extract text-relevant properties per node type
  switch (node.type) {
    case NodeType.FINDING:
      parts.push(
        String(props.title ?? ''),
        String(props.severity ?? ''),
        String(props.technique ?? ''),
        String(props.endpoint ?? ''),
      )
      if (Array.isArray(props.evidence)) {
        parts.push(props.evidence.map(String).join(' '))
      }
      break
    case NodeType.ENDPOINT:
      parts.push(
        String(props.url ?? ''),
        String(props.method ?? ''),
        String(props.endpointKey ?? ''),
        ...(Array.isArray(props.params) ? props.params.map(String) : []),
        ...(Array.isArray(props.tags) ? props.tags.map(String) : []),
      )
      break
    case NodeType.ATTACK:
      parts.push(
        String(props.technique ?? ''),
        String(props.payload ?? ''),
        String(props.vulnerable === true ? 'vulnerable' : ''),
        String(props.response ?? ''),
      )
      break
    case NodeType.EXPLOIT_PROOF:
      parts.push(
        String(props.title ?? ''),
        String(props.method ?? ''),
        String(props.url ?? ''),
        String(props.scenario ?? ''),
        String(props.impact ?? ''),
        ...(Array.isArray(props.reproSteps) ? props.reproSteps.map(String) : []),
      )
      break
    case NodeType.AUTH_FLOW:
      parts.push(
        String(props.flowType ?? ''),
        ...(Array.isArray(props.steps) ? props.steps.map(String) : []),
      )
      break
    case NodeType.WORKFLOW:
      parts.push(
        String(props.name ?? ''),
        String(props.entryUrl ?? ''),
        ...(Array.isArray(props.steps) ? props.steps.map(String) : []),
        ...(Array.isArray(props.relatedEndpoints) ? props.relatedEndpoints.map(String) : []),
      )
      break
    case NodeType.HYPOTHESIS:
      parts.push(
        String(props.title ?? ''),
        String(props.kind ?? ''),
        String(props.reason ?? ''),
        String(props.risk ?? ''),
      )
      break
    case NodeType.REFLEXION:
      parts.push(
        String(props.vulnType ?? ''),
        String(props.failureCategory ?? ''),
        ...(Array.isArray(props.hints) ? props.hints.map(String) : []),
        ...(Array.isArray(props.failedPaths) ? props.failedPaths.map(String) : []),
      )
      break
    case NodeType.PAGE:
      parts.push(
        String(props.url ?? ''),
        String(props.title ?? ''),
        ...(Array.isArray(props.tags) ? props.tags.map(String) : []),
      )
      break
    case NodeType.TEST:
      parts.push(
        String(props.testType ?? ''),
        String(props.endpoint ?? ''),
        String(props.technique ?? ''),
        String(props.payload ?? ''),
        String(props.status ?? ''),
      )
      break
    default:
      // Generic: serialize all string/number/boolean property values
      for (const [key, value] of Object.entries(props)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          parts.push(`${key}:${value}`)
        } else if (Array.isArray(value)) {
          parts.push(value.map(String).join(' '))
        }
      }
  }

  return parts.filter(Boolean).join(' ')
}

// ─── VectorStore ────────────────────────────────────────────────────

export class VectorStore {
  private db: Client
  private readonly dimension: number
  private readonly threshold: number
  private readonly maxResults: number

  constructor(config?: VectorStoreConfig) {
    const dbPath = config?.dbPath ?? resolve('output', 'vector.db')
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = createClient({ url: `file:${dbPath}` })
    this.dimension = config?.dimension ?? DIMENSION
    this.threshold = config?.similarityThreshold ?? 0.3
    this.maxResults = config?.maxResults ?? 10

    this.initializeDatabase()
  }

  private async initializeDatabase(): Promise<void> {
    await this.db.execute('PRAGMA journal_mode=WAL')
    await this.db.execute('PRAGMA busy_timeout=5000')

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS vector_documents (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        node_id TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT NOT NULL,
        engagement_id TEXT
      )
    `)

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_vec_node_type ON vector_documents(node_type)
    `)

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_vec_node_id ON vector_documents(node_id)
    `)

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_vec_engagement ON vector_documents(engagement_id)
    `)
  }

  /** Store a vector document for a graph node. */
  async indexNode(
    node: GraphNodeData,
    engagementId?: string,
  ): Promise<void> {
    const text = serializeNode(node)
    if (!text || text.length < 3) return

    const embedding = hashEmbed(text, this.dimension)
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer)

    const docId = `${node.type}:${node.id}`

    await this.db.execute({
      sql: `INSERT OR REPLACE INTO vector_documents (id, node_type, node_id, text, embedding, created_at, engagement_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        docId,
        node.type,
        node.id,
        text,
        embeddingBlob,
        new Date().toISOString(),
        engagementId ?? null,
      ],
    })

    log.dim(`[vector] indexed ${node.type}:${node.id}`)
  }

  /** Search for similar documents using cosine similarity. */
  async search(
    query: string,
    options?: {
      nodeType?: NodeType
      engagementId?: string
      threshold?: number
      maxResults?: number
    },
  ): Promise<SearchResult[]> {
    const queryEmbedding = hashEmbed(query, this.dimension)
    const threshold = options?.threshold ?? this.threshold
    const maxResults = options?.maxResults ?? this.maxResults

    // Build filter SQL
    const conditions: string[] = []
    const args: (string | number | null)[] = []

    if (options?.nodeType) {
      conditions.push('node_type = ?')
      args.push(options.nodeType)
    }
    if (options?.engagementId) {
      conditions.push('engagement_id = ?')
      args.push(options.engagementId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await this.db.execute({
      sql: `SELECT id, node_type, node_id, text, embedding, created_at, engagement_id
            FROM vector_documents ${whereClause}`,
      args,
    })

    // Compute cosine similarity in JS
    const results: SearchResult[] = []

    for (const row of rows.rows) {
      const embeddingBlob = row.embedding as ArrayBuffer
      const storedEmbedding = Array.from(new Float32Array(embeddingBlob))

      if (storedEmbedding.length !== this.dimension) continue

      const score = cosineSimilarity(queryEmbedding, storedEmbedding)

      if (score >= threshold) {
        results.push({
          document: {
            id: String(row.id),
            nodeType: String(row.node_type) as NodeType,
            nodeId: String(row.node_id),
            text: String(row.text),
            embedding: storedEmbedding,
            createdAt: String(row.created_at),
            engagementId: row.engagement_id ? String(row.engagement_id) : undefined,
          },
          score,
        })
      }
    }

    // Sort by score descending, limit
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, maxResults)
  }

  /** Remove a node from the vector index. */
  async removeNode(nodeId: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM vector_documents WHERE node_id = ?',
      args: [nodeId],
    })
  }

  /** Remove all documents for an engagement. */
  async clearEngagement(engagementId: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM vector_documents WHERE engagement_id = ?',
      args: [engagementId],
    })
  }

  /** Get total document count. */
  async count(): Promise<number> {
    const result = await this.db.execute('SELECT COUNT(*) as cnt FROM vector_documents')
    return Number(result.rows[0]?.cnt ?? 0)
  }

  /** Close the database connection. */
  close(): void {
    this.db.close()
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let _instance: VectorStore | null = null

export function getVectorStore(config?: VectorStoreConfig): VectorStore {
  if (!_instance) {
    _instance = new VectorStore(config)
  }
  return _instance
}
