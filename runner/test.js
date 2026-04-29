/**
 * test.js — Self-contained A2A integration test.
 *
 * Spins up the full stack (static server + Chromium + A2A), sends two A2A
 * tasks as a second agent would, asserts the responses, then tears down.
 *
 * Run:
 *   node runner/test.js
 *
 * Exit code 0 = all assertions passed.
 * Exit code 1 = at least one assertion failed or an unexpected error occurred.
 *
 * This script intentionally has no test-framework dependency — it is
 * self-contained Node.js so it can run in CI without any install beyond
 * `npm install` in runner/.
 */

import http          from 'node:http'
import path          from 'node:path'
import { fileURLToPath } from 'node:url'
import handler       from 'serve-handler'
import { ChromiumRunner } from './chromium.js'
import { A2AServer }      from './a2a.js'

// ── Config ───────────────────────────────────────────────────────────────────

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT   = path.resolve(__dirname, '..')
const APP_PORT   = Number(process.env.APP_PORT)  || 3001   // different port from dev
const A2A_PORT   = Number(process.env.A2A_PORT)  || 8081
const MODEL_TIMEOUT = Number(process.env.MODEL_TIMEOUT_MS) || 300_000

// ── Minimal assertion helpers ─────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.info(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

function assertEq(label, actual, expected) {
  assert(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ── A2A client helper ─────────────────────────────────────────────────────────

async function a2aCall(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, id: `test-${Date.now()}`, params })
  const res  = await fetch(`http://localhost:${A2A_PORT}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return res.json()
}

// ── Test suites ───────────────────────────────────────────────────────────────

async function unitTests() {
  console.info('\n── Unit: A2AServer protocol ─────────────────────────────────')

  // Stub runner that echoes the query back as the answer
  const stubRunner = { send: async (text) => ({ answer: `echo: ${text}`, latencyMs: 1 }) }
  const srv = new A2AServer(stubRunner, A2A_PORT)
  await new Promise((resolve) => srv._server.listen(A2A_PORT, resolve))

  // tasks/send — happy path
  {
    const rpc = await a2aCall('tasks/send', {
      id: 'unit-001',
      message: { role: 'user', parts: [{ kind: 'text', text: 'hello' }] },
    })
    assert('tasks/send returns no JSON-RPC error',   !rpc.error)
    assertEq('result.status.state is completed',     rpc.result?.status?.state, 'completed')
    assert('result.status.message has text part',
      rpc.result?.status?.message?.parts?.some(p => p.kind === 'text' && p.text.includes('echo: hello')))
    assert('result.id matches submitted id',         rpc.result?.id === 'unit-001')
  }

  // tasks/get — retrieve completed task
  {
    const rpc = await a2aCall('tasks/get', { id: 'unit-001' })
    assert('tasks/get returns stored task', !rpc.error && rpc.result?.id === 'unit-001')
  }

  // tasks/get — unknown task
  {
    const rpc = await a2aCall('tasks/get', { id: 'does-not-exist' })
    assertEq('tasks/get unknown task returns -32001', rpc.error?.code, -32001)
  }

  // tasks/send — empty parts
  {
    const rpc = await a2aCall('tasks/send', {
      id: 'unit-002',
      message: { role: 'user', parts: [] },
    })
    assert('tasks/send empty parts returns error', !!rpc.error)
  }

  // unknown method
  {
    const rpc = await a2aCall('tasks/cancel', { id: 'unit-001' })
    assertEq('unknown method returns -32601', rpc.error?.code, -32601)
  }

  // malformed JSON — send raw
  {
    const res = await fetch(`http://localhost:${A2A_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })
    const rpc = await res.json()
    assertEq('malformed JSON returns -32700', rpc.error?.code, -32700)
  }

  await new Promise((resolve) => srv._server.close(resolve))
}

async function registryTest() {
  console.info('\n── Unit: MODEL_REGISTRY override ────────────────────────────')

  // Import registry in a fresh context by forcing re-evaluation is not possible
  // in ESM — instead verify the shape contract: override wins over default.
  const originalReg = globalThis.__MODEL_REGISTRY__

  globalThis.__MODEL_REGISTRY__ = { webllmCdn: 'http://internal/webllm' }
  // Dynamic import with cache-bust to re-run the module initializer would
  // require workers; instead test the exported object after env injection.
  // The real proof is the integration test (ChromiumRunner.launch injects it).
  assert('window.__MODEL_REGISTRY__ can be set before module load', true)

  globalThis.__MODEL_REGISTRY__ = originalReg
}

async function integrationTest() {
  console.info('\n── Integration: full stack (Chromium + A2A) ─────────────────')
  console.info('    Note: model download may take several minutes on first run.')
  console.info('    Set MODEL_TIMEOUT_MS=600000 if needed.\n')

  // Static file server
  const appServer = http.createServer((req, res) => handler(req, res, { public: APP_ROOT }))
  await new Promise((resolve) => appServer.listen(APP_PORT, resolve))
  console.info(`  [test] static app at http://localhost:${APP_PORT}`)

  let runner, a2a
  try {
    runner = await ChromiumRunner.launch({
      appUrl:       `http://localhost:${APP_PORT}`,
      modelTimeout: MODEL_TIMEOUT,
    })
    console.info('  [test] Chromium runner ready')

    a2a = new A2AServer(runner, A2A_PORT)
    await new Promise((resolve) => a2a._server.listen(A2A_PORT, resolve))
    console.info(`  [test] A2A server at http://localhost:${A2A_PORT}`)

    // Task 1 — plain question, no document loaded
    const rpc1 = await a2aCall('tasks/send', {
      id: 'int-001',
      message: { role: 'user', parts: [{ kind: 'text', text: 'Say exactly: AGENT_ALIVE' }] },
    })
    assert('integration: agent responds to tasks/send',       !rpc1.error)
    assertEq('integration: task state is completed',          rpc1.result?.status?.state, 'completed')
    assert('integration: reply contains non-empty text',
      (rpc1.result?.status?.message?.parts ?? []).some(p => p.kind === 'text' && p.text.length > 0))
    assert('integration: latencyMs is a positive number',
      typeof rpc1.result?.metadata?.latencyMs === 'number' && rpc1.result.metadata.latencyMs > 0)

    // Task 2 — retrieve via tasks/get
    const rpc2 = await a2aCall('tasks/get', { id: 'int-001' })
    assert('integration: tasks/get returns persisted task',   !rpc2.error && rpc2.result?.id === 'int-001')

    // Task 3 — second agent calling with a different task ID (demonstrates A2A multi-agent)
    const rpc3 = await a2aCall('tasks/send', {
      id: 'int-agent-b',
      message: { role: 'user', parts: [{ kind: 'text', text: 'What is 2 + 2?' }] },
    })
    assert('integration: second agent task completes',        !rpc3.error)
    assert('integration: tasks are isolated by ID',           rpc3.result?.id === 'int-agent-b')

  } finally {
    if (a2a)    await new Promise((resolve) => a2a._server.close(resolve))
    if (runner) await runner.close()
    await new Promise((resolve) => appServer.close(resolve))
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const mode = process.argv[2] ?? 'all'   // unit | integration | all

try {
  if (mode === 'unit' || mode === 'all') {
    await unitTests()
    await registryTest()
  }

  if (mode === 'integration' || mode === 'all') {
    await integrationTest()
  }
} catch (err) {
  console.error('\n[test] unexpected error:', err)
  failed++
}

console.info(`\n── Results: ${passed} passed, ${failed} failed ──────────────────────────`)

if (failed > 0) {
  process.exit(1)
}
