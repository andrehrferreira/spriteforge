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
  drift: { x: number; y: number } | null = null,
): Loop {
  const n = bitmaps.length
  const k = n ? Math.min(crossfade, Math.floor(n / 2)) : 0
  const length = Math.max(1, n - k)
  const blendCv = document.createElement('canvas')
  const blendCtx = blendCv.getContext('2d')!
  const outCv = document.createElement('canvas')
  const outCtx = outCv.getContext('2d')!

  // anti-deriva: o conteúdo desloca `drift` px ao longo de um ciclo; cada
  // frame recebe a fração inversa para o último emendar exato no primeiro
  const shift = (q: number): [number, number] =>
    drift ? [Math.round((-drift.x * q) / length), Math.round((-drift.y * q) / length)] : [0, 0]

  function render(p: number): HTMLCanvasElement {
    const j = k + p
    const tail = bitmaps[j]
    const i = j - (n - k)
    const [tx, ty] = shift(j)

    if (k === 0 || i < 0) {
      const src = proc.render(tail, settings)
      if (!drift) return src
      if (outCv.width !== tail.width || outCv.height !== tail.height) {
        outCv.width = tail.width
        outCv.height = tail.height
      }
      outCtx.clearRect(0, 0, outCv.width, outCv.height)
      outCtx.drawImage(src, tx, ty)
      return outCv
    }

    // rampa smoothstep: entrada/saída da fusão mais suaves que a linear
    const wl = (i + 1) / (k + 1)
    const w = wl * wl * (3 - 2 * wl)
    const head = bitmaps[i]
    const [hx, hy] = shift(i)
    if (blendCv.width !== tail.width || blendCv.height !== tail.height) {
      blendCv.width = tail.width
      blendCv.height = tail.height
    }
    blendCtx.globalCompositeOperation = 'source-over'
    blendCtx.clearRect(0, 0, blendCv.width, blendCv.height)
    blendCtx.globalAlpha = 1 - w
    blendCtx.drawImage(proc.render(tail, settings), tx, ty)
    // 'lighter' soma em espaço pré-multiplicado → dissolve linear de verdade
    blendCtx.globalCompositeOperation = 'lighter'
    blendCtx.globalAlpha = w
    blendCtx.drawImage(proc.render(head, settings), hx, hy)
    blendCtx.globalAlpha = 1
    blendCtx.globalCompositeOperation = 'source-over'
    return blendCv
  }

  return { length, k, render }
}
