/**
 * Adapter factory — auto-detects the best available runtime.
 * Add new runtimes by inserting checks before the WebGPU branch.
 * agent.js and all tool files require zero changes when runtimes change.
 */
export async function createAdapter(onProgress) {
  const hasWebGPU = !!navigator.gpu

  if (hasWebGPU) {
    console.info('[adapter] WebGPU detected — loading WebLLMAdapter')
    const { WebLLMAdapter } = await import('./webllm.js')
    const adapter = new WebLLMAdapter(onProgress)
    await adapter.load()
    return adapter
  }

  console.warn('[adapter] WebGPU not available — falling back to TransformersAdapter (WASM)')
  const { TransformersAdapter } = await import('./transformers.js')
  const adapter = new TransformersAdapter(onProgress)
  await adapter.load()
  return adapter
}
