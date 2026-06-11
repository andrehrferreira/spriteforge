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
    // anti-deriva só vale para seleção contígua (é onde a medição faz sentido)
    const contiguous =
      selection.length > 0 && selection[selection.length - 1] - selection[0] === selection.length - 1
    loop = createLoop(
      proc,
      selectedBitmaps(anim, frames),
      settings,
      crossfade,
      contiguous ? anim.drift ?? null : null,
    )
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
    resizeCurve()
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
    drawCurve()
  }

  function updateIndicator(): void {
    $('#frame-indicator').textContent = selection.length
      ? `· #${String(currentIdx).padStart(3, '0')} · ${loopPos + 1}/${loop.length} · t=${frames[currentIdx].time.toFixed(2)}s`
      : '· vazio'
  }

  /** duração do frame p do loop, respeitando a curva de fps */
  function frameDur(p: number): number {
    const oi = selection[loop.k + p]
    return 1 / (playbackFps * (anim.speed[oi] ?? 1))
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
      let spf = frameDur(loopPos)
      let advanced = false
      while (acc >= spf) {
        acc -= spf
        loopPos = (loopPos + 1) % loop.length
        advanced = true
        spf = frameDur(loopPos)
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
    bakeCurve()
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

  // ── curva de fps (pontos de controle, estilo Blender) ──
  const MULT_MIN = 0.25
  const MULT_MAX = 3
  const PAD = 10 // margem interna do gráfico, em px CSS
  const curveCv = $<HTMLCanvasElement>('#curve-canvas')
  const curveCtx = curveCv.getContext('2d')!
  let dragIdx = -1

  function resizeCurve(): void {
    const r = curveCv.getBoundingClientRect()
    if (!r.width) return
    curveCv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
    curveCv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
    drawCurve()
  }

  const padX = (): number => PAD * devicePixelRatio
  const plotW = (): number => curveCv.width - padX() * 2
  const plotH = (): number => curveCv.height - padX() * 2
  const xOf = (t: number): number => padX() + t * plotW()
  const yOf = (v: number): number =>
    curveCv.height - padX() - ((v - MULT_MIN) / (MULT_MAX - MULT_MIN)) * plotH()

  /** interpolação cúbica monotônica (Fritsch–Carlson) — suave e sem overshoot */
  function curveSampler(pts: { t: number; v: number }[]): (x: number) => number {
    const n = pts.length
    if (n === 1) return () => pts[0].v
    const dt: number[] = []
    const m: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const h = Math.max(1e-6, pts[i + 1].t - pts[i].t)
      dt.push(h)
      m.push((pts[i + 1].v - pts[i].v) / h)
    }
    const tang: number[] = [m[0]]
    for (let i = 1; i < n - 1; i++) tang.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
    tang.push(m[n - 2])
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) {
        tang[i] = 0
        tang[i + 1] = 0
      } else {
        const a = tang[i] / m[i]
        const b = tang[i + 1] / m[i]
        const s = a * a + b * b
        if (s > 9) {
          const f = 3 / Math.sqrt(s)
          tang[i] = f * a * m[i]
          tang[i + 1] = f * b * m[i]
        }
      }
    }
    return (x: number): number => {
      if (x <= pts[0].t) return pts[0].v
      if (x >= pts[n - 1].t) return pts[n - 1].v
      let i = 0
      while (x > pts[i + 1].t) i++
      const s = (x - pts[i].t) / dt[i]
      const h00 = (1 + 2 * s) * (1 - s) * (1 - s)
      const h10 = s * (1 - s) * (1 - s)
      const h01 = s * s * (3 - 2 * s)
      const h11 = s * s * (s - 1)
      return h00 * pts[i].v + h10 * dt[i] * tang[i] + h01 * pts[i + 1].v + h11 * dt[i] * tang[i + 1]
    }
  }

  /** amostra a curva em cada frame do loop e grava em anim.speed */
  function bakeCurve(): void {
    if (!selection.length) return
    const sample = curveSampler(anim.curve)
    const len = loop.length
    for (let p = 0; p < len; p++) {
      const t = len > 1 ? p / (len - 1) : 0
      const v = Math.min(MULT_MAX, Math.max(MULT_MIN, sample(t)))
      anim.speed[selection[loop.k + p]] = Math.round(v * 100) / 100
    }
  }

  function drawCurve(): void {
    const w = curveCv.width
    const h = curveCv.height
    curveCtx.clearRect(0, 0, w, h)
    if (!w || !h) return

    // linha de referência do 1×
    curveCtx.strokeStyle = 'rgba(117, 137, 109, 0.45)'
    curveCtx.setLineDash([4, 4])
    curveCtx.beginPath()
    curveCtx.moveTo(padX(), yOf(1))
    curveCtx.lineTo(w - padX(), yOf(1))
    curveCtx.stroke()
    curveCtx.setLineDash([])

    // playhead
    if (selection.length && loop.length > 1) {
      const t = loopPos / (loop.length - 1)
      curveCtx.strokeStyle = 'rgba(255, 79, 216, 0.55)'
      curveCtx.beginPath()
      curveCtx.moveTo(xOf(t), padX() / 2)
      curveCtx.lineTo(xOf(t), h - padX() / 2)
      curveCtx.stroke()
    }

    // curva
    const sample = curveSampler(anim.curve)
    curveCtx.strokeStyle = '#52ff7a'
    curveCtx.lineWidth = Math.max(1, 1.5 * devicePixelRatio)
    curveCtx.beginPath()
    const STEPS = 96
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS
      const v = Math.min(MULT_MAX, Math.max(MULT_MIN, sample(t)))
      if (s === 0) curveCtx.moveTo(xOf(t), yOf(v))
      else curveCtx.lineTo(xOf(t), yOf(v))
    }
    curveCtx.stroke()
    curveCtx.lineWidth = 1

    // pontos de controle
    const ps = 5 * devicePixelRatio
    anim.curve.forEach((p, i) => {
      curveCtx.fillStyle = i === dragIdx ? '#ff4fd8' : '#d6e8d0'
      curveCtx.fillRect(xOf(p.t) - ps / 2, yOf(p.v) - ps / 2, ps, ps)
      curveCtx.strokeStyle = '#06140a'
      curveCtx.strokeRect(xOf(p.t) - ps / 2, yOf(p.v) - ps / 2, ps, ps)
    })

    // valor do ponto sendo arrastado
    if (dragIdx >= 0) {
      const p = anim.curve[dragIdx]
      curveCtx.fillStyle = '#ff4fd8'
      curveCtx.font = `${10 * devicePixelRatio}px "IBM Plex Mono", monospace`
      curveCtx.textAlign = xOf(p.t) > w / 2 ? 'right' : 'left'
      const tx = xOf(p.t) + (xOf(p.t) > w / 2 ? -8 : 8) * devicePixelRatio
      curveCtx.fillText(`${p.v.toFixed(2)}×`, tx, yOf(p.v) - 6 * devicePixelRatio)
    }
  }

  function curveHit(e: PointerEvent | MouseEvent): number {
    const r = curveCv.getBoundingClientRect()
    const cx = (e.clientX - r.left) * devicePixelRatio
    const cy = (e.clientY - r.top) * devicePixelRatio
    const radius = 9 * devicePixelRatio
    let best = -1
    let bestD = radius
    anim.curve.forEach((p, i) => {
      const d = Math.hypot(xOf(p.t) - cx, yOf(p.v) - cy)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  function curveCoords(e: PointerEvent): { t: number; v: number } {
    const r = curveCv.getBoundingClientRect()
    const cx = (e.clientX - r.left) * devicePixelRatio
    const cy = (e.clientY - r.top) * devicePixelRatio
    const t = Math.min(1, Math.max(0, (cx - padX()) / Math.max(1, plotW())))
    let v = MULT_MIN + (1 - (cy - padX()) / Math.max(1, plotH())) * (MULT_MAX - MULT_MIN)
    v = Math.min(MULT_MAX, Math.max(MULT_MIN, v))
    if (Math.abs(v - 1) < 0.06) v = 1 // imã no 1×
    return { t, v }
  }

  function curveChanged(): void {
    bakeCurve()
    drawCurve()
  }

  curveCv.onpointerdown = (e) => {
    e.preventDefault()
    const hit = curveHit(e)
    if (hit >= 0) {
      dragIdx = hit
    } else {
      // novo ponto na posição clicada, mantendo a ordem por t
      const { t, v } = curveCoords(e)
      let at = anim.curve.findIndex((p) => p.t > t)
      if (at < 0) at = anim.curve.length - 1
      if (at === 0) at = 1
      anim.curve.splice(at, 0, { t, v: Math.round(v * 100) / 100 })
      dragIdx = at
    }
    curveCv.setPointerCapture(e.pointerId)
    curveChanged()
  }

  curveCv.onpointermove = (e) => {
    if (dragIdx < 0) return
    const { t, v } = curveCoords(e)
    const p = anim.curve[dragIdx]
    p.v = Math.round(v * 100) / 100
    // extremos ficam presos em t=0 e t=1; os demais entre os vizinhos
    if (dragIdx > 0 && dragIdx < anim.curve.length - 1) {
      const lo = anim.curve[dragIdx - 1].t + 0.01
      const hi = anim.curve[dragIdx + 1].t - 0.01
      p.t = Math.min(hi, Math.max(lo, t))
    }
    curveChanged()
  }

  curveCv.onpointerup = () => {
    dragIdx = -1
    drawCurve()
  }

  function removeCurvePoint(e: MouseEvent): void {
    const hit = curveHit(e)
    if (hit > 0 && hit < anim.curve.length - 1) {
      anim.curve.splice(hit, 1)
      dragIdx = -1
      curveChanged()
    }
  }
  curveCv.ondblclick = removeCurvePoint
  curveCv.oncontextmenu = (e) => {
    e.preventDefault()
    removeCurvePoint(e)
  }

  $('#curve-reset').onclick = () => {
    anim.curve = [{ t: 0, v: 1 }, { t: 1, v: 1 }]
    curveChanged()
  }
  document.querySelectorAll<HTMLButtonElement>('[data-curve]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.curve === 'in') anim.curve = [{ t: 0, v: 0.5 }, { t: 1, v: 2 }]
      else if (btn.dataset.curve === 'out') anim.curve = [{ t: 0, v: 2 }, { t: 1, v: 0.5 }]
      else anim.curve = [{ t: 0, v: 0.5 }, { t: 0.5, v: 2 }, { t: 1, v: 0.5 }]
      curveChanged()
    }
  })

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
    anim.drift = null // a medição da deriva era do corte automático
    onSelectionChange()
  }

  $('#btn-all').onclick = () => { anim.selected = anim.selected.map(() => true); anim.drift = null; onSelectionChange() }
  $('#btn-none').onclick = () => { anim.selected = anim.selected.map(() => false); anim.drift = null; onSelectionChange() }
  $('#btn-invert').onclick = () => { anim.selected = anim.selected.map((s) => !s); anim.drift = null; onSelectionChange() }

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
      // 1) centroide + descritor compacto de cada frame processado.
      //    O descritor é centralizado pelo centroide: a comparação fica
      //    imune à deriva de posição do personagem ao longo do vídeo.
      const DW = 20
      const DH = 20
      const dcv = document.createElement('canvas')
      dcv.width = DW
      dcv.height = DH
      const dctx = dcv.getContext('2d', { willReadFrequently: true })!
      const tw = frames[first].thumb.width
      const th = frames[first].thumb.height
      const tcv = document.createElement('canvas')
      tcv.width = tw
      tcv.height = th
      const tctx = tcv.getContext('2d', { willReadFrequently: true })!
      const desc: Float32Array[] = []
      const cents: { x: number; y: number; m: number }[] = []
      for (let k = 0; k < n; k++) {
        const out = proc.render(frames[first + k].thumb, settings)
        tctx.clearRect(0, 0, tw, th)
        tctx.drawImage(out, 0, 0)
        const td = tctx.getImageData(0, 0, tw, th).data
        let sm = 0, sx = 0, sy = 0
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const a = td[(y * tw + x) * 4 + 3]
            if (a > 16) {
              sm += a
              sx += a * x
              sy += a * y
            }
          }
        }
        const c = sm ? { x: sx / sm, y: sy / sm, m: sm } : { x: tw / 2, y: th / 2, m: 0 }
        cents.push(c)

        dctx.clearRect(0, 0, DW, DH)
        dctx.drawImage(tcv, (tw / 2 - c.x) * (DW / tw), (th / 2 - c.y) * (DH / th), DW, DH)
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

      // 3) refina os melhores candidatos em 48×48: o descritor pequeno
      //    confunde poses espelhadas (perna esquerda vs direita à frente);
      //    em alta resolução o sombreamento separa as duas fases da passada
      cands.sort((a, b) => a.d - b.d)
      autoloopBtn.textContent = 'REFINANDO...'
      await new Promise(requestAnimationFrame)
      const RW = 48
      const RH = 48
      const rcv = document.createElement('canvas')
      rcv.width = RW
      rcv.height = RH
      const rctx = rcv.getContext('2d', { willReadFrequently: true })!
      const fine = new Map<number, Float32Array>()
      const fineDesc = (q: number): Float32Array => {
        let v = fine.get(q)
        if (v) return v
        const out = proc.render(frames[first + q].thumb, settings)
        const c = cents[q]
        rctx.clearRect(0, 0, RW, RH)
        rctx.drawImage(out, (tw / 2 - c.x) * (RW / tw), (th / 2 - c.y) * (RH / th), RW, RH)
        const d = rctx.getImageData(0, 0, RW, RH).data
        v = new Float32Array(RW * RH * 4)
        for (let i = 0, p = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255
          v[p++] = d[i] * a
          v[p++] = d[i + 1] * a
          v[p++] = d[i + 2] * a
          v[p++] = d[i + 3]
        }
        fine.set(q, v)
        return v
      }
      const refined: { i: number; j: number; d: number }[] = []
      const TOP = Math.min(64, cands.length)
      for (let c = 0; c < TOP; c++) {
        const { i, j } = cands[c]
        let d = dist(fineDesc(i), fineDesc(j))
        d = j + 1 < n ? d + dist(fineDesc(i + 1), fineDesc(j + 1)) : d * 2
        refined.push({ i, j, d })
        if (c % 16 === 15) {
          await new Promise(requestAnimationFrame)
          if (!alive) return
        }
      }
      refined.sort((a, b) => a.d - b.d)
      const tol = refined[0].d * 1.25 + 0.004
      let pick = refined[0]
      for (const c of refined) {
        if (c.d > tol) break
        if (c.j - c.i > pick.j - pick.i) pick = c
      }

      // 4) se mesmo o melhor corte ainda difere (vídeo de IA nunca repete o
      //    ciclo exatamente), liga o crossfade automaticamente para fundir
      //    a emenda
      const quality = (pick.d / 2) * 100
      let autoFade = false
      if (crossfade === 0 && quality > 3) {
        crossfade = 3
        anim.crossfade = 3
        fadeRange.value = '3'
        $('#fade-val').textContent = '3'
        autoFade = true
      }

      const a0 = first + pick.i
      // com crossfade ativo, estende a seleção em K frames além do ponto de
      // corte: a fusão consome os K primeiros e os pares tail/head ficam
      // alinhados no período certo (sem fantasma duplo na emenda)
      const extend = Math.min(crossfade, last - (first + pick.j - 1))
      const b0 = first + pick.j - 1 + extend
      anim.selected = anim.selected.map((_, k) => k >= a0 && k <= b0)

      // 4) mede a deriva de posição entre os frames gêmeos do corte —
      //    a composição do loop distribui a correção inversa pelos frames
      let driftMag = 0
      anim.drift = null
      {
        let dx = 0, dy = 0, cnt = 0
        for (let t = 0; t < 3; t++) {
          const ca = cents[pick.i + t]
          const cb = cents[pick.j + t]
          if (!ca || !cb || !ca.m || !cb.m) break
          dx += cb.x - ca.x
          dy += cb.y - ca.y
          cnt++
        }
        if (cnt) {
          const up = frames[first].full.width / tw
          const fx = ((dx / cnt) * up)
          const fy = ((dy / cnt) * up)
          driftMag = Math.hypot(fx, fy)
          if (driftMag >= 0.75) {
            anim.drift = { x: Math.round(fx * 10) / 10, y: Math.round(fy * 10) / 10 }
          }
        }
      }

      onSelectionChange()
      const cut = n - (pick.j - pick.i)
      toast(
        `LOOP FECHADO: #${String(a0).padStart(3, '0')}–#${String(b0).padStart(3, '0')} · ${cut} FRAMES IGNORADOS · Δ${quality.toFixed(1)}%` +
        (anim.drift ? ` · DERIVA DE ${driftMag.toFixed(1)}PX CORRIGIDA` : '') +
        (autoFade ? ' · CROSSFADE 3 ATIVADO' : '') +
        (quality > 6 && !autoFade ? ' — AUMENTE O CROSSFADE PARA FUNDIR A EMENDA' : ''),
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
    bakeCurve()
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
