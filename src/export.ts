/**
 * Utilitários de exportação: layout da grade, codificação PNG (com
 * quantização opcional via UPNG) e download.
 */

import UPNG from 'upng-js'
import type { SpriteSheet } from './types'

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

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sprite'
}

/** desambigua slugs repetidos com sufixo _2, _3... (consistente manifesto↔imagem) */
export function uniqueSlug(name: string, used: Set<string>): string {
  let s = slugify(name)
  for (let n = 2; used.has(s); n++) s = `${slugify(name)}_${n}`
  used.add(s)
  return s
}

/**
 * Manifesto JSON de um spritesheet salvo, regenerado a partir dos metadados.
 * meta.version = 4 é a versão de FORMATO; sheet.version é a de GERAÇÃO.
 */
export function buildManifest(
  projectName: string,
  sheet: Pick<SpriteSheet, 'version' | 'createdAt' | 'cell' | 'exportCfg' | 'anims' | 'corrections'>,
): string {
  const pslug = slugify(projectName)
  const animsJson: Record<string, object> = {}
  for (const am of sheet.anims) {
    const pad = sheet.exportCfg.padding
    const frames = am.durationsMs.map((d, i) => {
      const col = i % am.columns
      const row = Math.floor(i / am.columns)
      return {
        name: `${am.slug}_${String(i).padStart(3, '0')}`,
        index: i,
        x: pad + col * (am.cellW + pad),
        y: pad + row * (am.cellH + pad),
        w: am.cellW,
        h: am.cellH,
        duration_ms: d,
      }
    })
    animsJson[am.slug] = {
      image: `${pslug}_${am.slug}.png`,
      size: { w: am.width, h: am.height },
      columns: am.columns,
      rows: am.rows,
      frameCount: am.frameCount,
      fps: am.fps,
      loop: true,
      crossfade: am.crossfade,
      frames,
    }
  }
  return JSON.stringify(
    {
      meta: {
        app: 'SpriteForge',
        version: 4,
        project: projectName,
        format: 'RGBA8888',
        frameSize: { w: sheet.anims[0]?.cellW ?? 0, h: sheet.anims[0]?.cellH ?? 0 },
        pivot: { x: sheet.cell.pivotX, y: sheet.cell.pivotY },
        margin: sheet.cell.margin,
        scale: sheet.exportCfg.scale,
        padding: sheet.exportCfg.padding,
        compression: compressionLabel(sheet.exportCfg.colors),
        generation: sheet.version,
        generatedAt: sheet.createdAt,
        corrections: sheet.corrections.map((c) => ({ kind: c.kind, target: c.target, params: c.params })),
      },
      animations: animsJson,
    },
    null,
    2,
  )
}
