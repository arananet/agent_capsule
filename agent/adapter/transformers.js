import { ModelAdapter } from './base.js'

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
const GEN_MODEL = 'Xenova/Phi-3-mini-4k-instruct'
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'

let pipeline = null

async function getPipeline() {
  if (!pipeline) {
    const mod = await import(`${TRANSFORMERS_CDN}/dist/transformers.min.js`)
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

    this._onProgress({ text: 'Loading embedding model…', progress: 10 })
    this._embedPipeline = await getPipe('feature-extraction', EMBED_MODEL, {
      progress_callback: (r) => {
        if (r.status === 'progress') {
          this._onProgress({ text: `Embedding model: ${r.file}`, progress: 10 + r.progress * 0.3 })
        }
      }
    })

    this._onProgress({ text: 'Loading generation model…', progress: 40 })
    this._genPipeline = await getPipe('text-generation', GEN_MODEL, {
      progress_callback: (r) => {
        if (r.status === 'progress') {
          this._onProgress({ text: `Generation model: ${r.file}`, progress: 40 + r.progress * 0.55 })
        }
      }
    })

    this._ready = true
    this._onProgress({ text: 'WASM model ready', progress: 100 })
    console.info('[adapter] TransformersAdapter ready — runtime: WASM')
  }

  async generate(messages, options = {}) {
    if (!this._ready) throw new Error('TransformersAdapter not loaded')
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:'
    const result = await this._genPipeline(prompt, {
      max_new_tokens: options.max_tokens || 512,
      temperature: options.temperature ?? 0.2,
      do_sample: true,
    })
    return result[0].generated_text.slice(prompt.length).trim()
  }

  async embed(text) {
    if (!this._embedPipeline) throw new Error('TransformersAdapter not loaded')
    const output = await this._embedPipeline(text, { pooling: 'mean', normalize: true })
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
  modelName()   { return GEN_MODEL }
  isReady()     { return this._ready }
}
