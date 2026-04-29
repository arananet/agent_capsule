/**
 * a2a.js — Minimal A2A (Agent-to-Agent) HTTP server.
 *
 * Implements the Google A2A JSON-RPC 2.0 protocol subset needed to accept
 * a task, drive the headless Chromium runner, and return a completed task.
 *
 * Supported methods:
 *   tasks/send   — submit a message, blocks until the agent replies
 *   tasks/get    — retrieve a previously completed task by ID
 *
 * Wire format (tasks/send request):
 *   {
 *     "jsonrpc": "2.0",
 *     "method":  "tasks/send",
 *     "id":      "req-1",
 *     "params": {
 *       "id": "task-abc",
 *       "message": {
 *         "role":  "user",
 *         "parts": [{ "kind": "text", "text": "What is the candidate's experience?" }]
 *       }
 *     }
 *   }
 */

import http from 'node:http'

export class A2AServer {
  /**
   * @param {import('./chromium.js').ChromiumRunner} runner
   * @param {number} port
   */
  constructor(runner, port) {
    this._runner  = runner
    this._port    = port
    this._tasks   = new Map()   // taskId → completed task object
    this._server  = http.createServer((req, res) => this._handle(req, res))
  }

  start() {
    this._server.listen(this._port, () => {
      console.info(`[a2a] listening on http://localhost:${this._port}`)
    })
  }

  async _handle(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let body = ''
    for await (const chunk of req) body += chunk

    let rpc
    try {
      rpc = JSON.parse(body)
    } catch {
      return this._error(res, null, -32700, 'Parse error')
    }

    const { method, id, params } = rpc

    try {
      if (method === 'tasks/send') {
        const result = await this._tasksend(params)
        return this._ok(res, id, result)
      }

      if (method === 'tasks/get') {
        const task = this._tasks.get(params?.id)
        if (!task) return this._error(res, id, -32001, 'Task not found')
        return this._ok(res, id, task)
      }

      return this._error(res, id, -32601, `Method not found: ${method}`)
    } catch (err) {
      console.error('[a2a] handler error:', err)
      return this._error(res, id, -32603, err.message)
    }
  }

  async _tasksend(params) {
    const taskId = params?.id ?? `task-${Date.now()}`
    const parts  = params?.message?.parts ?? []
    const text   = parts.find(p => p.kind === 'text')?.text ?? ''

    if (!text) throw new Error('No text part in message')

    console.info(`[a2a] task ${taskId}: "${text.slice(0, 80)}…"`)
    const { answer, latencyMs } = await this._runner.send(text)

    const task = {
      id:     taskId,
      status: {
        state:   'completed',
        message: {
          role:  'agent',
          parts: [{ kind: 'text', text: answer }],
        },
      },
      metadata: { latencyMs },
      artifacts: [],
    }

    this._tasks.set(taskId, task)
    return task
  }

  _ok(res, id, result) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  _error(res, id, code, message) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
  }
}
