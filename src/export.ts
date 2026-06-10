/**
 * Utilitários de exportação: layout da grade, codificação PNG (com
 * quantização opcional via UPNG) e download.
 */

import UPNG from 'upng-js'

export interface LayoutOpts {
  scale: number
  padding: number
  /** 0 = automático (≈ quadrado) */
  columns: number
}

export interface SheetLayout {
  cellW: number
  cellH: number
  cols: number
  rows: number
  width: number
  height: number
  padding: number
}

export const MAX_SHEET_DIM = 16384

export function computeLayout(count: number, frameW: number, frameH: number, opts: LayoutOpts): SheetLayout {
  const cellW = Math.max(1, Math.round(frameW * opts.scale))
  const cellH = Math.max(1, Math.round(frameH * opts.scale))
  const cols = opts.columns > 0 ? Math.min(opts.columns, count) : Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const pad = opts.padding
  return {
    cellW,
    cellH,
    cols,
    rows,
    width: cols * cellW + (cols + 1) * pad,
    height: rows * cellH + (rows + 1) * pad,
    padding: pad,
  }
}

/** -1 = PNG nativo do canvas; 0 = otimizado sem perda; N > 0 = paleta de N cores */
export async function encodeCanvas(cv: HTMLCanvasElement, colors: number): Promise<Blob> {
  if (colors < 0) {
    return new Promise<Blob>((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG'))), 'image/png')
    })
  }
  const ctx = cv.getContext('2d')!
  const data = ctx.getImageData(0, 0, cv.width, cv.height)
  const buf = UPNG.encode([data.data.buffer], cv.width, cv.height, colors)
  return new Blob([buf], { type: 'image/png' })
}

export function compressionLabel(colors: number): string {
  return colors < 0 ? 'rgba32' : colors === 0 ? 'rgba32-otimizado' : `paleta-${colors}-cores`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
