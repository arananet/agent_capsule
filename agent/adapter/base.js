/**
 * ModelAdapter — abstract interface for all model runtimes.
 * Agent and tool code must only call these methods; never import WebLLM
 * or Transformers.js directly from outside the adapter/ directory.
 */
export class ModelAdapter {
  /**
   * Generate a text completion.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options]
   * @returns {Promise<string>}
   */
  async generate(messages, options = {}) {
    throw new Error('ModelAdapter.generate() not implemented')
  }

  /**
   * Embed a string into a float vector.
   * @param {string} text
   * @returns {Promise<Float32Array>}
   */
  async embed(text) {
    throw new Error('ModelAdapter.embed() not implemented')
  }

  /**
   * Generate with structured tool-call support.
   * Falls back to prompt-engineered JSON extraction if model lacks native support.
   * @param {Array<{role: string, content: string}>} messages
   * @param {Array<{name: string, description: string, parameters: object}>} tools
   * @returns {Promise<{content: string, tool_calls?: Array<{name: string, arguments: object}>}>}
   */
  async toolCall(messages, tools) {
    throw new Error('ModelAdapter.toolCall() not implemented')
  }

  /** @returns {string} Human-readable runtime name shown in the UI status bar */
  runtimeName() { return 'unknown' }

  /** @returns {string} Model identifier */
  modelName() { return 'unknown' }

  /** @returns {boolean} True once the model has finished loading */
  isReady() { return false }
}
