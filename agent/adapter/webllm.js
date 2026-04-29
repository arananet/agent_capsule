import { ModelAdapter }   from './base.js'
import { MODEL_REGISTRY } from './registry.js'

export class WebLLMAdapter extends ModelAdapter {
  constructor(onProgress) {
    super()
    this._onProgress = onProgress || (() => {})
    this._engine = null
    this._embedAdapter = null
    this._ready = false
  }

  async load() {
    const { CreateMLCEngine } = await import(MODEL_REGISTRY.webllmCdn)

    this._engine = await CreateMLCEngine(MODEL_REGISTRY.webllmModel, {
      initProgressCallback: (report) => {
        console.info('[adapter] loading:', report.text)
        this._onProgress({
          text: report.text,
          progress: Math.round(report.progress * 100)
        })
      }
    })

    // Embedding delegated to Transformers.js — loaded on first embed() call only
    const { TransformersAdapter } = await import('./transformers.js')
    this._embedAdapter = new TransformersAdapter(null)

    this._ready = true
    this._onProgress({ text: 'WebGPU model ready', progress: 100 })
    console.info('[adapter] WebLLMAdapter ready — runtime: WebGPU, model:', MODEL_REGISTRY.webllmModel)
  }

  async generate(messages, options = {}) {
    if (!this._ready) throw new Error('WebLLMAdapter not loaded')
    const reply = await this._engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens || 512,
    })
    return reply.choices[0].message.content
  }

  async embed(text) {
    if (!this._embedAdapter) throw new Error('WebLLMAdapter not loaded')
    if (!this._embedAdapter._ready) await this._embedAdapter.loadEmbedOnly()
    return this._embedAdapter.embed(text)
  }

  async toolCall(messages, tools) {
    if (!this._ready) throw new Error('WebLLMAdapter not loaded')
    try {
      const reply = await this._engine.chat.completions.create({
        messages,
        tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 512,
      })
      const msg = reply.choices[0].message
      if (msg.tool_calls?.length) {
        return {
          content: msg.content || '',
          tool_calls: msg.tool_calls.map(tc => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
          }))
        }
      }
      return { content: msg.content || '' }
    } catch {
      // Model doesn't support native tool calling — fall back to prompt engineering
      console.info('[adapter] WebLLM native tool call failed, falling back to prompt engineering')
      return this._promptToolCall(messages, tools)
    }
  }

  async _promptToolCall(messages, tools) {
    const toolDesc = tools.map(t =>
      `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters)}`
    ).join('\n\n')

    const toolInstruction = `You have access to these tools. To call a tool respond ONLY with valid JSON:\n{"tool": "<name>", "args": {...}}\n\nIf no tool is needed, respond normally.\n\nTools:\n${toolDesc}`

    // System message must be first — merge into existing system msg or prepend one
    let augmented
    if (messages.length > 0 && messages[0].role === 'system') {
      augmented = [
        { role: 'system', content: messages[0].content + '\n\n' + toolInstruction },
        ...messages.slice(1)
      ]
    } else {
      augmented = [
        { role: 'system', content: toolInstruction },
        ...messages
      ]
    }

    const text = await this.generate(augmented)

    const jsonMatch = text.match(/\{[\s\S]*"tool"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.tool && tools.find(t => t.name === parsed.tool)) {
          return { content: text, tool_calls: [{ name: parsed.tool, arguments: parsed.args || {} }] }
        }
      } catch { /* not valid JSON — return as plain text */ }
    }
    return { content: text }
  }

  runtimeName() { return 'WebGPU' }
  modelName()   { return MODEL_REGISTRY.webllmModel }
  isReady()     { return this._ready }
}
