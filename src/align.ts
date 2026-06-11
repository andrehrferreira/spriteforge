/**
 * Tela de alinhamento: analisa o conteúdo opaco de todas as animações e
 * define a célula comum + pivô compartilhado, com ajuste fino por animação
 * (posição/escala). A geração dos atlas acontece na área SPRITES.
 */

import { ChromaProcessor } from './chroma'
import { createLoop, type Loop } from './loop'
import { ensureFrames, saveProject, selectedBitmaps, state } from './state'
import { toast } from './toast'
import type { AnimationData } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T

interface Bounds { x: number; y: number; w: number; h: number }

export function initAlign(): () => void {
  const project = state.project!
  const cfg = project.alignCfg
  const proc = new ChromaProcessor()

  let alive = true
  let ready = false
  let preparing = false
  const bounds = new Map<string, Bounds | null>()
  const loops = new Map<string, Loop>()
  /** índice original (na extração) de cada posição da seleção, por animação */
  const selIdxs = new Map<string, number[]>()
  let currentId: string | null = project.animations[0]?.id ?? null
  let ghostId: string | null = null
  let playing = true
  let loopPos = 0
  let saveTimer = 0
  let lastVs = 1 // escala de visualização do último render (para o arraste)

  function scheduleSave(): void {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void saveProject(), 600)
  }

  function status(msg: string): void {
    $('#align-status').textContent = msg ? `· ${msg}` : ''
  }

  function current(): AnimationData | null {
    return project.animations.find((a) => a.id === currentId) ?? null
  }

  // ── análise: limites do conteúdo opaco de cada animação ─
  async function computeBounds(anim: AnimationData, bitmaps: ImageBitmap[]): Promise<Bounds | null> {
    if (!bitmaps.length) return null
    const srcW = bitmaps[0].width
    const srcH = bitmaps[0].height
    const scan = Math.min(1, 384 / Math.max(srcW, srcH))
    const sw = Math.max(1, Math.round(srcW * scan))
    const sh = Math.max(1, Math.round(srcH * scan))
    const cv = document.createElement('canvas')
    cv.width = sw
    cv.height = sh
    const ctx = cv.getContext('2d', { willReadFrequently: true })!

    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
    for (let f = 0; f < bitmaps.length; f++) {
      ctx.clearRect(0, 0, sw, sh)
      ctx.drawImage(proc.render(bitmaps[f], anim.chroma), 0, 0, sw, sh)
      const d = ctx.getImageData(0, 0, sw, sh).data
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (d[(y * sw + x) * 4 + 3] > 16) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (f % 8 === 7) await new Promise((r) => setTimeout(r, 0))
      if (!alive) return null
    }
    if (maxX < 0) return null
    // volta para coordenadas do frame original, com 1px de folga
    return {
      x: Math.max(0, Math.floor(minX / scan) - 1),
      y: Math.max(0, Math.floor(minY / scan) - 1),
      w: Math.min(srcW, Math.ceil((maxX - minX + 1) / scan) + 2),
      h: Math.min(srcH, Math.ceil((maxY - minY + 1) / scan) + 2),
    }
  }

  async function prepare(recomputeOnly = false): Promise<void> {
    if (preparing) return
    preparing = true
    const anims = project.animations
    // a tela vai ficando interativa conforme cada animação termina de carregar
    for (let i = 0; i < anims.length; i++) {
      const a = anims[i]
      if (!alive) return
      status(`CARREGANDO ${a.name} (${i + 1}/${anims.length})`)
      try {
        const frames = await ensureFrames(a, (d, t) =>
          status(`EXTRAINDO ${a.name} ${d}/${t} (${i + 1}/${anims.length})`))
        if (!alive) return
        const sel = selectedBitmaps(a, frames)
        const si = a.selected.flatMap((s, idx) => (s ? [idx] : []))
        selIdxs.set(a.id, si)
        const contiguous = si.length > 0 && si[si.length - 1] - si[0] === si.length - 1
        loops.set(a.id, createLoop(proc, sel, a.chroma, a.crossfade, contiguous ? a.drift ?? null : null))
        if (!recomputeOnly || !bounds.has(a.id)) {
          status(`ANALISANDO ${a.name} (${i + 1}/${anims.length})`)
          bounds.set(a.id, await computeBounds(a, sel))
        }
      } catch (err) {
        console.error(err)
        toast(`FALHA AO CARREGAR ${a.name}`, true)
        continue
      }
      if (!alive) return
      ready = true
      if (!currentId || !loops.has(currentId)) currentId = a.id
      buildTabs()
      buildRows()
      updateInfo()
      renderAlign()
    }
    if (!alive) return
    preparing = false
    const empty = anims.filter((a) => loops.has(a.id) && !bounds.get(a.id))
    if (empty.length) toast(`SEM CONTEÚDO VISÍVEL: ${empty.map((a) => a.name).join(', ')}`, true)
    status('')
    updateInfo()
    renderAlign()
  }

  // ── célula comum + pivô ─────────────────────────────────
  function cellDims(): { W: number; H: number; px: number; py: number } {
    let maxW = 0
    let maxH = 0
    for (const a of project.animations) {
      const b = bounds.get(a.id)
      if (!b) continue
      maxW = Math.max(maxW, b.w * a.align.scale)
      maxH = Math.max(maxH, b.h * a.align.scale)
    }
    if (!maxW) { maxW = 32; maxH = 32 }
    const W = Math.ceil(maxW) + cfg.margin * 2
    const H = Math.ceil(maxH) + cfg.margin * 2
    return {
      W, H,
      px: cfg.margin + (W - cfg.margin * 2) * cfg.pivotX,
      py: cfg.margin + (H - cfg.margin * 2) * cfg.pivotY,
    }
  }

  /** ponto de ancoragem da animação no frame de origem (pivô relativo ao bbox + ajuste) */
  function anchor(a: AnimationData, b: Bounds): { ax: number; ay: number } {
    return {
      ax: b.x + b.w * cfg.pivotX + a.align.dx,
      ay: b.y + b.h * cfg.pivotY + a.align.dy,
    }
  }

  // ── preview ─────────────────────────────────────────────
  const wrap = $('#align-wrap')
  const cv = $<HTMLCanvasElement>('#align-canvas')
  const ctx = cv.getContext('2d')!

  function resizeCanvas(): void {
    const r = wrap.getBoundingClientRect()
    cv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
    cv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
    renderAlign()
  }

  function drawAnim(a: AnimationData, pos: number, alpha: number, cell: ReturnType<typeof cellDims>, ox: number, oy: number, vs: number): void {
    const loop = loops.get(a.id)
    const b = bounds.get(a.id)
    if (!loop || !b) return
    const frame = loop.render(pos % loop.length)
    const s = a.align.scale
    const { ax, ay } = anchor(a, b)
    ctx.globalAlpha = alpha
    ctx.drawImage(
      frame,
      ox + (cell.px - ax * s) * vs,
      oy + (cell.py - ay * s) * vs,
      frame.width * s * vs,
      frame.height * s * vs,
    )
    ctx.globalAlpha = 1
  }

  function renderAlign(): void {
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (!ready || !currentId) {
      ctx.font = `${13 * devicePixelRatio}px Silkscreen, monospace`
      ctx.fillStyle = '#75896d'
      ctx.textAlign = 'center'
      ctx.fillText('PREPARANDO AS ANIMAÇÕES...', cv.width / 2, cv.height / 2)
      return
    }
    const cell = cellDims()
    const vs = Math.min((cv.width * 0.92) / cell.W, (cv.height * 0.92) / cell.H)
    lastVs = vs
    const ox = (cv.width - cell.W * vs) / 2
    const oy = (cv.height - cell.H * vs) / 2

    // conteúdo (recortado pela célula, como sairá no atlas)
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, cell.W * vs, cell.H * vs)
    ctx.clip()
    const ghost = project.animations.find((a) => a.id === ghostId)
    if (ghost && ghost.id !== currentId) drawAnim(ghost, loopPos, 0.35, cell, ox, oy, vs)
    const cur = current()
    if (cur) drawAnim(cur, loopPos, 1, cell, ox, oy, vs)
    ctx.restore()

    // borda da célula
    ctx.strokeStyle = 'rgba(255, 79, 216, 0.75)'
    ctx.lineWidth = 1
    ctx.strokeRect(ox + 0.5, oy + 0.5, cell.W * vs, cell.H * vs)

    // mira do pivô
    const pxv = ox + cell.px * vs
    const pyv = oy + cell.py * vs
    ctx.strokeStyle = 'rgba(82, 255, 122, 0.7)'
    ctx.beginPath()
    ctx.moveTo(pxv - 14, pyv); ctx.lineTo(pxv + 14, pyv)
    ctx.moveTo(pxv, pyv - 14); ctx.lineTo(pxv, pyv + 14)
    ctx.stroke()
  }

  // arraste no preview: move a animação atual (ajusta align.dx/dy)
  let dragRef: { x: number; y: number; dx0: number; dy0: number } | null = null
  cv.onpointerdown = (e) => {
    const cur = current()
    if (!cur || !ready) return
    dragRef = { x: e.clientX, y: e.clientY, dx0: cur.align.dx, dy0: cur.align.dy }
    cv.setPointerCapture(e.pointerId)
    cv.classList.add('dragging')
  }
  cv.onpointermove = (e) => {
    if (!dragRef) return
    const cur = current()
    if (!cur) return
    // converte o delta do mouse (px CSS) para px do frame de origem:
    // o conteúdo segue o cursor, então dx diminui ao arrastar para a direita
    const k = devicePixelRatio / (lastVs * cur.align.scale)
    cur.align.dx = Math.round(dragRef.dx0 - (e.clientX - dragRef.x) * k)
    cur.align.dy = Math.round(dragRef.dy0 - (e.clientY - dragRef.y) * k)
    renderAlign()
  }
  cv.onpointerup = () => {
    if (!dragRef) return
    dragRef = null
    cv.classList.remove('dragging')
    buildRows() // sincroniza os campos X/Y
    updateInfo()
    scheduleSave()
  }

  // playback
  let acc = 0
  let lastT = performance.now()
  function tick(now: number): void {
    if (!alive) return
    const dt = Math.min((now - lastT) / 1000, 0.25)
    lastT = now
    const cur = current()
    const loop = cur ? loops.get(cur.id) : null
    if (ready && playing && cur && loop && loop.length > 1) {
      acc += dt
      const si = selIdxs.get(cur.id)
      const dur = (p: number): number => {
        const m = si ? cur.speed[si[loop.k + (p % loop.length)]] ?? 1 : 1
        return 1 / (cur.fps * m)
      }
      let spf = dur(loopPos)
      let advanced = false
      while (acc >= spf) {
        acc -= spf
        loopPos = (loopPos + 1) % loop.length
        advanced = true
        spf = dur(loopPos)
      }
      if (advanced) renderAlign()
    }
    requestAnimationFrame(tick)
  }

  function setPlaying(p: boolean): void {
    playing = p
    $('#btn-aplay').innerHTML = p ? '&#9208;' : '&#9654;'
    acc = 0
  }

  $('#btn-aplay').onclick = () => setPlaying(!playing)
  $('#btn-aprev').onclick = () => stepAlign(-1)
  $('#btn-anext').onclick = () => stepAlign(1)

  function stepAlign(dir: number): void {
    const cur = current()
    const loop = cur ? loops.get(cur.id) : null
    if (!loop) return
    setPlaying(false)
    loopPos = (loopPos + dir + loop.length) % loop.length
    renderAlign()
  }

  // ── tabs e ghost ────────────────────────────────────────
  function buildTabs(): void {
    const tabs = $('#align-tabs')
    tabs.innerHTML = ''
    for (const a of project.animations) {
      if (!loops.has(a.id)) continue
      const b = document.createElement('button')
      b.className = 'chip' + (a.id === currentId ? ' active' : '')
      b.textContent = a.name.toUpperCase()
      b.onclick = () => {
        currentId = a.id
        loopPos = 0
        buildTabs()
        renderAlign()
      }
      tabs.append(b)
    }
    const ghostSel = $<HTMLSelectElement>('#ghost-select')
    ghostSel.innerHTML = '<option value="">sem ghost</option>' +
      project.animations.filter((a) => loops.has(a.id))
        .map((a) => `<option value="${a.id}"${a.id === ghostId ? ' selected' : ''}>ghost: ${a.name}</option>`).join('')
    ghostSel.onchange = () => {
      ghostId = ghostSel.value || null
      renderAlign()
    }
  }

  // ── linhas de ajuste por animação ───────────────────────
  function buildRows(): void {
    const rows = $('#align-rows')
    rows.innerHTML = ''
    for (const a of project.animations) {
      if (!loops.has(a.id)) continue
      const row = document.createElement('div')
      row.className = 'align-row'
      const name = document.createElement('span')
      name.className = 'ar-name'
      name.textContent = a.name + (bounds.get(a.id) ? '' : ' ⚠')
      name.title = bounds.get(a.id) ? 'clique para ver no preview' : 'sem conteúdo visível após o chroma'
      name.onclick = () => { currentId = a.id; loopPos = 0; buildTabs(); renderAlign() }
      row.append(name)
      row.append(miniInput('X', a.align.dx, 1, (v) => { a.align.dx = v }))
      row.append(miniInput('Y', a.align.dy, 1, (v) => { a.align.dy = v }))
      row.append(miniInput('ESC', a.align.scale, 0.05, (v) => { a.align.scale = Math.max(0.05, v) }))
      rows.append(row)
    }
  }

  function miniInput(label: string, value: number, stepV: number, apply: (v: number) => void): HTMLElement {
    const wrapEl = document.createElement('label')
    wrapEl.className = 'ar-field'
    const span = document.createElement('span')
    span.className = 'ar-label'
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.step = String(stepV)
    input.value = String(value)
    input.className = 'text-input num-mini'
    input.oninput = () => {
      const v = Number(input.value)
      if (!Number.isFinite(v)) return
      apply(v)
      updateInfo()
      renderAlign()
      scheduleSave()
    }
    wrapEl.append(span, input)
    return wrapEl
  }

  // ── pivô / margem / recálculo ───────────────────────────
  const pivotX = $<HTMLInputElement>('#pivot-x')
  const pivotY = $<HTMLInputElement>('#pivot-y')
  const marginInput = $<HTMLInputElement>('#margin-input')
  pivotX.value = String(cfg.pivotX)
  pivotY.value = String(cfg.pivotY)
  marginInput.value = String(cfg.margin)

  pivotX.oninput = () => { cfg.pivotX = clamp01(Number(pivotX.value)); afterCfgChange() }
  pivotY.oninput = () => { cfg.pivotY = clamp01(Number(pivotY.value)); afterCfgChange() }
  marginInput.oninput = () => {
    cfg.margin = Math.max(0, Math.floor(Number(marginInput.value) || 0))
    afterCfgChange()
  }

  document.querySelectorAll<HTMLButtonElement>('.pivot-chip').forEach((btn) => {
    btn.onclick = () => {
      const [x, y] = (btn.dataset.pivot ?? '0.5,1').split(',').map(Number)
      cfg.pivotX = x
      cfg.pivotY = y
      pivotX.value = String(x)
      pivotY.value = String(y)
      afterCfgChange()
    }
  })

  function afterCfgChange(): void {
    updateInfo()
    renderAlign()
    scheduleSave()
  }

  function clamp01(v: number): number {
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5
  }

  $('#btn-rebounds').onclick = () => {
    if (preparing) return
    bounds.clear()
    void prepare()
  }

  function updateInfo(): void {
    if (!ready) return
    const cell = cellDims()
    $('#cell-info').textContent =
      `célula ${cell.W}×${cell.H}px · pivô (${Math.round(cell.px)}, ${Math.round(cell.py)})`
  }

  // ── teclado ─────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.code === 'Space') {
      e.preventDefault()
      setPlaying(!playing)
    } else if (e.code === 'ArrowLeft') {
      stepAlign(-1)
    } else if (e.code === 'ArrowRight') {
      stepAlign(1)
    }
  }
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', resizeCanvas)

  // ── inicialização ───────────────────────────────────────
  setPlaying(true)
  resizeCanvas()
  void prepare()
  requestAnimationFrame((t) => {
    lastT = t
    requestAnimationFrame(tick)
  })

  return () => {
    alive = false
    clearTimeout(saveTimer)
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', resizeCanvas)
  }
}

