/**
 * Summarizer tool — generates a high-level summary of the first 10 chunks.
 * Registered as 'summarize_document' in the ToolRegistry.
 */

/**
 * @param {import('../tools/registry.js').ToolRegistry} registry
 * @param {import('../memory/store.js').MemoryStore}     store
 * @param {import('../adapter/base.js').ModelAdapter}    adapter
 */
export function registerSummarizer(registry, store, adapter) {
  registry.register(
    'summarize_document',
    'Generate a high-level summary of the uploaded document using its first 10 chunks.',
    {
      type: 'object',
      properties: {},
      required: []
    },
    async () => {
      // Use first 10 chunks for summary (avoid token overflow)
      const preview = store.query(new Float32Array(384).fill(0), 10)
        .slice(0, 10)
        .map(r => r.text)
        .join('\n\n')

      if (!preview.trim()) return 'No document loaded.'

      const messages = [
        {
          role: 'system',
          content: 'You are a precise summarizer. Summarize the following document excerpt in 3-5 sentences. Focus on the main topics and key facts.'
        },
        { role: 'user', content: preview }
      ]
      return adapter.generate(messages, { max_tokens: 256 })
    }
  )
}
