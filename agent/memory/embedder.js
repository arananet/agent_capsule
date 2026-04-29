/**
 * Embeds document chunks using the active ModelAdapter.
 * Metadata is persisted in localStorage keyed by file hash to skip
 * re-embedding the same file on subsequent uploads.
 */
export class Embedder {
  /** @param {import('../adapter/base.js').ModelAdapter} adapter */
  constructor(adapter) {
    this._adapter = adapter
  }

  /**
   * Embed all chunks and return enriched objects ready for MemoryStore.
   * @param {string[]} chunks   Raw text chunks
   * @param {object}   meta     {source: string, hash: string}
   * @returns {Promise<Array<{id: string, text: string, vector: Float32Array, metadata: object}>>}
   */
  async embedChunks(chunks, meta) {
    const results = []
    for (let i = 0; i < chunks.length; i++) {
      const vector = await this._adapter.embed(chunks[i])
      results.push({
        id: `${meta.hash}-${i}`,
        text: chunks[i],
        vector,
        metadata: { source: meta.source, chunkIndex: i, total: chunks.length }
      })
    }
    return results
  }
}
