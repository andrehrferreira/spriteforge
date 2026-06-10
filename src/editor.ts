/**
 * Editor de uma animação: grade de frames com seleção do loop, preview
 * animado com chroma key em tempo real (GPU) e crossfade da emenda.
 * As alterações são gravadas direto no objeto da animação do projeto.
 */

import { ChromaProcessor } from './chroma'
import type { ExtractedFrame } from './extract'
import { createLoop, type Loop } from './loop'
import { saveProject, selectedBitmaps } from './state'
import { toast } from './toast'
import type { AnimationData } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T

export function initEditor(anim: AnimationData, frames: ExtractedFrame[]): () => void {
  const proc = new ChromaProcessor()
  const settings = anim.chroma

  // ── estado ──────────────────────────────────────────────
  let alive = true
  let selection: number[] = []
  let playing = true
  let playbackFps = anim.fps
  let loopPos = 0
  let zoom: 'fit' | number = 'fit'
  let pickMode = false
  let crossfade = anim.crossfade
  let currentIdx = 0
  let lastClicked = 0
  let loop: Loop = createLoop(proc, [], settings, 0)
  // retângulo do último draw do preview (para mapear cliques do conta-gotas)
  let drawRect = { x: 0, y: 0, scale: 1 }

  function rebuildLoop(): void {
    loop = createLoop(proc, selectedBitmaps(anim, frames), settings, crossfade)
  }

  // ── nome da animação ────────────────────────────────────
  const nameInput = $<HTMLInputElement>('#anim-name')
  nameInput.value = anim.name
  nameInput.oninput = () => { anim.name = nameInput.value.trim() || anim.name }

  // ── preview ─────────────────────────────────────────────
  const previewWrap = $('#preview-wrap')
  previewWrap.className = 'preview-wrap checker'
  const pcv = $<HTMLCanvasElement>('#preview-canvas')
  const pctx = pcv.getContext('2d')!

  function resizePreview(): void {
    const r = previewWrap.getBoundingClientRect()
    pcv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
    pcv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
    renderPreview()
  }

  function renderPreview(): void {
    pctx.clearRect(0, 0, pcv.width, pcv.height)
    if (!selection.length) {
      pctx.font = `${14 * devicePixelRatio}px Silkscreen, monospace`
      pctx.fillStyle = '#75896d'
      pctx.textAlign = 'center'
      pctx.fillText('NENHUM FRAME SELECIONADO', pcv.width / 2, pcv.height / 2)
      updateIndicator()
      return
    }
    loopPos = Math.min(loopPos, loop.length - 1)
    const fi = selection[loop.k + loopPos]
    const out = loop.render(loopPos)

    const s = zoom === 'fit'
      ? Math.min(pcv.width / out.width, pcv.height / out.height) * 0.94
      : zoom * devicePixelRatio
    const dw = out.width * s
    const dh = out.height * s
    const dx = (pcv.width - dw) / 2
    const dy = (pcv.height - dh) / 2
    pctx.imageSmoothingEnabled = s < 1
    pctx.drawImage(out, dx, dy, dw, dh)
    drawRect = { x: dx, y: dy, scale: s }

    if (currentIdx !== fi) {
      cells[currentIdx]?.classList.remove('playing')
      cells[fi]?.classList.add('playing')
      currentIdx = fi
    }
    updateIndicator()
  }

  function updateIndicator(): void {
    $('#frame-indicator').textContent = selection.length
      ? `· #${String(currentIdx).padStart(3, '0')} · ${loopPos + 1}/${loop.length} · t=${frames[currentIdx].time.toFixed(2)}s`
      : '· vazio'
  }

  // loop de playback
  let acc = 0
  let lastT = performance.now()
  function tick(now: number): void {
    if (!alive) return
    const dt = Math.min((now - lastT) / 1000, 0.25)
    lastT = now
    if (playing && selection.length && loop.length > 1) {
      acc += dt
      const spf = 1 / playbackFps
      let advanced = false
      while (acc >= spf) {
        acc -= spf
        loopPos = (loopPos + 1) % loop.length
        advanced = true
      }
      if (advanced) renderPreview()
    }
    requestAnimationFrame(tick)
  }

  function setPlaying(p: boolean): void {
    playing = p
    $('#btn-play').innerHTML = p ? '&#9208;' : '&#9654;'
    acc = 0
  }

  $('#btn-play').onclick = () => setPlaying(!playing)
  $('#btn-prev').onclick = () => step(-1)
  $('#btn-next').onclick = () => step(1)

  function step(dir: number): void {
    if (!selection.length) return
    setPlaying(false)
    loopPos = (loopPos + dir + loop.length) % loop.length
    renderPreview()
  }

  function setVal(rangeSel: string, valSel: string, v: number): HTMLInputElement {
    const r = $<HTMLInputElement>(rangeSel)
    r.value = String(v)
    $(valSel).textContent = String(v)
    return r
  }

  const fpsRange = setVal('#fps-range', '#fps-val', playbackFps)
  fpsRange.oninput = () => {
    playbackFps = Number(fpsRange.value)
    anim.fps = playbackFps
    $('#fps-val').textContent = fpsRange.value
  }

  const fadeRange = setVal('#fade-range', '#fade-val', crossfade)
  fadeRange.oninput = () => {
    crossfade = Number(fadeRange.value)
    anim.crossfade = crossfade
    $('#fade-val').textContent = fadeRange.value
    loopPos = 0
    rebuildLoop()
    updateFadeMarkers()
    renderPreview()
  }

  /** marca em âmbar os frames do início que serão consumidos pela fusão */
  function updateFadeMarkers(): void {
    frames.forEach((_, i) => cells[i].classList.remove('fade'))
    for (let i = 0; i < loop.k; i++) cells[selection[i]]?.classList.add('fade')
  }

  document.querySelectorAll<HTMLButtonElement>('.zoom-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.zoom === 'fit')
    btn.onclick = () => {
      document.querySelectorAll('.zoom-chip').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      zoom = btn.dataset.zoom === 'fit' ? 'fit' : Number(btn.dataset.zoom)
      renderPreview()
    }
  })

  document.querySelectorAll<HTMLButtonElement>('.bg-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.bg === 'checker')
    btn.onclick = () => {
      document.querySelectorAll('.bg-chip').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      previewWrap.className = 'preview-wrap ' + (btn.dataset.bg === 'checker' ? 'checker' : 'bg-' + btn.dataset.bg)
    }
  })

  // ── chroma key ──────────────────────────────────────────
  const swatch = $('#key-swatch')
  const colorInput = $<HTMLInputElement>('#key-color-input')

  function syncSwatch(): void {
    const [r, g, b] = settings.key
    swatch.style.background = `rgb(${r},${g},${b})`
    colorInput.value = '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
  }

  function applyChroma(): void {
    renderPreview()
    scheduleRegen()
  }

  swatch.onclick = () => colorInput.click()
  colorInput.oninput = () => {
    const v = colorInput.value
    settings.key = [
      parseInt(v.slice(1, 3), 16),
      parseInt(v.slice(3, 5), 16),
      parseInt(v.slice(5, 7), 16),
    ]
    syncSwatch()
    applyChroma()
  }

  $('#btn-autokey').onclick = () => {
    settings.key = autoKey(frames[selection[0] ?? 0].full)
    syncSwatch()
    applyChroma()
    toast('COR DETECTADA PELOS CANTOS')
  }

  const eyedropBtn = $('#btn-eyedrop')
  eyedropBtn.classList.remove('armed')
  eyedropBtn.onclick = () => {
    pickMode = !pickMode
    eyedropBtn.classList.toggle('armed', pickMode)
    previewWrap.classList.toggle('picking', pickMode)
    if (pickMode) setPlaying(false)
  }

  pcv.onclick = (e) => {
    if (!pickMode || !selection.length) return
    const rect = pcv.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (pcv.width / rect.width)
    const cy = (e.clientY - rect.top) * (pcv.height / rect.height)
    const bmp = frames[currentIdx].full
    const fx = Math.floor((cx - drawRect.x) / drawRect.scale)
    const fy = Math.floor((cy - drawRect.y) / drawRect.scale)
    if (fx < 0 || fy < 0 || fx >= bmp.width || fy >= bmp.height) return
    settings.key = samplePixel(bmp, fx, fy)
    pickMode = false
    eyedropBtn.classList.remove('armed')
    previewWrap.classList.remove('picking')
    syncSwatch()
    applyChroma()
    toast('COR CAPTURADA')
  }

  const chromaToggle = $<HTMLInputElement>('#chroma-enabled')
  chromaToggle.checked = settings.enabled
  chromaToggle.onchange = () => {
    settings.enabled = chromaToggle.checked
    applyChroma()
  }

  bindSlider('#sim-range', '#sim-val', settings.similarity, (v) => { settings.similarity = v })
  bindSlider('#smooth-range', '#smooth-val', settings.smoothness, (v) => { settings.smoothness = v })
  bindSlider('#spill-range', '#spill-val', settings.spill, (v) => { settings.spill = v })
  bindSlider('#halo-range', '#halo-val', settings.halo, (v) => { settings.halo = v })

  function bindSlider(rangeSel: string, valSel: string, initial: number, apply: (v: number) => void): void {
    const el = setVal(rangeSel, valSel, Math.round(initial * 1000))
    el.oninput = () => {
      $(valSel).textContent = el.value
      apply(Number(el.value) / 1000)
      applyChroma()
    }
  }

  // ── grade de frames ─────────────────────────────────────
  const grid = $('#frames-grid')
  grid.innerHTML = ''
  const cells: HTMLElement[] = []
  const cellCtx: CanvasRenderingContext2D[] = []

  frames.forEach((f, i) => {
    const el = document.createElement('div')
    el.className = 'frame-cell'
    el.dataset.i = String(i)
    const cv = document.createElement('canvas')
    cv.width = f.thumb.width
    cv.height = f.thumb.height
    const idx = document.createElement('span')
    idx.className = 'fc-idx'
    idx.textContent = String(i).padStart(3, '0')
    el.append(cv, idx)
    grid.append(el)
    cells.push(el)
    cellCtx.push(cv.getContext('2d')!)
  })

  grid.onclick = (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.frame-cell')
    if (!cell) return
    const i = Number(cell.dataset.i)
    if (e.shiftKey) {
      const stateOn = anim.selected[lastClicked]
      const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)]
      for (let k = a; k <= b; k++) anim.selected[k] = stateOn
    } else {
      anim.selected[i] = !anim.selected[i]
      lastClicked = i
    }
    onSelectionChange()
  }

  $('#btn-all').onclick = () => { anim.selected = anim.selected.map(() => true); onSelectionChange() }
  $('#btn-none').onclick = () => { anim.selected = anim.selected.map(() => false); onSelectionChange() }
  $('#btn-invert').onclick = () => { anim.selected = anim.selected.map((s) => !s); onSelectionChange() }

  // ── detecção automática do loop perfeito ────────────────
  const autoloopBtn = $<HTMLButtonElement>('#btn-autoloop')
  autoloopBtn.disabled = false
  autoloopBtn.textContent = 'LOOPING_'
  autoloopBtn.onclick = () => void autoLoop()

  /**
   * Encontra o par (i, j) em que o frame j mais se parece com o frame i —
   * tanto na imagem quanto na continuação do movimento (i+1 vs j+1).
   * O loop vira i..j-1: ao dar a volta, j-1 → i imita a transição natural
   * j-1 → j. Os frames fora do intervalo são desligados.
   */
  async function autoLoop(): Promise<void> {
    let first = anim.selected.indexOf(true)
    let last = anim.selected.lastIndexOf(true)
    if (first < 0) { first = 0; last = frames.length - 1 }
    const n = last - first + 1
    if (n < 12) {
      toast('FRAMES INSUFICIENTES PARA DETECTAR O LOOP', true)
      return
    }
    autoloopBtn.disabled = true
    setPlaying(false)
    try {
      // 1) descritor compacto de cada frame já processado pelo chroma
      const DW = 20
      const DH = 20
      const dcv = document.createElement('canvas')
      dcv.width = DW
      dcv.height = DH
      const dctx = dcv.getContext('2d', { willReadFrequently: true })!
      const desc: Float32Array[] = []
      for (let k = 0; k < n; k++) {
        const out = proc.render(frames[first + k].thumb, settings)
        dctx.clearRect(0, 0, DW, DH)
        dctx.drawImage(out, 0, 0, DW, DH)
        const d = dctx.getImageData(0, 0, DW, DH).data
        const v = new Float32Array(DW * DH * 4)
        for (let i = 0, p = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255
          v[p++] = d[i] * a
          v[p++] = d[i + 1] * a
          v[p++] = d[i + 2] * a
          v[p++] = d[i + 3]
        }
        desc.push(v)
        if (k % 24 === 23) {
          autoloopBtn.textContent = `ANALISANDO ${k + 1}/${n}`
          await new Promise(requestAnimationFrame)
          if (!alive) return
        }
      }

      const dist = (a: Float32Array, b: Float32Array): number => {
        let s = 0
        for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
        return s / a.length / 255
      }

      // 2) varre os pares candidatos
      const minLen = Math.max(6, Math.floor(n * 0.3))
      const cands: { i: number; j: number; d: number }[] = []
      for (let i = 0; i + minLen <= n - 1; i++) {
        for (let j = i + minLen; j < n; j++) {
          let d = dist(desc[i], desc[j])
          d = j + 1 < n ? d + dist(desc[i + 1], desc[j + 1]) : d * 2
          cands.push({ i, j, d })
        }
        if (i % 24 === 23) {
          autoloopBtn.textContent = `COMPARANDO ${Math.round((i / n) * 100)}%`
          await new Promise(requestAnimationFrame)
          if (!alive) return
        }
      }

      // 3) entre os cortes quase tão bons quanto o melhor, fica com o loop mais longo
      cands.sort((a, b) => a.d - b.d)
      const tol = cands[0].d * 1.5 + 0.008
      let pick = cands[0]
      for (const c of cands) {
        if (c.d > tol) break
        if (c.j - c.i > pick.j - pick.i) pick = c
      }

      const a0 = first + pick.i
      const b0 = first + pick.j - 1
      anim.selected = anim.selected.map((_, k) => k >= a0 && k <= b0)
      onSelectionChange()
      const cut = n - (pick.j - pick.i)
      const quality = (pick.d / 2) * 100
      toast(
        `LOOP FECHADO: #${String(a0).padStart(3, '0')}–#${String(b0).padStart(3, '0')} · ${cut} FRAMES IGNORADOS · Δ${quality.toFixed(1)}%` +
        (quality > 6 ? ' — EMENDA AINDA DIFERE, COMBINE COM CROSSFADE' : ''),
      )
    } finally {
      autoloopBtn.disabled = false
      autoloopBtn.textContent = 'LOOPING_'
    }
  }

  function onSelectionChange(): void {
    selection = anim.selected.flatMap((s, i) => (s ? [i] : []))
    anim.selected.forEach((s, i) => {
      cells[i].classList.toggle('sel', s)
      cells[i].classList.toggle('off', !s)
    })
    loopPos = 0
    rebuildLoop()
    $('#sel-count').textContent = `· ${selection.length}/${frames.length} no loop`
    updateFadeMarkers()
    renderPreview()
  }

  // regeneração das miniaturas (debounce + chunks para não travar a UI)
  let regenToken = 0
  let regenTimer = 0

  function scheduleRegen(): void {
    clearTimeout(regenTimer)
    regenTimer = window.setTimeout(() => void regenThumbs(), 140)
  }

  async function regenThumbs(): Promise<void> {
    const token = ++regenToken
    for (let i = 0; i < frames.length; i++) {
      if (token !== regenToken || !alive) return
      const out = proc.render(frames[i].thumb, settings)
      const ctx = cellCtx[i]
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.drawImage(out, 0, 0)
      if (i % 24 === 23) await new Promise(requestAnimationFrame)
    }
  }

  // ── teclado ─────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.code === 'Space') {
      e.preventDefault()
      setPlaying(!playing)
    } else if (e.code === 'ArrowLeft') {
      step(-1)
    } else if (e.code === 'ArrowRight') {
      step(1)
    }
  }
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', resizePreview)

  // ── inicialização ───────────────────────────────────────
  setPlaying(true)
  syncSwatch()
  onSelectionChange()
  void regenThumbs()
  resizePreview()
  requestAnimationFrame((t) => {
    lastT = t
    requestAnimationFrame(tick)
  })

  // ── teardown ────────────────────────────────────────────
  return () => {
    alive = false
    regenToken++
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', resizePreview)
    // atualiza a miniatura do card com o chroma aplicado
    try {
      const first = selection.length ? selection[0] : 0
      const out = proc.render(frames[first].thumb, settings)
      const cv = document.createElement('canvas')
      cv.width = out.width
      cv.height = out.height
      cv.getContext('2d')!.drawImage(out, 0, 0)
      cv.toBlob((b) => {
        if (b) {
          anim.thumb = b
          void saveProject()
        }
      }, 'image/png')
    } catch { /* thumb é cosmética */ }
  }
}

/** Lê um pixel do frame original (sem chroma aplicado). */
function samplePixel(bmp: ImageBitmap, x: number, y: number): [number, number, number] {
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, x, y, 1, 1, 0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

/**
 * Detecta a cor-chave automaticamente: amostra os 4 cantos do frame e
 * usa a média do par de cantos mais parecido entre si (evita que o
 * personagem cobrindo um canto contamine o resultado).
 */
export function autoKey(bmp: ImageBitmap): [number, number, number] {
  const S = 8
  const cv = document.createElement('canvas')
  cv.width = bmp.width
  cv.height = bmp.height
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)

  const corners: [number, number][] = [
    [0, 0],
    [bmp.width - S, 0],
    [0, bmp.height - S],
    [bmp.width - S, bmp.height - S],
  ]
  const avgs = corners.map(([x, y]) => {
    const d = ctx.getImageData(Math.max(0, x), Math.max(0, y), S, S).data
    let r = 0, g = 0, b = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]
    }
    return [r / n, g / n, b / n]
  })

  let best: [number, number] = [0, 1]
  let bestDist = Infinity
  for (let i = 0; i < avgs.length; i++) {
    for (let j = i + 1; j < avgs.length; j++) {
      const dist = Math.hypot(avgs[i][0] - avgs[j][0], avgs[i][1] - avgs[j][1], avgs[i][2] - avgs[j][2])
      if (dist < bestDist) {
        bestDist = dist
        best = [i, j]
      }
    }
  }
  const [a, b] = best
  return [
    Math.round((avgs[a][0] + avgs[b][0]) / 2),
    Math.round((avgs[a][1] + avgs[b][1]) / 2),
    Math.round((avgs[a][2] + avgs[b][2]) / 2),
  ]
}
