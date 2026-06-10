/**
 * Composição do loop final de uma animação: chroma key (GPU) + crossfade
 * da emenda. Compartilhado entre o editor, o alinhamento e a exportação.
 */

import type { ChromaProcessor, ChromaSettings } from './chroma'

export interface Loop {
  /** nº de frames do loop final (já descontado o crossfade) */
  length: number
  /** nº de frames consumidos pela fusão da emenda */
  k: number
  /** compõe o frame p (0..length-1); o canvas retornado é reutilizado — use drawImage logo em seguida */
  render(p: number): HTMLCanvasElement
}

export function createLoop(
  proc: ChromaProcessor,
  bitmaps: ImageBitmap[],
  settings: ChromaSettings,
  crossfade: number,
): Loop {
  const n = bitmaps.length
  const k = n ? Math.min(crossfade, Math.floor(n / 2)) : 0
  const length = Math.max(1, n - k)
  const blendCv = document.createElement('canvas')
  const blendCtx = blendCv.getContext('2d')!

  function render(p: number): HTMLCanvasElement {
    const j = k + p
    const tail = bitmaps[j]
    const i = j - (n - k)
    if (k === 0 || i < 0) return proc.render(tail, settings)

    const w = (i + 1) / (k + 1)
    const head = bitmaps[i]
    if (blendCv.width !== tail.width || blendCv.height !== tail.height) {
      blendCv.width = tail.width
      blendCv.height = tail.height
    }
    blendCtx.globalCompositeOperation = 'source-over'
    blendCtx.clearRect(0, 0, blendCv.width, blendCv.height)
    blendCtx.globalAlpha = 1 - w
    blendCtx.drawImage(proc.render(tail, settings), 0, 0)
    // 'lighter' soma em espaço pré-multiplicado → dissolve linear de verdade
    blendCtx.globalCompositeOperation = 'lighter'
    blendCtx.globalAlpha = w
    blendCtx.drawImage(proc.render(head, settings), 0, 0)
    blendCtx.globalAlpha = 1
    blendCtx.globalCompositeOperation = 'source-over'
    return blendCv
  }

  return { length, k, render }
}
