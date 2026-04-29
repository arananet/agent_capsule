const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.min.mjs'
const CHUNK_WORDS = 400    // ~512 tokens
const OVERLAP_RATIO = 0.2  // 20% overlap

/**
 * File upload panel — drag-and-drop + file input, chunking, and callback.
 */
export class UploadPanel {
  /**
   * @param {HTMLElement} dropZone
   * @param {HTMLInputElement} fileInput
   * @param {Function} onIngest  async (chunks: string[], meta: {source, hash}) => void
   * @param {Function} onClear   () => void
   */
  constructor(dropZone, fileInput, onIngest, onClear) {
    this._dropZone  = dropZone
    this._fileInput = fileInput
    this._onIngest  = onIngest
    this._onClear   = onClear
    this._info      = dropZone.querySelector('.upload-info')
    this._clearBtn  = dropZone.querySelector('.btn-clear')

    this._wire()
  }

  _wire() {
    this._dropZone.addEventListener('dragover', (e) => {
      e.preventDefault()
      this._dropZone.classList.add('drag-over')
    })
    this._dropZone.addEventListener('dragleave', () => {
      this._dropZone.classList.remove('drag-over')
    })
    this._dropZone.addEventListener('drop', (e) => {
      e.preventDefault()
      this._dropZone.classList.remove('drag-over')
      const file = e.dataTransfer.files[0]
      if (file) this._handleFile(file)
    })
    this._fileInput.addEventListener('change', () => {
      const file = this._fileInput.files[0]
      if (file) this._handleFile(file)
    })
    if (this._clearBtn) {
      this._clearBtn.addEventListener('click', () => this._clear())
    }
  }

  async _handleFile(file) {
    this._setInfo(`Reading ${file.name}…`)
    try {
      const text = await this._extractText(file)
      const chunks = chunkText(text)
      const hash = await fileHash(file)
      this._setInfo(`${file.name} — ${chunks.length} chunks`)
      if (this._clearBtn) this._clearBtn.hidden = false
      await this._onIngest(chunks, { source: file.name, hash })
    } catch (err) {
      console.error('[upload] failed to process file:', err)
      this._setInfo(`Error: ${err.message}`)
    }
  }

  async _extractText(file) {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      return extractPDF(file)
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  _clear() {
    this._fileInput.value = ''
    this._setInfo('Drag a PDF, TXT, or MD file here, or click to browse')
    if (this._clearBtn) this._clearBtn.hidden = true
    this._onClear()
  }

  _setInfo(text) {
    if (this._info) this._info.textContent = text
  }
}

/**
 * Extract full text from a PDF file using PDF.js.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractPDF(file) {
  const { getDocument, GlobalWorkerOptions } = await import(PDFJS_CDN)
  // Disable the worker to avoid needing a separate worker file
  GlobalWorkerOptions.workerSrc = ''

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => item.str).join(' '))
  }
  return pages.join('\n\n')
}

/**
 * Sliding-window chunker: ~400 words per chunk, 20% overlap.
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []

  const step   = Math.floor(CHUNK_WORDS * (1 - OVERLAP_RATIO))
  const chunks = []
  for (let i = 0; i < words.length; i += step) {
    const chunk = words.slice(i, i + CHUNK_WORDS).join(' ')
    if (chunk.trim()) chunks.push(chunk)
    if (i + CHUNK_WORDS >= words.length) break
  }
  return chunks
}

/**
 * Compute a short SHA-256 hex fingerprint of a file for localStorage keying.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function fileHash(file) {
  const buf    = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
