/**
 * MemoryStore — in-memory vector store with localStorage metadata cache.
 * Vectors are NOT persisted (too large); only text + metadata survive reload.
 */
export class MemoryStore {
  constructor() {
    /** @type {Array<{id: string, text: string, vector: Float32Array, metadata: object}>} */
    this._chunks = []
  }

  /**
   * Store pre-embedded chunks.
   * @param {Array<{id: string, text: string, vector: Float32Array, metadata: object}>} embedded
   * @param {string} fileHash   SHA-256 hex of the file (used as localStorage key)
   */
  ingest(embedded, fileHash) {
    this._chunks = embedded
    if (fileHash) {
      try {
        const meta = embedded.map(({ id, text, metadata }) => ({ id, text, metadata }))
        localStorage.setItem(`bap_meta_${fileHash}`, JSON.stringify(meta))
      } catch { /* storage quota exceeded — silently skip */ }
    }
  }

  /**
   * Return top-K chunks by cosine similarity to the query vector.
   * @param {Float32Array} queryVector
   * @param {number}       topK
   * @returns {Array<{id: string, text: string, score: number, metadata: object}>}
   */
  query(queryVector, topK = 5) {
    if (!this._chunks.length) return []
    return this._chunks
      .map(chunk => ({
        id: chunk.id,
        text: chunk.text,
        metadata: chunk.metadata,
        score: cosineSimilarity(queryVector, chunk.vector)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  /** Reset in-memory store (does not clear localStorage). */
  clear() {
    this._chunks = []
  }

  /** @returns {number} Number of chunks currently held in memory */
  size() {
    return this._chunks.length
  }
}

/**
 * Cosine similarity between two equal-length float vectors.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}  Value in [-1, 1]; higher = more similar
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
