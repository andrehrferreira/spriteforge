/**
 * Área SPRITES: etapa pós-alinhamento. Recomputa loops/bounds/célula,
 * analisa as animações e propõe correções não-destrutivas, gera os atlas
 * (1 PNG por animação), persiste as gerações com versão no IndexedDB e
 * permite baixar (ZIP), regerar e excluir versões.
 */

import { ChromaProcessor } from './chroma'
import { deleteSheet, listSheets, putSheet, QuotaError, uid } from './db'
import { computeLayout, encodeCanvas, formatBytes, MAX_SHEET_DIM, uniqueSlug } from './export'
import { createLoop, type Loop } from './loop'
import { animStateHash, ensureFrames, saveProject, selectedBitmaps, state } from './state'
import { toast } from './toast'
import type { AnimationData, SheetAnimMeta, SpriteSheet } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T

interface Bounds { x: number; y: number; w: number; h: number }

interface Item {
  a: AnimationData
  loop: Loop
  selIdx: number[]
  bounds: Bounds | null
}

export function initSprites(): () => void {
  const project = state.project!
  const exp = project.exportCfg
  const proc = new ChromaProcessor()

  let alive = true
  let ready = false
  let preparing = false
  let items: Item[] = []
  let sheets: SpriteSheet[] = []
  let current = 0 // índice em items
  let playing = true
  let loopPos = 0
  let saveTimer = 0

  function scheduleSave(): void {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void saveProject(), 600)
  }

  function status(msg: string): void {
    $('#sp-status').textContent = msg ? `· ${msg}` : ''
  }

  // ── célula e âncora (mesma formulação do alinhamento) ───
  function cellDims(): { W: number; H: number; px: number; py: number } {
    const cfg = project.alignCfg
    let maxW = 0
    let maxH = 0
    for (const it of items) {
      if (!it.bounds) continue
      maxW = Math.max(maxW, it.bounds.w * it.a.align.scale)
      maxH = Math.max(maxH, it.bounds.h * it.a.align.scale)
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

  function anchorOf(a: AnimationData, b: Bounds): { ax: number; ay: number } {
    const cfg = project.alignCfg
    return {
      ax: b.x + b.w * cfg.pivotX + a.align.dx,
      ay: b.y + b.h * cfg.pivotY + a.align.dy,
    }
  }

  // ── análise dos limites do conteúdo (como no alinhamento) ─
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
    return {
      x: Math.max(0, Math.floor(minX / scan) - 1),
      y: Math.max(0, Math.floor(minY / scan) - 1),
      w: Math.min(srcW, Math.ceil((maxX - minX + 1) / scan) + 2),
      h: Math.min(srcH, Math.ceil((maxY - minY + 1) / scan) + 2),
    }
  }

  // ── prepare incremental (padrão do alinhamento) ─────────
  async function prepare(): Promise<void> {
    if (preparing) return
    preparing = true
    items = []
    const anims = project.animations
    for (let i = 0; i < anims.length; i++) {
      const a = anims[i]
      if (!alive) return
      status(`CARREGANDO ${a.name} (${i + 1}/${anims.length})`)
      try {
        const frames = await ensureFrames(a, (d, t) =>
          status(`EXTRAINDO ${a.name} ${d}/${t} (${i + 1}/${anims.length})`))
        if (!alive) return
        const sel = selectedBitmaps(a, frames)
        const selIdx = a.selected.flatMap((s, idx) => (s ? [idx] : []))
        const contiguous = selIdx.length > 0 && selIdx[selIdx.length - 1] - selIdx[0] === selIdx.length - 1
        const loop = createLoop(proc, sel, a.chroma, a.crossfade, contiguous ? a.drift ?? null : null)
        status(`ANALISANDO ${a.name} (${i + 1}/${anims.length})`)
        const bounds = await computeBounds(a, sel)
        items.push({ a, loop, selIdx, bounds })
      } catch (err) {
        console.error(err)
        toast(`FALHA AO CARREGAR ${a.name}`, true)
        continue
      }
      if (!alive) return
      ready = true
      buildTabs()
      updateInfo()
      renderPreview()
    }
    if (!alive) return
    preparing = false
    status('')
    updateInfo()
    renderPreview()
  }

  // ── preview ─────────────────────────────────────────────
  const wrap = $('#sp-wrap')
  const cv = $<HTMLCanvasElement>('#sp-canvas')
  const ctx = cv.getContext('2d')!

  function resizeCanvas(): void {
    const r = wrap.getBoundingClientRect()
    cv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
    cv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
    renderPreview()
  }

  function renderPreview(): void {
    ctx.clearRect(0, 0, cv.width, cv.height)
    const it = items[current]
    if (!ready || !it) {
      ctx.font = `${13 * devicePixelRatio}px Silkscreen, monospace`
      ctx.fillStyle = '#75896d'
      ctx.textAlign = 'center'
      ctx.fillText('PREPARANDO AS ANIMAÇÕES...', cv.width / 2, cv.height / 2)
      return
    }
    const cell = cellDims()
    const vs = Math.min((cv.width * 0.92) / cell.W, (cv.height * 0.92) / cell.H)
    const ox = (cv.width - cell.W * vs) / 2
    const oy = (cv.height - cell.H * vs) / 2

    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, cell.W * vs, cell.H * vs)
    ctx.clip()
    if (it.bounds) {
      const frame = it.loop.render(loopPos % it.loop.length)
      const s = it.a.align.scale
      const { ax, ay } = anchorOf(it.a, it.bounds)
      ctx.drawImage(
        frame,
        ox + (cell.px - ax * s) * vs,
        oy + (cell.py - ay * s) * vs,
        frame.width * s * vs,
        frame.height * s * vs,
      )
    }
    ctx.restore()

    ctx.strokeStyle = 'rgba(255, 79, 216, 0.75)'
    ctx.strokeRect(ox + 0.5, oy + 0.5, cell.W * vs, cell.H * vs)
    const pxv = ox + cell.px * vs
    const pyv = oy + cell.py * vs
    ctx.strokeStyle = 'rgba(82, 255, 122, 0.7)'
    ctx.beginPath()
    ctx.moveTo(pxv - 12, pyv)
    ctx.lineTo(pxv + 12, pyv)
    ctx.moveTo(pxv, pyv - 12)
    ctx.lineTo(pxv, pyv + 12)
    ctx.stroke()
  }

  // playback com a curva de fps
  let acc = 0
  let lastT = performance.now()
  function tick(now: number): void {
    if (!alive) return
    const dt = Math.min((now - lastT) / 1000, 0.25)
    lastT = now
    const it = items[current]
    if (ready && playing && it && it.loop.length > 1) {
      acc += dt
      const dur = (p: number): number => {
        const m = it.a.speed[it.selIdx[it.loop.k + (p % it.loop.length)]] ?? 1
        return 1 / (it.a.fps * m)
      }
      let spf = dur(loopPos)
      let advanced = false
      while (acc >= spf) {
        acc -= spf
        loopPos = (loopPos + 1) % it.loop.length
        advanced = true
        spf = dur(loopPos)
      }
      if (advanced) renderPreview()
    }
    requestAnimationFrame(tick)
  }

  function setPlaying(p: boolean): void {
    playing = p
    $('#sp-play').innerHTML = p ? '&#9208;' : '&#9654;'
    acc = 0
  }

  $('#sp-play').onclick = () => setPlaying(!playing)
  $('#sp-prev').onclick = () => step(-1)
  $('#sp-next').onclick = () => step(1)

  function step(dir: number): void {
    const it = items[current]
    if (!it) return
    setPlaying(false)
    loopPos = (loopPos + dir + it.loop.length) % it.loop.length
    renderPreview()
  }

  function buildTabs(): void {
    const tabs = $('#sp-tabs')
    tabs.innerHTML = ''
    items.forEach((it, i) => {
      const b = document.createElement('button')
      b.className = 'chip' + (i === current ? ' active' : '')
      b.textContent = it.a.name.toUpperCase() + (it.bounds ? '' : ' ⚠')
      b.onclick = () => {
        current = i
        loopPos = 0
        buildTabs()
        renderPreview()
      }
      tabs.append(b)
    })
  }

  // ── exportação (migrada do alinhamento) ─────────────────
  const expScale = $<HTMLSelectElement>('#sp-scale')
  const expPadding = $<HTMLInputElement>('#sp-padding')
  const expCols = $<HTMLInputElement>('#sp-cols')
  const expColors = $<HTMLSelectElement>('#sp-colors')
  expScale.value = String(exp.scale)
  expPadding.value = String(exp.padding)
  expCols.value = String(exp.columns)
  expColors.value = String(exp.colors)

  expScale.onchange = () => { exp.scale = Number(expScale.value); updateInfo(); scheduleSave() }
  expPadding.oninput = () => { exp.padding = Math.max(0, Math.floor(Number(expPadding.value) || 0)); updateInfo(); scheduleSave() }
  expCols.oninput = () => { exp.columns = Math.max(0, Math.floor(Number(expCols.value) || 0)); updateInfo(); scheduleSave() }
  expColors.onchange = () => { exp.colors = Number(expColors.value); scheduleSave() }

  function usableItems(): Item[] {
    return items.filter((it) => it.bounds)
  }

  function updateInfo(): void {
    if (!ready) return
    const cell = cellDims()
    $('#sp-info').textContent = `célula ${cell.W}×${cell.H}px · pivô (${Math.round(cell.px)}, ${Math.round(cell.py)})`
    const usable = usableItems()
    const summary = $('#sp-summary')
    if (!usable.length) {
      summary.textContent = 'nenhum frame para exportar'
      summary.classList.add('warn')
      return
    }
    let maxW = 0
    let maxH = 0
    let total = 0
    for (const it of usable) {
      const l = computeLayout(it.loop.length, cell.W, cell.H, exp)
      maxW = Math.max(maxW, l.width)
      maxH = Math.max(maxH, l.height)
      total += it.loop.length
    }
    const tooBig = maxW > MAX_SHEET_DIM || maxH > MAX_SHEET_DIM
    summary.classList.toggle('warn', tooBig)
    summary.innerHTML =
      `<b>${usable.length}</b> atlas (1 por animação) · <b>${total}</b> frames<br>` +
      `maior atlas <b>${maxW}×${maxH}px</b>` +
      (tooBig ? '<br>⚠ atlas acima de 16384px — reduza a escala' : '')
  }

  // ── geração + persistência ──────────────────────────────
  const genBtn = $<HTMLButtonElement>('#sp-generate')
  genBtn.onclick = () => void generate()

  async function generate(): Promise<void> {
    if (!ready || preparing) {
      toast('AGUARDE AS ANIMAÇÕES CARREGAREM')
      return
    }
    const usable = usableItems()
    if (!usable.length) {
      toast('NENHUM FRAME PARA EXPORTAR', true)
      return
    }
    const cell = cellDims()
    for (const it of usable) {
      const l = computeLayout(it.loop.length, cell.W, cell.H, exp)
      if (l.width > MAX_SHEET_DIM || l.height > MAX_SHEET_DIM) {
        toast(`ATLAS DE "${it.a.name}" GRANDE DEMAIS — REDUZA A ESCALA`, true)
        return
      }
    }
    genBtn.disabled = true
    try {
      const used = new Set<string>()
      const anims: SheetAnimMeta[] = []
      const blobs: Blob[] = []
      let total = 0
      for (let i = 0; i < usable.length; i++) {
        const it = usable[i]
        genBtn.textContent = `GERANDO ${i + 1}/${usable.length}...`
        const slug = uniqueSlug(it.a.name, used)
        const layout = computeLayout(it.loop.length, cell.W, cell.H, exp)
        const atlas = document.createElement('canvas')
        atlas.width = layout.width
        atlas.height = layout.height
        const atx = atlas.getContext('2d')!
        const cellCv = document.createElement('canvas')
        cellCv.width = layout.cellW
        cellCv.height = layout.cellH
        const cctx = cellCv.getContext('2d')!
        const gs = exp.scale
        const s = it.a.align.scale
        const { ax, ay } = anchorOf(it.a, it.bounds!)
        const durations: number[] = []
        const kept: number[] = []
        for (let p = 0; p < it.loop.length; p++) {
          const frame = it.loop.render(p)
          cctx.clearRect(0, 0, layout.cellW, layout.cellH)
          cctx.imageSmoothingEnabled = s * gs < 1
          cctx.imageSmoothingQuality = 'high'
          cctx.drawImage(
            frame,
            (cell.px - ax * s) * gs,
            (cell.py - ay * s) * gs,
            frame.width * s * gs,
            frame.height * s * gs,
          )
          const idx = kept.length
          const col = idx % layout.cols
          const row = Math.floor(idx / layout.cols)
          atx.drawImage(cellCv, layout.padding + col * (layout.cellW + layout.padding), layout.padding + row * (layout.cellH + layout.padding))
          const mult = it.a.speed[it.selIdx[it.loop.k + p]] ?? 1
          durations.push(Math.round(1000 / (it.a.fps * mult)))
          kept.push(p)
          if (p % 8 === 7) await new Promise((r) => setTimeout(r, 0))
          if (!alive) return // aborto: nenhum registro parcial é persistido
        }
        let blob: Blob
        try {
          blob = await encodeCanvas(atlas, exp.colors)
        } catch {
          throw new Error(`falha ao codificar o PNG de "${it.a.name}"`)
        }
        total += blob.size
        blobs.push(blob)
        anims.push({
          animId: it.a.id,
          name: it.a.name,
          slug,
          frameCount: kept.length,
          fps: it.a.fps,
          crossfade: it.loop.k,
          columns: layout.cols,
          rows: layout.rows,
          width: layout.width,
          height: layout.height,
          cellW: layout.cellW,
          cellH: layout.cellH,
          durationsMs: durations,
          keptPositions: kept,
        })
      }
      if (!alive) return
      const version = sheets.reduce((m, sh) => Math.max(m, sh.version), 0) + 1
      const sheet: SpriteSheet = {
        id: uid(),
        projectId: project.id,
        version,
        createdAt: Date.now(),
        cell: {
          w: cell.W,
          h: cell.H,
          pivotX: project.alignCfg.pivotX,
          pivotY: project.alignCfg.pivotY,
          margin: project.alignCfg.margin,
        },
        exportCfg: { ...exp },
        corrections: [],
        anims,
        blobs,
        stateHash: animStateHash(project),
      }
      await putSheet(sheet)
      sheets.push(sheet)
      renderVersions()
      toast(`VERSÃO ${version} GERADA E SALVA ✓ ${formatBytes(total)}`)
    } catch (err) {
      console.error(err)
      toast(
        err instanceof QuotaError
          ? 'ESPAÇO DO NAVEGADOR ESGOTADO — EXCLUA VERSÕES ANTIGAS'
          : `ERRO: ${err instanceof Error ? err.message : 'falha na geração'}`.toUpperCase(),
        true,
      )
    } finally {
      genBtn.disabled = false
      genBtn.textContent = 'GERAR & SALVAR_'
    }
  }

  // ── versões salvas ──────────────────────────────────────
  function renderVersions(): void {
    const box = $('#sp-versions')
    box.innerHTML = ''
    $('#sp-ver-count').textContent = sheets.length ? `· ${sheets.length}` : ''
    if (!sheets.length) {
      const hint = document.createElement('span')
      hint.className = 'dim refs-empty'
      hint.textContent = 'nenhuma geração salva ainda — clique em GERAR & SALVAR'
      box.append(hint)
      return
    }
    for (const sh of [...sheets].sort((a, b) => b.version - a.version)) {
      const row = document.createElement('div')
      row.className = 'align-row'
      const name = document.createElement('span')
      name.className = 'ar-name'
      const bytes = sh.blobs.reduce((m, b) => m + b.size, 0)
      name.textContent = `v${sh.version} · ${new Date(sh.createdAt).toLocaleDateString('pt-BR')} · ${sh.anims.length} atlas · ${formatBytes(bytes)}`
      row.append(name)
      const del = document.createElement('button')
      del.className = 'btn btn-small danger'
      del.textContent = 'X'
      del.title = 'excluir versão'
      del.onclick = async () => {
        await deleteSheet(sh.id)
        sheets = sheets.filter((s2) => s2.id !== sh.id)
        renderVersions()
      }
      row.append(del)
      box.append(row)
    }
  }

  async function loadSheets(): Promise<void> {
    try {
      sheets = await listSheets(project.id)
    } catch (err) {
      console.error(err)
      sheets = []
    }
    if (!alive) return
    renderVersions()
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
  window.addEventListener('resize', resizeCanvas)

  // ── inicialização / teardown ────────────────────────────
  setPlaying(true)
  resizeCanvas()
  void prepare()
  void loadSheets()
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
