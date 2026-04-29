/**
 * chromium.js — Headless Chromium controller.
 *
 * Launches a real Chromium process (via Playwright) with WebGPU enabled,
 * serves the static app, and exposes a single async method:
 *
 *   const runner = await ChromiumRunner.launch({ appUrl, modelRegistry })
 *   const { answer, latencyMs } = await runner.send('What is the candidate's main skill?')
 *   await runner.close()
 *
 * modelRegistry (optional) — overrides window.__MODEL_REGISTRY__ before any
 * module loads. Use this to point all model downloads at an internal server.
 */

import { chromium } from 'playwright'
import { homedir }  from 'os'
import { join }     from 'path'

// Persistent user-data dir: lifts in-memory storage quota so model files
// (~2 GB) can be cached on disk and reused across runner restarts.
const USER_DATA_DIR = join(homedir(), '.agent_capsule_browser')

export class ChromiumRunner {
  constructor(context, page) {
    this._context = context
    this._page    = page
  }

  /**
   * @param {object} opts
   * @param {string}  opts.appUrl        URL of the static app (e.g. http://localhost:3000)
   * @param {object}  [opts.modelRegistry] Optional registry override for air-gapped deployments
   * @param {number}  [opts.modelTimeout=300_000] Max ms to wait for the model to load
   * @returns {Promise<ChromiumRunner>}
   */
  static async launch({ appUrl, modelRegistry, modelTimeout = 300_000 }) {
    // launchPersistentContext stores IndexedDB/Cache API on disk under
    // USER_DATA_DIR, which removes the in-memory quota cap and caches the
    // model between runs.
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--disable-dawn-features=disallow_unsafe_apis',
        // Increase V8 heap so WASM can allocate large ONNX model buffers
        '--js-flags=--max-old-space-size=4096',
        // macOS uses Metal automatically; Linux needs Vulkan/SwiftShader
        ...(process.platform === 'linux' ? [
          '--enable-features=Vulkan',
          '--use-angle=vulkan',
        ] : []),
        '--no-sandbox',
      ],
    })

    const page = await context.newPage()

    // Headless Chromium uses SwiftShader which lacks shader-f16 support required
    // by the default q4f16 WebLLM model.  Mask navigator.gpu so the adapter
    // auto-selects the Transformers.js/WASM path instead.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true })
    })

    // Inject the model registry override before any ES module runs
    if (modelRegistry) {
      await page.addInitScript((reg) => {
        window.__MODEL_REGISTRY__ = reg
      }, modelRegistry)
    }

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })

    // Forward browser console to Node stdout so model download progress is visible
    page.on('console', (msg) => {
      const type = msg.type()
      const text = msg.text()
      if (type === 'error') console.error('[browser]', text)
      else                  console.info('[browser]', text)
    })
    page.on('pageerror', (err) => console.error('[browser:error]', err.message))

    // Wait until the adapter has loaded and the bridge is ready.
    // Manual polling avoids Playwright's internal default timeout entirely.
    console.info('[runner] waiting for adapter to be ready…')
    const deadline = Date.now() + modelTimeout
    while (true) {
      const ready = await page.evaluate(() => !!window.__agentReady).catch(() => false)
      if (ready) break
      if (Date.now() > deadline) throw new Error(`Adapter not ready after ${modelTimeout}ms`)
      await new Promise(r => setTimeout(r, 3000))
    }
    console.info('[runner] adapter ready')

    return new ChromiumRunner(context, page)
  }

  /**
   * Send a text message to the agent and return the response.
   * @param {string} text
   * @returns {Promise<{answer: string, latencyMs: number}>}
   */
  async send(text) {
    return this._page.evaluate(async (msg) => window.__agentSend(msg), text)
  }

  async close() {
    await this._context.close()
  }
}
