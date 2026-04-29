/**
 * Model registry — all CDN and model-ID constants live here.
 *
 * Override any value by setting window.__MODEL_REGISTRY__ before the page
 * script runs. This is the air-gap hook: point every URL at an internal
 * model server and the agent runs with zero internet dependency.
 *
 * Example override (inject via a <script> tag before the module or via
 * the Chromium runner's page.addInitScript):
 *
 *   window.__MODEL_REGISTRY__ = {
 *     webllmCdn:       'http://registry.internal/web-llm/esm',
 *     transformersCdn: 'http://registry.internal/transformers/2.17.2',
 *     webllmModel:     'Llama-3.2-3B-Instruct-q4f16_1-MLC',
 *     genModel:        'TinyLlama-1.1B-Chat-v1.0',
 *     embedModel:      'all-MiniLM-L6-v2',
 *   }
 */

const _override = (typeof window !== 'undefined' && window.__MODEL_REGISTRY__) || {}

export const MODEL_REGISTRY = {
  webllmCdn:       _override.webllmCdn       ?? 'https://esm.run/@mlc-ai/web-llm',
  transformersCdn: _override.transformersCdn ?? 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2',
  webllmModel:     _override.webllmModel     ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  genModel:        _override.genModel        ?? 'Xenova/TinyLlama-1.1B-Chat-v1.0',
  embedModel:      _override.embedModel      ?? 'Xenova/all-MiniLM-L6-v2',
}
