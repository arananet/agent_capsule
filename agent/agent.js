import { ToolRegistry } from './tools/registry.js'
import { registerRetriever } from './tools/retriever.js'
import { registerSummarizer } from './tools/summarizer.js'

const MAX_ITERATIONS = 4

const SYSTEM_PROMPT_TEMPLATE = (chunks) => chunks
  ? `\
You are a precise document assistant. Answer only from the provided context.
If the context does not contain the answer, say so explicitly.

Context:
${chunks}

Rules:
- Cite the chunk index when quoting (e.g. [Chunk 3])
- If uncertain, say uncertain
- Do not hallucinate facts outside the context`
  : `\
You are a private document assistant that runs entirely in the browser.
No document has been uploaded yet. Introduce yourself and explain that the user
can upload a PDF to ask questions about its content.`

/**
 * Core agent — ReAct loop (Reason → Act → Observe → Repeat).
 */
export class Agent {
  /**
   * @param {import('./adapter/base.js').ModelAdapter} adapter
   * @param {import('./memory/store.js').MemoryStore}   store
   */
  constructor(adapter, store) {
    this._adapter = adapter
    this._store   = store
    this._registry = new ToolRegistry()

    registerRetriever(this._registry, store, adapter)
    registerSummarizer(this._registry, store, adapter)
  }

  /**
   * Run the agent loop for a single user query.
   * @param {string}   userQuery
   * @param {Function} [onThought]  optional callback(text) for streaming thought updates
   * @returns {Promise<{answer: string, latencyMs: number}>}
   */
  async run(userQuery, onThought) {
    const t0 = Date.now()

    // Step 1: Retrieve initial context (skip embed when no documents are loaded)
    const topChunks = this._store.size() > 0
      ? await this._adapter.embed(userQuery).then(v => this._store.query(v, 5))
      : []
    const contextText = topChunks.length
      ? topChunks.map(r => `[Chunk ${r.metadata.chunkIndex}]\n${r.text}`).join('\n\n---\n\n')
      : null

    // Build message history for the loop
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_TEMPLATE(contextText) },
      { role: 'user',   content: userQuery }
    ]

    let iterations = 0
    while (iterations < MAX_ITERATIONS) {
      iterations++

      const tools = this._registry.toToolDefinitions()
      const response = await this._adapter.toolCall(messages, tools)

      messages.push({ role: 'assistant', content: response.content })

      if (!response.tool_calls?.length) {
        // Final answer — no more tool calls
        return { answer: response.content, latencyMs: Date.now() - t0 }
      }

      // Execute each tool call and append observations
      for (const call of response.tool_calls) {
        if (onThought) onThought(`Using tool: ${call.name}…`)
        let observation
        try {
          observation = await this._registry.execute(call.name, call.arguments)
        } catch (err) {
          console.error('[agent] tool error:', err)
          observation = `Tool error: ${err.message}`
        }
        messages.push({ role: 'user', content: `Tool result for ${call.name}:\n${observation}` })
      }
    }

    // Graceful fallback after max iterations
    return {
      answer: "I wasn't able to find a definitive answer in the document within the allowed steps. Please try rephrasing your question.",
      latencyMs: Date.now() - t0
    }
  }
}
