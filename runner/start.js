/**
 * start.js — Entry point for the headless Chromium + A2A runner.
 *
 * Starts a local static file server for the app, launches the Chromium
 * runner, and starts the A2A HTTP endpoint.
 *
 * Usage:
 *   node start.js
 *
 * Environment variables:
 *   APP_PORT          Static file server port (default: 3000)
 *   A2A_PORT          A2A HTTP server port   (default: 8080)
 *   MODEL_TIMEOUT_MS  Max ms to wait for model load (default: 300000)
 *
 *   # Air-gap / offline override — point all model downloads at your internal registry:
 *   MODEL_REGISTRY_WEBLLM_CDN        e.g. http://registry.internal/web-llm/esm
 *   MODEL_REGISTRY_TRANSFORMERS_CDN  e.g. http://registry.internal/transformers/2.17.2
 *   MODEL_REGISTRY_WEBLLM_MODEL      e.g. Llama-3.2-3B-Instruct-q4f16_1-MLC
 *   MODEL_REGISTRY_GEN_MODEL         e.g. TinyLlama-1.1B-Chat-v1.0
 *   MODEL_REGISTRY_EMBED_MODEL       e.g. all-MiniLM-L6-v2
 */

import http          from 'node:http'
import path          from 'node:path'
import { fileURLToPath } from 'node:url'
import handler       from 'serve-handler'
import { ChromiumRunner } from './chromium.js'
import { A2AServer }      from './a2a.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT  = path.resolve(__dirname, '..')

const APP_PORT      = Number(process.env.APP_PORT)      || 3000
const A2A_PORT      = Number(process.env.A2A_PORT)      || 8080
const MODEL_TIMEOUT = Number(process.env.MODEL_TIMEOUT_MS) || 300_000

// Build the model registry from env vars (only include keys that are set)
const modelRegistry = {}
if (process.env.MODEL_REGISTRY_WEBLLM_CDN)       modelRegistry.webllmCdn       = process.env.MODEL_REGISTRY_WEBLLM_CDN
if (process.env.MODEL_REGISTRY_TRANSFORMERS_CDN)  modelRegistry.transformersCdn = process.env.MODEL_REGISTRY_TRANSFORMERS_CDN
if (process.env.MODEL_REGISTRY_WEBLLM_MODEL)      modelRegistry.webllmModel     = process.env.MODEL_REGISTRY_WEBLLM_MODEL
if (process.env.MODEL_REGISTRY_GEN_MODEL)         modelRegistry.genModel        = process.env.MODEL_REGISTRY_GEN_MODEL
if (process.env.MODEL_REGISTRY_EMBED_MODEL)       modelRegistry.embedModel      = process.env.MODEL_REGISTRY_EMBED_MODEL

// ── 1. Static file server ────────────────────────────────────────────────────
const appServer = http.createServer((req, res) => handler(req, res, { public: APP_ROOT }))
await new Promise((resolve) => appServer.listen(APP_PORT, resolve))
console.info(`[runner] static app at http://localhost:${APP_PORT}`)

// ── 2. Headless Chromium ─────────────────────────────────────────────────────
console.info('[runner] launching Chromium…')
const runner = await ChromiumRunner.launch({
  appUrl:        `http://localhost:${APP_PORT}`,
  modelRegistry: Object.keys(modelRegistry).length ? modelRegistry : undefined,
  modelTimeout:  MODEL_TIMEOUT,
})

// ── 3. A2A server ────────────────────────────────────────────────────────────
const a2a = new A2AServer(runner, A2A_PORT)
a2a.start()

// ── Graceful shutdown ────────────────────────────────────────────────────────
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.info(`[runner] ${sig} — shutting down`)
    await runner.close()
    appServer.close()
    process.exit(0)
  })
}
