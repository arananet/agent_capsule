/**
 * Chat panel — renders messages and wires the input form to the agent.
 */
export class ChatPanel {
  /**
   * @param {HTMLElement} threadEl    Message thread container
   * @param {HTMLElement} formEl      <form> with textarea + submit button
   * @param {Function}    onSubmit    async (query: string) => {answer, latencyMs, runtimeName, modelName}
   */
  constructor(threadEl, formEl, onSubmit) {
    this._thread = threadEl
    this._form   = formEl
    this._onSubmit = onSubmit

    this._form.addEventListener('submit', (e) => {
      e.preventDefault()
      this._handleSubmit()
    })
  }

  async _handleSubmit() {
    const textarea = this._form.querySelector('textarea')
    const query = textarea.value.trim()
    if (!query) return

    textarea.value = ''
    this._appendMessage('user', query)

    const skeleton = this._appendSkeleton()
    try {
      const result = await this._onSubmit(query)
      skeleton.remove()
      this._appendMessage('assistant', result.answer, {
        runtime: result.runtimeName,
        model:   result.modelName,
        latency: result.latencyMs
      })
    } catch (err) {
      skeleton.remove()
      console.error('[chat] agent error:', err)
      this._appendMessage('assistant', `Error: ${err.message}`)
    }
  }

  /** @param {'user'|'assistant'} role @param {string} text @param {object} [meta] */
  _appendMessage(role, text, meta = null) {
    const bubble = document.createElement('div')
    bubble.className = `msg msg-${role}`

    const content = document.createElement('p')
    content.textContent = text
    bubble.appendChild(content)

    if (meta) {
      const footer = document.createElement('span')
      footer.className = 'msg-meta'
      footer.textContent = `${meta.runtime} · ${meta.model} · ${meta.latency}ms`
      bubble.appendChild(footer)
    }

    this._thread.appendChild(bubble)
    this._thread.scrollTop = this._thread.scrollHeight
    return bubble
  }

  _appendSkeleton() {
    const skeleton = document.createElement('div')
    skeleton.className = 'msg msg-assistant msg-skeleton'
    skeleton.textContent = 'Thinking…'
    this._thread.appendChild(skeleton)
    this._thread.scrollTop = this._thread.scrollHeight
    return skeleton
  }
}
