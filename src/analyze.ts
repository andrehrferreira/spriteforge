/**
 * Motor de análise da área SPRITES: recebe amostras reduzidas (pós-chroma,
 * RGBA premultiplicado) das animações alinhadas e devolve uma lista
 * DETERMINÍSTICA de propostas de correção. As propostas nunca alteram dados
 * das animações — aceitar uma proposta só muda a geração do atlas.
 *
 * As funções deste módulo são puras (testáveis em Node); a única exceção é
 * `sampleFromCanvas`, que materializa amostras a partir de um canvas.
 */

import type { AlignCfg, Correction, CorrectionKind, CorrectionSeverity, CorrectionTarget, ExportCfg, SpritesCfg } from './types'

export interface Bounds { x: number; y: number; w: number; h: number }

/** amostra RGBA premultiplicada de um frame em resolução reduzida */
export interface FrameSample {
  w: number
  h: number
  data: Uint8ClampedArray
}

export interface AnimInput {
  id: string
  name: string
  /** escala de alinhamento da animação */
  scale: number
  /** ajuste fino X do alinhamento (px na origem) */
  dx: number
  /** crossfade efetivo do loop (k) */
  crossfade: number
  /** largura do frame de origem (converte amostra → origem) */
  srcW: number
  bounds: Bounds | null
  /** uma amostra por frame do loop, na ordem */
  samples: FrameSample[]
}

export interface CellInfo { W: number; H: number; px: number; py: number }

// ── amostragem ────────────────────────────────────────────

/**
 * Reduz um canvas para no máx. `maxSide` px e devolve a amostra RGBA
 * premultiplicada (cópia — o canvas de origem pode ser reutilizado).
 */
export function sampleFromCanvas(src: HTMLCanvasElement, maxSide = 192): FrameSample {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * s))
  const h = Math.max(1, Math.round(src.height * s))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  const raw = ctx.getImageData(0, 0, w, h).data
  const data = new Uint8ClampedArray(raw.length)
  for (let i = 0; i < raw.length; i += 4) {
    const a = raw[i + 3]
    data[i] = (raw[i] * a) / 255
    data[i + 1] = (raw[i + 1] * a) / 255
    data[i + 2] = (raw[i + 2] * a) / 255
    data[i + 3] = a
  }
  return { w, h, data }
}

// ── métricas puras ────────────────────────────────────────

/** % de pixels cuja diferença somada (|ΔR|+|ΔG|+|ΔB|+|ΔA|) excede o limiar */
export function diffPct(a: FrameSample, b: FrameSample, pixelThreshold: number): number {
  const n = Math.min(a.data.length, b.data.length)
  if (!n) return 0
  let diff = 0
  for (let i = 0; i < n; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) +
      Math.abs(a.data[i + 3] - b.data[i + 3])
    if (d > pixelThreshold) diff++
  }
  return (diff / (n / 4)) * 100
}

/** centroide ponderado por alpha, em px da amostra */
export function centroidOf(s: FrameSample): { x: number; y: number; m: number } {
  let sm = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const a = s.data[(y * s.w + x) * 4 + 3]
      if (a > 16) {
        sm += a
        sx += a * x
        sy += a * y
      }
    }
  }
  return sm ? { x: sx / sm, y: sy / sm, m: sm } : { x: s.w / 2, y: s.h / 2, m: 0 }
}

/** pixels visíveis cujos 8 vizinhos são todos (quase) transparentes */
export function orphanCount(s: FrameSample, neighborAlpha = 24): number {
  let count = 0
  const { w, h, data } = s
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (data[(y * w + x) * 4 + 3] <= 40) continue
      let solid = false
      for (let dy = -1; dy <= 1 && !solid; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (data[((y + dy) * w + (x + dx)) * 4 + 3] > neighborAlpha) {
            solid = true
            break
          }
        }
      }
      if (!solid) count++
    }
  }
  return count
}

/** nº de cores distintas (quantizadas a 4 bits/canal) nos pixels visíveis */
export function uniqueColorCount(samples: FrameSample[], cap = 1024): number {
  const seen = new Set<number>()
  for (const s of samples) {
    for (let i = 0; i < s.data.length; i += 4) {
      if (s.data[i + 3] <= 32) continue
      seen.add(((s.data[i] >> 4) << 8) | ((s.data[i + 1] >> 4) << 4) | (s.data[i + 2] >> 4))
      if (seen.size >= cap) return cap
    }
  }
  return seen.size
}

/** estimativa grosseira do PNG final (informada como "estimado" na UI) */
export function estimateAtlasBytes(frames: number, cellW: number, cellH: number, colors: number): number {
  const factor = colors < 0 ? 1.1 : colors === 0 ? 0.8 : colors >= 256 ? 0.45 : colors >= 128 ? 0.35 : 0.28
  return Math.round(frames * cellW * cellH * factor)
}

// ── detectores ────────────────────────────────────────────

function corr(
  kind: CorrectionKind,
  severity: CorrectionSeverity,
  target: CorrectionTarget,
  label: string,
  params: Record<string, number>,
  savingsBytes?: number,
): Correction {
  return {
    id: `${kind}:${target.animId ?? 'projeto'}`,
    kind,
    severity,
    target,
    label,
    params,
    savingsBytes,
    accepted: false,
    adjusted: false,
  }
}

/** animações cujo conteúdo destoa da proporção mediana */
export function detectProportion(inputs: AnimInput[], cfg: SpritesCfg): Correction[] {
  const hs = inputs.filter((i) => i.bounds).map((i) => ({ i, h: i.bounds!.h * i.scale }))
  if (hs.length < 2) return []
  const sorted = [...hs].sort((a, b) => a.h - b.h)
  const median = sorted[Math.floor(sorted.length / 2)].h
  if (!median) return []
  const out: Correction[] = []
  for (const { i, h } of hs) {
    const dev = h / median - 1
    if (Math.abs(dev) > cfg.proportionTolerance) {
      const fator = Math.round((median / h) * 100) / 100
      out.push(
        corr('proporcao', 'aviso', { scope: 'animacao', animId: i.id },
          `"${i.name}" está ${Math.round(Math.abs(dev) * 100)}% ${dev > 0 ? 'maior' : 'menor'} que as demais — aplicar escala ${fator}× na geração`,
          { escala: fator }),
      )
    }
  }
  return out
}

/** centro de massa sistematicamente deslocado em relação ao pivô */
export function detectPosition(inputs: AnimInput[], alignCfg: AlignCfg, cfg: SpritesCfg): Correction[] {
  const offs: { i: AnimInput; off: number }[] = []
  for (const i of inputs) {
    if (!i.bounds || !i.samples.length) continue
    let fx = 0
    let n = 0
    for (const s of i.samples) {
      const c = centroidOf(s)
      if (c.m) {
        fx += c.x / s.w
        n++
      }
    }
    if (!n) continue
    const cxSrc = (fx / n) * i.srcW
    const ax = i.bounds.x + i.bounds.w * alignCfg.pivotX + i.dx
    offs.push({ i, off: cxSrc - ax })
  }
  if (offs.length < 2) return []
  const sorted = [...offs].sort((a, b) => a.off - b.off)
  const median = sorted[Math.floor(sorted.length / 2)].off
  const out: Correction[] = []
  for (const { i, off } of offs) {
    const dev = off - median
    if (Math.abs(dev) > cfg.positionTolerancePx) {
      out.push(
        corr('posicao', 'aviso', { scope: 'animacao', animId: i.id },
          `"${i.name}" tem o centro de massa ${Math.round(Math.abs(dev))}px ${dev > 0 ? 'à direita' : 'à esquerda'} das demais — compensar na geração`,
          { dx: Math.round(dev), dy: 0 }),
      )
    }
  }
  return out
}

/** frames consecutivos praticamente idênticos (incluindo a emenda) */
export function detectDuplicates(inputs: AnimInput[], cfg: SpritesCfg, bytesPerFrame: number): Correction[] {
  const out: Correction[] = []
  for (const i of inputs) {
    const n = i.samples.length
    if (n < 3) continue
    const frames: number[] = []
    for (let p = 1; p < n; p++) {
      if (diffPct(i.samples[p - 1], i.samples[p], cfg.pixelDiffThreshold) < cfg.dupThresholdPct) {
        frames.push(p)
      }
    }
    if (i.crossfade === 0 && !frames.includes(n - 1) &&
        diffPct(i.samples[n - 1], i.samples[0], cfg.pixelDiffThreshold) < cfg.dupThresholdPct) {
      frames.push(n - 1)
    }
    // nunca remove todos: mantém ao menos 2 frames
    if (frames.length && n - frames.length >= 2) {
      out.push(
        corr('duplicados', 'info', { scope: 'frame', animId: i.id, frames },
          `"${i.name}": ${frames.length} frame(s) praticamente idênticos ao anterior — remover do atlas (a duração soma no frame anterior)`,
          { limiar: cfg.dupThresholdPct }, Math.round(frames.length * bytesPerFrame)),
      )
    }
  }
  return out
}

/** emenda do loop que não fecha suavemente */
export function detectContinuity(inputs: AnimInput[], cfg: SpritesCfg): Correction[] {
  const out: Correction[] = []
  for (const i of inputs) {
    const n = i.samples.length
    if (n < 4 || i.crossfade > 0) continue
    const seam = diffPct(i.samples[n - 1], i.samples[0], cfg.pixelDiffThreshold)
    // referência: mediana das transições internas
    const internal: number[] = []
    for (let p = 1; p < n; p++) internal.push(diffPct(i.samples[p - 1], i.samples[p], cfg.pixelDiffThreshold))
    internal.sort((a, b) => a - b)
    const typical = internal[Math.floor(internal.length / 2)]
    if (seam > cfg.continuityThresholdPct && seam > typical * 2) {
      out.push(
        corr('continuidade', 'aviso', { scope: 'frame', animId: i.id, frames: [n - 1] },
          `"${i.name}": a emenda do loop salta ${seam.toFixed(0)}% dos pixels (transição típica: ${typical.toFixed(0)}%) — fundir com crossfade na geração`,
          { crossfade: 3 }),
      )
    }
  }
  return out
}

/** margem da célula maior que o necessário */
export function detectTrim(cell: CellInfo, margin: number, estBytes: number): Correction[] {
  if (margin <= 8) return []
  const novo = 8
  const dW = (margin - novo) * 2
  const ratio = 1 - ((cell.W - dW) * (cell.H - dW)) / (cell.W * cell.H)
  return [
    corr('recorte', 'info', { scope: 'projeto' },
      `margem da célula de ${margin}px pode cair para ${novo}px — célula vira ${cell.W - dW}×${cell.H - dW}`,
      { margem: novo }, Math.round(estBytes * ratio)),
  ]
}

/** paleta maior que o necessário (ou ausência de quantização) */
export function detectQuantization(inputs: AnimInput[], exportCfg: ExportCfg, estBytes: number): Correction[] {
  if (exportCfg.colors <= 0) {
    return [
      corr('quantizacao', 'info', { scope: 'projeto' },
        'sem paleta: quantizar para 256 cores reduz drasticamente o PNG com perda visual mínima',
        { cores: 256 }, Math.round(estBytes * 0.55)),
    ]
  }
  if (exportCfg.colors >= 256) {
    const used = uniqueColorCount(inputs.flatMap((i) => i.samples))
    if (used < 140) {
      return [
        corr('quantizacao', 'info', { scope: 'projeto' },
          `apenas ~${used} cores em uso — paleta de 128 cores basta`,
          { cores: 128 }, Math.round(estBytes * 0.2)),
      ]
    }
  }
  return []
}

/** célula final maior do que sprites de jogo costumam precisar */
export function detectScale(cell: CellInfo, exportCfg: ExportCfg, estBytes: number): Correction[] {
  const side = Math.max(cell.W, cell.H) * exportCfg.scale
  if (side <= 640) return []
  const sugerida = Math.max(0.25, Math.round((512 / side) * exportCfg.scale * 100) / 100)
  const ratio = 1 - (sugerida / exportCfg.scale) ** 2
  return [
    corr('escala', 'info', { scope: 'projeto' },
      `célula final com ${Math.round(side)}px — escala ${sugerida}× reduz ~${Math.round(ratio * 100)}% do arquivo`,
      { escala: sugerida }, Math.round(estBytes * ratio)),
  ]
}

/** pixels órfãos / resíduos de chroma isolados */
export function detectPixels(inputs: AnimInput[]): Correction[] {
  const out: Correction[] = []
  for (const i of inputs) {
    if (!i.samples.length) continue
    let total = 0
    for (const s of i.samples) total += orphanCount(s)
    const avg = total / i.samples.length
    if (avg >= 2) {
      out.push(
        corr('pixel', 'info', { scope: 'animacao', animId: i.id },
          `"${i.name}": ~${Math.round(avg)} pixels órfãos por frame (resíduo do chroma) — limpar na geração`,
          { alfa: 24 }),
      )
    }
  }
  return out
}

// ── orquestração ──────────────────────────────────────────

const KIND_ORDER: CorrectionKind[] = [
  'proporcao', 'posicao', 'duplicados', 'continuidade', 'recorte', 'quantizacao', 'escala', 'pixel',
]

/**
 * Roda todos os detectores e devolve as propostas em ordem estável
 * (categoria → ordem das animações). Mesma entrada ⇒ mesma saída.
 */
export function detectAll(
  inputs: AnimInput[],
  cell: CellInfo,
  alignCfg: AlignCfg,
  exportCfg: ExportCfg,
  cfg: SpritesCfg,
): Correction[] {
  const cellW = Math.max(1, Math.round(cell.W * exportCfg.scale))
  const cellH = Math.max(1, Math.round(cell.H * exportCfg.scale))
  const totalFrames = inputs.reduce((m, i) => m + i.samples.length, 0)
  const est = estimateAtlasBytes(totalFrames, cellW, cellH, exportCfg.colors)
  const bytesPerFrame = totalFrames ? est / totalFrames : 0

  const byKind: Record<CorrectionKind, Correction[]> = {
    proporcao: detectProportion(inputs, cfg),
    posicao: detectPosition(inputs, alignCfg, cfg),
    duplicados: detectDuplicates(inputs, cfg, bytesPerFrame),
    continuidade: detectContinuity(inputs, cfg),
    recorte: detectTrim(cell, alignCfg.margin, est),
    quantizacao: detectQuantization(inputs, exportCfg, est),
    escala: detectScale(cell, exportCfg, est),
    pixel: detectPixels(inputs),
  }
  return KIND_ORDER.flatMap((k) => byKind[k])
}
