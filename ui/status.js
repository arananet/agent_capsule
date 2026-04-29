/**
 * Status bar — shows adapter runtime, model name, chunk count, and load progress.
 */
export class StatusBar {
  /**
   * @param {HTMLElement} el   The status bar root element
   */
  constructor(el) {
    this._el = el
    this._progressBar = el.querySelector('.status-progress-bar')
    this._progressText = el.querySelector('.status-progress-text')
    this._runtimeBadge = el.querySelector('.status-runtime')
    this._modelName = el.querySelector('.status-model')
    this._chunkCount = el.querySelector('.status-chunks')
    this._progressWrap = el.querySelector('.status-progress-wrap')
  }

  /** Show load progress (0–100). */
  setProgress(report) {
    if (this._progressWrap) this._progressWrap.hidden = false
    if (this._progressBar)  this._progressBar.style.width = `${report.progress}%`
    if (this._progressText) this._progressText.textContent = report.text || ''
    if (report.progress >= 100) {
      setTimeout(() => {
        if (this._progressWrap) this._progressWrap.hidden = true
      }, 1200)
    }
  }

  /** @param {import('../agent/adapter/base.js').ModelAdapter} adapter */
  setAdapter(adapter) {
    if (this._runtimeBadge) {
      this._runtimeBadge.textContent = adapter.runtimeName()
      this._runtimeBadge.dataset.runtime = adapter.runtimeName().toLowerCase()
    }
    if (this._modelName) this._modelName.textContent = adapter.modelName()
  }

  /** @param {number} count */
  setChunkCount(count) {
    if (this._chunkCount) this._chunkCount.textContent = `${count} chunk${count !== 1 ? 's' : ''}`
  }

  setLoading() {
    if (this._runtimeBadge) this._runtimeBadge.textContent = 'Loading…'
  }
}
