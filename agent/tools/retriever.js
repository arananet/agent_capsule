/**
 * Retriever tool — queries MemoryStore and returns top-K chunks as text.
 * Registered as 'retrieve_chunks' in the ToolRegistry.
 */

/**
 * @param {import('../tools/registry.js').ToolRegistry} registry
 * @param {import('../memory/store.js').MemoryStore}     store
 * @param {import('../adapter/base.js').ModelAdapter}    adapter
 */
export function registerRetriever(registry, store, adapter) {
  registry.register(
    'retrieve_chunks',
    'Search the ingested document for chunks relevant to the query. Returns the top matching passages.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        top_k: { type: 'integer', description: 'Number of chunks to return (default 5)', default: 5 }
      },
      required: ['query']
    },
    async ({ query, top_k = 5 }) => {
      const queryVector = await adapter.embed(query)
      const results = store.query(queryVector, top_k)
      if (!results.length) return 'No relevant chunks found in the document.'
      return results.map((r, i) =>
        `[Chunk ${r.metadata.chunkIndex}] (score: ${r.score.toFixed(3)})\n${r.text}`
      ).join('\n\n---\n\n')
    }
  )
}
