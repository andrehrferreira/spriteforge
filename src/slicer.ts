/**
 * Fatiador de sprites de itens: recebe uma folha (com alpha ou fundo
 * sólido), detecta cada item por componentes conectados na máscara de
 * alpha, permite ajustar os cortes num preview interativo e exporta todos
 * no mesmo tamanho quadrado (64×64 por padrão) com PNG otimizado, num ZIP.
 *
 * As funções de geometria são puras (testáveis em Node).
 */

import { strToU8, zipSync } from 'fflate'
import { encodeCanvas, slugify } from './export'
import { toast } from './toast'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// ── geometria pura ────────────────────────────────────────

/** caixas dos componentes conectados (8-conectividade) com área mínima */
export function componentBoxes(alpha: Uint8Array, w: number, h: number, minArea: number): Box[] {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const boxes: Box[] = []
  for (let start = 0; start < w * h; start++) {
    if (!alpha[start] || seen[start]) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w
      const y = (i / w) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (alpha[j] && !seen[j]) {
            seen[j] = 1
            stack[sp++] = j
          }
        }
      }
    }
    if (area >= minArea) boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  return boxes
}

/** funde caixas cuja expansão por `dist` px se intersecta (até estabilizar) */
export function mergeBoxes(boxes: Box[], dist: number): Box[] {
  const out = boxes.map((b) => ({ ...b }))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        if (
          a.x - dist < b.x + b.w && b.x - dist < a.x + a.w &&
          a.y - dist < b.y + b.h && b.y - dist < a.y + a.h
        ) {
          const x = Math.min(a.x, b.x)
          const y = Math.min(a.y, b.y)
          a.w = Math.max(a.x + a.w, b.x + b.w) - x
          a.h = Math.max(a.y + a.h, b.y + b.h) - y
          a.x = x
          a.y = y
          out.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return out
}

/** ordena em ordem de leitura: agrupa por linha (centros próximos) e ordena por x */
export function sortReadingOrder(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
  const rows: Box[][] = []
  for (const b of sorted) {
    const cy = b.y + b.h / 2
    const row = rows.find((r) => {
      const ref = r[0]
      return Math.abs(cy - (ref.y + ref.h / 2)) < Math.max(ref.h, b.h) * 0.5
    })
    if (row) row.push(b)
    else rows.push([b])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x))
}

/** retângulo de destino centralizado num quadrado `out`, com margem interna */
export function fitRect(box: Box, out: number, marginPct: number): { dx: number; dy: number; dw: number; dh: number } {
  const margin = (out * marginPct) / 100
  const avail = Math.max(1, out - margin * 2)
  const s = Math.min(avail / Math.max(1, box.w), avail / Math.max(1, box.h))
  const dw = box.w * s
  const dh = box.h * s
  return { dx: (out - dw) / 2, dy: (out - dh) / 2, dw, dh }
}

// ── tela ──────────────────────────────────────────────────

export function initSlicer(): () => void {
  let alive = true
  let src: HTMLCanvasElement | null = null // imagem de trabalho (fundo removido)
  let baseName = 'item'
  let boxes: Box[] = []
  let selected = -1
  let lastVs = 1
  let lastOx = 0
  let lastOy = 0

  const wrap = $('#sl-wrap')
  const cv = $<HTMLCanvasElement>('#sl-canvas')
  const ctx = cv.getContext('2d')!

  const thrInput = $<HTMLInputElement>('#sl-threshold')
  const minAreaInput = $<HTMLInputElement>('#sl-minarea')
  const mergeInput = $<HTMLInputElement>('#sl-merge')
  const tolInput = $<HTMLInputElement>('#sl-tol')
  const sizeSelect = $<HTMLSelectElement>('#sl-size')
  const marginInput = $<HTMLInputElement>('#sl-margin')
  const colorsSelect = $<HTMLSelectElement>('#sl-colors')
  const nameInput = $<HTMLInputElement>('#sl-name')

  function status(msg: string): void {
    $('#sl-status').textContent = msg ? `· ${msg}` : ''
  }

  thrInput.oninput = () => {
    $('#sl-threshold-val').textContent = thrInput.value
  }

  // ── carregar imagem ─────────────────────────────────────
  const fileInput = $<HTMLInputElement>('#sl-file')
  $('#sl-add').onclick = () => fileInput.click()
  fileInput.onchange = () => {
    if (fileInput.files?.[0]) void loadImage(fileInput.files[0])
    fileInput.value = ''
  }
  wrap.ondragover = (e) => e.preventDefault()
  wrap.ondrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f) void loadImage(f)
  }

  async function loadImage(f: File): Promise<void> {
    if (!f.type.startsWith('image/')) {
      toast('O ARQUIVO NÃO É UMA IMAGEM', true)
      return
    }
    try {
      const bmp = await createImageBitmap(f)
      if (!alive) return
      baseName = slugify(f.name.replace(/\.[^.]+$/, ''))
      nameInput.value = baseName
      src = prepareSource(bmp)
      bmp.close()
      detect()
      toast(`${boxes.length} ITENS DETECTADOS`)
    } catch (err) {
      console.error(err)
      toast('FALHA AO LER A IMAGEM', true)
    }
  }

  /** desenha a imagem e, se for opaca, remove o fundo sólido por flood fill */
  function prepareSource(bmp: ImageBitmap): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const cx = c.getContext('2d', { willReadFrequently: true })!
    cx.drawImage(bmp, 0, 0)
    const img = cx.getImageData(0, 0, c.width, c.height)
    const d = img.data
    let hasAlpha = false
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 250) {
        hasAlpha = true
        break
      }
    }
    if (hasAlpha) return c

    // fundo sólido: cor média dos 4 cantos, inundação a partir das bordas
    const w = c.width
    const h = c.height
    const tol = Math.max(0, Math.floor(Number(tolInput.value) || 14))
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4]
    const bg = [0, 1, 2].map((ch) => corners.reduce((m, o) => m + d[o + ch], 0) / 4)
    const isBg = new Uint8Array(w * h)
    const stack = new Int32Array(w * h)
    let sp = 0
    const tryPush = (i: number): void => {
      if (isBg[i]) return
      const o = i * 4
      if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) <= tol) {
        isBg[i] = 1
        stack[sp++] = i
      }
    }
    for (let x = 0; x < w; x++) {
      tryPush(x)
      tryPush((h - 1) * w + x)
    }
    for (let y = 0; y < h; y++) {
      tryPush(y * w)
      tryPush(y * w + w - 1)
    }
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w
      if (x > 0) tryPush(i - 1)
      if (x < w - 1) tryPush(i + 1)
      if (i >= w) tryPush(i - w)
      if (i < w * (h - 1)) tryPush(i + w)
    }
    for (let i = 0; i < w * h; i++) {
      if (isBg[i]) d[i * 4 + 3] = 0
    }
    cx.putImageData(img, 0, 0)
    return c
  }

  // ── detecção ────────────────────────────────────────────
  function detect(): void {
    if (!src) return
    status('DETECTANDO...')
    const w = src.width
    const h = src.height
    const d = src.getContext('2d')!.getImageData(0, 0, w, h).data
    const thr = Math.max(1, Math.floor(Number(thrInput.value) || 24))
    const mask = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] >= thr ? 1 : 0
    const minArea = Math.max(1, Math.floor(Number(minAreaInput.value) || 64))
    const dist = Math.max(0, Math.floor(Number(mergeInput.value) || 12))
    boxes = sortReadingOrder(mergeBoxes(componentBoxes(mask, w, h, minArea), dist))
    selected = -1
    status('')
    updateInfo()
    render()
  }

  $('#sl-redetect').onclick = () => {
    if (!src) {
      toast('CARREGUE UMA IMAGEM PRIMEIRO', true)
      return
    }
    detect()
    toast(`${boxes.length} ITENS DETECTADOS`)
  }

  function updateInfo(): void {
    $('#sl-count').textContent = boxes.length ? `· ${boxes.length} itens` : ''
    const out = Number(sizeSelect.value)
    $('#sl-summary').textContent = boxes.length
      ? `${boxes.length} itens → ${out}×${out}px cada, num único ZIP`
      : 'carregue uma folha e ajuste os cortes'
    syncSelInputs()
  }

  // ── preview e edição das caixas ─────────────────────────
  function resizeCanvas(): void {
    const r = wrap.getBoundingClientRect()
    cv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
    cv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
    render()
  }

  function render(): void {
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (!src) {
      ctx.font = `${13 * devicePixelRatio}px Silkscreen, monospace`
      ctx.fillStyle = '#75896d'
      ctx.textAlign = 'center'
      ctx.fillText('ARRASTE A FOLHA DE ITENS AQUI', cv.width / 2, cv.height / 2)
      return
    }
    const vs = Math.min((cv.width * 0.96) / src.width, (cv.height * 0.96) / src.height)
    lastVs = vs
    lastOx = (cv.width - src.width * vs) / 2
    lastOy = (cv.height - src.height * vs) / 2
    ctx.imageSmoothingEnabled = vs < 1
    ctx.drawImage(src, lastOx, lastOy, src.width * vs, src.height * vs)

    ctx.font = `${9 * devicePixelRatio}px Silkscreen, monospace`
    ctx.textAlign = 'left'
    boxes.forEach((b, i) => {
      const x = lastOx + b.x * vs
      const y = lastOy + b.y * vs
      const bw = b.w * vs
      const bh = b.h * vs
      const sel = i === selected
      ctx.strokeStyle = sel ? '#ff4fd8' : 'rgba(82, 255, 122, 0.85)'
      ctx.lineWidth = sel ? 2 : 1
      ctx.strokeRect(x + 0.5, y + 0.5, bw, bh)
      ctx.fillStyle = sel ? '#ff4fd8' : 'rgba(82, 255, 122, 0.9)'
      ctx.fillText(String(i + 1).padStart(2, '0'), x + 3, y + 11 * devicePixelRatio)
      if (sel) {
        // alça de redimensionar no canto inferior direito
        ctx.fillRect(x + bw - 6 * devicePixelRatio, y + bh - 6 * devicePixelRatio, 6 * devicePixelRatio, 6 * devicePixelRatio)
      }
    })
    ctx.lineWidth = 1
  }

  function toImg(e: PointerEvent): { x: number; y: number } {
    const r = cv.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * devicePixelRatio - lastOx) / lastVs,
      y: ((e.clientY - r.top) * devicePixelRatio - lastOy) / lastVs,
    }
  }

  let drag:
    | { mode: 'move' | 'resize'; idx: number; startX: number; startY: number; orig: Box }
    | { mode: 'new'; idx: number; startX: number; startY: number }
    | null = null

  cv.onpointerdown = (e) => {
    if (!src) return
    const p = toImg(e)
    // alça de resize da caixa selecionada tem prioridade
    if (selected >= 0) {
      const b = boxes[selected]
      const handle = 10 / lastVs
      if (Math.abs(p.x - (b.x + b.w)) < handle && Math.abs(p.y - (b.y + b.h)) < handle) {
        drag = { mode: 'resize', idx: selected, startX: p.x, startY: p.y, orig: { ...b } }
        cv.setPointerCapture(e.pointerId)
        return
      }
    }
    // menor caixa sob o cursor
    let hit = -1
    let hitArea = Infinity
    boxes.forEach((b, i) => {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && b.w * b.h < hitArea) {
        hit = i
        hitArea = b.w * b.h
      }
    })
    if (hit >= 0) {
      selected = hit
      drag = { mode: 'move', idx: hit, startX: p.x, startY: p.y, orig: { ...boxes[hit] } }
    } else {
      // área vazia: cria caixa nova
      const nb: Box = { x: Math.round(p.x), y: Math.round(p.y), w: 4, h: 4 }
      boxes.push(nb)
      selected = boxes.length - 1
      drag = { mode: 'new', idx: selected, startX: p.x, startY: p.y }
    }
    cv.setPointerCapture(e.pointerId)
    updateInfo()
    render()
  }

  cv.onpointermove = (e) => {
    if (!drag || !src) return
    const p = toImg(e)
    const b = boxes[drag.idx]
    if (drag.mode === 'move') {
      b.x = Math.round(drag.orig.x + (p.x - drag.startX))
      b.y = Math.round(drag.orig.y + (p.y - drag.startY))
    } else if (drag.mode === 'resize') {
      b.w = Math.max(4, Math.round(drag.orig.w + (p.x - drag.startX)))
      b.h = Math.max(4, Math.round(drag.orig.h + (p.y - drag.startY)))
    } else {
      b.x = Math.round(Math.min(drag.startX, p.x))
      b.y = Math.round(Math.min(drag.startY, p.y))
      b.w = Math.max(4, Math.round(Math.abs(p.x - drag.startX)))
      b.h = Math.max(4, Math.round(Math.abs(p.y - drag.startY)))
    }
    syncSelInputs()
    render()
  }

  cv.onpointerup = () => {
    drag = null
  }

  // campos numéricos da caixa selecionada
  const selX = $<HTMLInputElement>('#sl-x')
  const selY = $<HTMLInputElement>('#sl-y')
  const selW = $<HTMLInputElement>('#sl-w')
  const selH = $<HTMLInputElement>('#sl-h')

  function syncSelInputs(): void {
    const b = selected >= 0 ? boxes[selected] : null
    $('#sl-selinfo').textContent = b ? `item ${String(selected + 1).padStart(2, '0')}` : 'nenhuma caixa selecionada'
    for (const [input, v] of [[selX, b?.x], [selY, b?.y], [selW, b?.w], [selH, b?.h]] as const) {
      input.value = v != null ? String(v) : ''
      input.disabled = !b
    }
    $<HTMLButtonElement>('#sl-delete').disabled = !b
  }

  for (const [input, key] of [[selX, 'x'], [selY, 'y'], [selW, 'w'], [selH, 'h']] as const) {
    input.oninput = () => {
      if (selected < 0) return
      const v = Math.round(Number(input.value))
      if (!Number.isFinite(v)) return
      boxes[selected][key] = key === 'w' || key === 'h' ? Math.max(4, v) : v
      render()
    }
  }

  $<HTMLButtonElement>('#sl-delete').onclick = () => {
    if (selected < 0) return
    boxes.splice(selected, 1)
    selected = -1
    updateInfo()
    render()
  }

  sizeSelect.onchange = updateInfo

  // ── exportação ──────────────────────────────────────────
  const exportBtn = $<HTMLButtonElement>('#sl-export')
  exportBtn.onclick = () => void exportZip()

  async function exportZip(): Promise<void> {
    if (!src || !boxes.length) {
      toast('NADA PARA EXPORTAR', true)
      return
    }
    exportBtn.disabled = true
    try {
      const out = Number(sizeSelect.value)
      const marginPct = Math.max(0, Math.min(40, Number(marginInput.value) || 0))
      const colors = Number(colorsSelect.value)
      const base = slugify(nameInput.value || baseName)
      const ordered = sortReadingOrder(boxes)
      const files: Record<string, Uint8Array> = {}
      for (let i = 0; i < ordered.length; i++) {
        exportBtn.textContent = `GERANDO ${i + 1}/${ordered.length}...`
        const b = ordered[i]
        const c = document.createElement('canvas')
        c.width = out
        c.height = out
        const cx = c.getContext('2d')!
        const f = fitRect(b, out, marginPct)
        cx.imageSmoothingEnabled = true
        cx.imageSmoothingQuality = 'high'
        cx.drawImage(src, b.x, b.y, b.w, b.h, f.dx, f.dy, f.dw, f.dh)
        const blob = await encodeCanvas(c, colors)
        files[`${base}_${String(i + 1).padStart(3, '0')}.png`] = new Uint8Array(await blob.arrayBuffer())
        if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0))
        if (!alive) return
      }
      files[`${base}.json`] = strToU8(JSON.stringify(
        {
          meta: { app: 'SpriteForge', tool: 'slicer', size: out, marginPct, count: ordered.length },
          items: ordered.map((b, i) => ({ name: `${base}_${String(i + 1).padStart(3, '0')}.png`, source: b })),
        },
        null,
        2,
      ))
      const zipped = zipSync(files, { level: 0 })
      const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}_${out}px.zip`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast(`${ordered.length} ITENS EXPORTADOS ✓`)
    } catch (err) {
      console.error(err)
      toast('ERRO AO EXPORTAR', true)
    } finally {
      exportBtn.disabled = false
      exportBtn.textContent = 'EXPORTAR ZIP_'
    }
  }

  // ── teclado ─────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.code === 'Delete' && selected >= 0) {
      boxes.splice(selected, 1)
      selected = -1
      updateInfo()
      render()
    }
  }
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', resizeCanvas)

  // ── inicialização / teardown ────────────────────────────
  resizeCanvas()
  updateInfo()

  return () => {
    alive = false
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', resizeCanvas)
  }
}
