import { ModelAdapter }   from './base.js'
import { MODEL_REGISTRY } from './registry.js'

let pipeline = null

async function getPipeline() {
  if (!pipeline) {
    const mod = await import(`${MODEL_REGISTRY.transformersCdn}/dist/transformers.min.js`)
    mod.env.allowLocalModels = false
    mod.env.useBrowserCache = true
    // Pre-allocate WASM heap (in pages, 1 page = 64 KB) so the ONNX runtime
    // doesn't fail with "offset is out of bounds" when growing during inference.
    // 256 initial pages = 16 MB; 8192 max pages = 512 MB.
    if (mod.env.backends?.onnx?.wasm) {
      mod.env.backends.onnx.wasm.numThreads = 1
    }
    pipeline = mod.pipeline
  }
  return pipeline
}

export class TransformersAdapter extends ModelAdapter {
  constructor(onProgress) {
    super()
    this._onProgress = onProgress || (() => {})
    this._genPipeline = null
    this._embedPipeline = null
    this._ready = false
  }

  async load() {
    const getPipe = await getPipeline()

    this._onProgress({ text: 'Loading generation model…', progress: 10 })
    this._genPipeline = await getPipe('text-generation', MODEL_REGISTRY.genModel, {
      quantized: true,
      progress_callback: (r) => {
        if (r.status === 'progress') {
          this._onProgress({ text: `Generation model: ${r.file}`, progress: 10 + r.progress * 0.85 })
        }
      }
    })

    this._ready = true
    this._onProgress({ text: 'WASM model ready', progress: 100 })
    console.info('[adapter] TransformersAdapter ready — runtime: WASM')
  }

  async _loadEmbedder() {
    if (this._embedPipeline) return
    const getPipe = await getPipeline()
    console.info('[adapter] Lazy-loading embedding model…')
    this._embedPipeline = await getPipe('feature-extraction', MODEL_REGISTRY.embedModel, { quantized: true })
  }

  /** Load only the embedding model — skips the generation model entirely. */
  async loadEmbedOnly() {
    await this._loadEmbedder()
    this._ready = true
    console.info('[adapter] TransformersAdapter ready — embed-only mode')
  }

  async generate(messages, options = {}) {
    if (!this._ready) throw new Error('TransformersAdapter not loaded')
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:'
    const result = await this._genPipeline(prompt, {
      max_new_tokens: options.max_tokens || 256,
      temperature: options.temperature ?? 0.2,
      do_sample: false,   // greedy — avoids large beam-search tensors in WASM
      num_beams: 1,
    })
    return result[0].generated_text.slice(prompt.length).trim()
  }

  async embed(text) {
    await this._loadEmbedder()
    const output = await this._embedPipeline(text, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 })
    return output.data
  }

  async toolCall(messages, tools) {
    const toolDesc = tools.map(t =>
      `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters)}`
    ).join('\n\n')

    const augmented = [
      ...messages,
      {
        role: 'system',
        content: `You have access to these tools. To call a tool respond ONLY with valid JSON:\n{"tool": "<name>", "args": {...}}\n\nIf no tool is needed, respond normally.\n\nTools:\n${toolDesc}`
      }
    ]

    const text = await this.generate(augmented)

    const jsonMatch = text.match(/\{[\s\S]*"tool"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.tool && tools.find(t => t.name === parsed.tool)) {
          return { content: text, tool_calls: [{ name: parsed.tool, arguments: parsed.args || {} }] }
        }
      } catch { /* not a valid tool call — fall through */ }
    }
    return { content: text }
  }

  runtimeName() { return 'WASM' }
  modelName()   { return MODEL_REGISTRY.genModel }
  isReady()     { return this._ready }
}
