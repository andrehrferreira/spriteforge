/**
 * Área SPRITES: etapa pós-alinhamento. Recomputa loops/bounds/célula,
 * analisa as animações e propõe correções não-destrutivas, gera os atlas
 * (1 PNG por animação), persiste as gerações com versão no IndexedDB e
 * permite baixar (ZIP), regerar e excluir versões.
 */

import { strToU8, zipSync } from 'fflate'
import { detectAll, sampleFromCanvas, type AnimInput, type FrameSample } from './analyze'
import { scheduleBackup } from './backup'
import { ChromaProcessor } from './chroma'
import { deleteSheet, listSheets, putSheet, QuotaError, uid } from './db'
import {
    buildManifest,
    computeLayout,
    downloadBlob,
    encodeCanvas,
    formatBytes,
    MAX_SHEET_DIM,
    slugify,
    uniqueSlug,
} from './export'
import { createLoop, type Loop } from './loop'
import { animStateHash, ensureFrames, saveProject, selectedBitmaps, state } from './state'
import { toast } from './toast'
import type { AnimationData, Correction, ExportCfg, SheetAnimMeta, SpriteSheet } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

interface Bounds {
    x: number
    y: number
    w: number
    h: number
}

interface Item {
    a: AnimationData
    loop: Loop
    selIdx: number[]
    bounds: Bounds | null
    /** bitmaps selecionados (para recompor o loop com crossfade corrigido) */
    sel: ImageBitmap[]
    /** amostras reduzidas dos frames do loop, para a análise */
    samples: FrameSample[]
}

/** overrides de geração derivados das correções aceitas de uma animação */
interface AnimEff {
    scaleMul: number
    dx: number
    dy: number
    removed: Set<number>
    crossfade: number | null
    cleanAlpha: number | null
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
    let corrections: Correction[] = []
    let current = 0 // índice em items
    let playing = true
    let loopPos = 0
    let saveTimer = 0
    let analyzeTimer = 0

    function scheduleSave(): void {
        clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => void saveProject(), 600)
    }

    function status(msg: string): void {
        $('#sp-status').textContent = msg ? `· ${msg}` : ''
    }

    // ── célula e âncora (mesma formulação do alinhamento) ───
    function cellDims(marginOverride: number | null = null): {
        W: number
        H: number
        px: number
        py: number
    } {
        const cfg = project.alignCfg
        const margin = marginOverride ?? cfg.margin
        let maxW = 0
        let maxH = 0
        for (const it of items) {
            if (!it.bounds) continue
            maxW = Math.max(maxW, it.bounds.w * it.a.align.scale)
            maxH = Math.max(maxH, it.bounds.h * it.a.align.scale)
        }
        if (!maxW) {
            maxW = 32
            maxH = 32
        }
        const W = Math.ceil(maxW) + margin * 2
        const H = Math.ceil(maxH) + margin * 2
        return {
            W,
            H,
            px: margin + (W - margin * 2) * cfg.pivotX,
            py: margin + (H - margin * 2) * cfg.pivotY,
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
        let minX = Infinity,
            minY = Infinity,
            maxX = -1,
            maxY = -1
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
                    status(`EXTRAINDO ${a.name} ${d}/${t} (${i + 1}/${anims.length})`),
                )
                if (!alive) return
                const sel = selectedBitmaps(a, frames)
                const selIdx = a.selected.flatMap((s, idx) => (s ? [idx] : []))
                const contiguous =
                    selIdx.length > 0 && selIdx[selIdx.length - 1] - selIdx[0] === selIdx.length - 1
                const loop = createLoop(
                    proc,
                    sel,
                    a.chroma,
                    a.crossfade,
                    contiguous ? (a.drift ?? null) : null,
                )
                status(`ANALISANDO ${a.name} (${i + 1}/${anims.length})`)
                const bounds = await computeBounds(a, sel)
                if (!alive) return
                // amostras para a análise — cópia imediata (o canvas do loop é reutilizado)
                const samples: FrameSample[] = []
                for (let p = 0; p < loop.length; p++) {
                    samples.push(sampleFromCanvas(loop.render(p)))
                    if (p % 8 === 7) await new Promise((r) => setTimeout(r, 0))
                    if (!alive) return
                }
                items.push({ a, loop, selIdx, bounds, sel, samples })
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
        runAnalysis()
        updateInfo()
        renderPreview()
    }

    // ── análise e propostas de correção ─────────────────────
    function runAnalysis(): void {
        if (!ready) return
        const prev = new Map(corrections.map((c) => [c.id, c]))
        const inputs: AnimInput[] = items.map((it) => ({
            id: it.a.id,
            name: it.a.name,
            scale: it.a.align.scale,
            dx: it.a.align.dx,
            crossfade: it.loop.k,
            srcW: it.sel[0]?.width ?? 1,
            bounds: it.bounds,
            samples: it.samples,
        }))
        corrections = detectAll(inputs, cellDims(), project.alignCfg, exp, project.spritesCfg)
        // preserva decisões anteriores (aceito/ajustado) ao reanalisar
        for (const c of corrections) {
            const old = prev.get(c.id)
            if (old) {
                c.accepted = old.accepted
                if (old.adjusted) {
                    c.params = { ...old.params }
                    c.adjusted = true
                }
            }
        }
        renderCorrections()
    }

    function scheduleAnalyze(): void {
        clearTimeout(analyzeTimer)
        analyzeTimer = window.setTimeout(runAnalysis, 300)
    }

    function renderCorrections(): void {
        const box = $('#sp-corrections')
        box.innerHTML = ''
        const accepted = corrections.filter((c) => c.accepted).length
        $('#sp-an-count').textContent = corrections.length
            ? `· ${accepted}/${corrections.length} aceitas`
            : ''
        if (!corrections.length) {
            const hint = document.createElement('span')
            hint.className = 'dim refs-empty'
            hint.textContent = ready
                ? 'nenhuma correção sugerida — as animações estão consistentes; pode gerar direto'
                : 'a análise roda quando as animações terminarem de carregar'
            box.append(hint)
            return
        }
        for (const c of corrections) {
            const row = document.createElement('div')
            row.className = 'corr-row' + (c.accepted ? ' on' : '')
            const top = document.createElement('div')
            top.className = 'corr-top'
            const toggle = document.createElement('button')
            toggle.className = 'chip corr-toggle' + (c.accepted ? ' active' : '')
            toggle.textContent = c.accepted ? 'ACEITA ✓' : 'ACEITAR'
            toggle.onclick = () => {
                c.accepted = !c.accepted
                renderCorrections()
                updateInfo()
                renderPreview()
            }
            const sev = document.createElement('span')
            sev.className = `corr-sev sev-${c.severity}`
            sev.textContent = c.severity.toUpperCase()
            top.append(toggle, sev)
            if (c.savingsBytes) {
                const sv = document.createElement('span')
                sv.className = 'dim corr-savings'
                sv.textContent = `≈ -${formatBytes(c.savingsBytes)} (estimado)`
                top.append(sv)
            }
            const key = Object.keys(c.params)[0]
            if (key) {
                const pr = document.createElement('label')
                pr.className = 'ar-field corr-param'
                const lab = document.createElement('span')
                lab.className = 'ar-label'
                lab.textContent = key.toUpperCase()
                const input = document.createElement('input')
                input.type = 'number'
                input.className = 'text-input num-mini'
                input.step = key === 'escala' ? '0.05' : '1'
                input.value = String(c.params[key])
                input.oninput = () => {
                    const v = Number(input.value)
                    if (!Number.isFinite(v)) return
                    c.params[key] = v
                    c.adjusted = true
                    updateInfo()
                    renderPreview()
                }
                pr.append(lab, input)
                top.append(pr)
            }
            const label = document.createElement('div')
            label.className = 'corr-label'
            label.textContent = c.label
            row.append(top, label)
            box.append(row)
        }
    }

    $('#sp-reanalyze').onclick = () => {
        if (preparing) return
        runAnalysis()
        toast('ANÁLISE ATUALIZADA')
    }

    /** overrides de geração derivados das correções aceitas (por animação) */
    function effFor(animId: string, corrs: Correction[] = corrections): AnimEff {
        const e: AnimEff = {
            scaleMul: 1,
            dx: 0,
            dy: 0,
            removed: new Set(),
            crossfade: null,
            cleanAlpha: null,
        }
        for (const c of corrs) {
            if (!c.accepted || c.target.animId !== animId) continue
            switch (c.kind) {
                case 'proporcao':
                    e.scaleMul = c.params.escala ?? 1
                    break
                case 'posicao':
                    e.dx = c.params.dx ?? 0
                    e.dy = c.params.dy ?? 0
                    break
                case 'duplicados':
                    for (const f of c.target.frames ?? []) e.removed.add(f)
                    break
                case 'continuidade':
                    e.crossfade = Math.max(0, Math.round(c.params.crossfade ?? 3))
                    break
                case 'pixel':
                    e.cleanAlpha = Math.round(c.params.alfa ?? 24)
                    break
                case 'recorte':
                case 'quantizacao':
                case 'escala':
                    break // escopo de projeto, tratado em globalEff
                default: {
                    const _exhaustive: never = c.kind
                    void _exhaustive
                }
            }
        }
        return e
    }

    /** overrides de escopo do projeto (margem/cores/escala) */
    function globalEff(corrs: Correction[] = corrections): {
        margin: number | null
        colors: number | null
        scale: number | null
    } {
        const g: { margin: number | null; colors: number | null; scale: number | null } = {
            margin: null,
            colors: null,
            scale: null,
        }
        for (const c of corrs) {
            if (!c.accepted || c.target.scope !== 'projeto') continue
            if (c.kind === 'recorte') g.margin = Math.max(0, Math.round(c.params.margem ?? 8))
            else if (c.kind === 'quantizacao') g.colors = Math.round(c.params.cores ?? 256)
            else if (c.kind === 'escala') g.scale = Math.max(0.05, c.params.escala ?? exp.scale)
        }
        return g
    }

    /** remove pixels visíveis cujos 8 vizinhos são (quase) transparentes */
    function cleanOrphans(
        target: CanvasRenderingContext2D,
        w: number,
        h: number,
        neighborAlpha: number,
    ): void {
        const img = target.getImageData(0, 0, w, h)
        const d = img.data
        const kill: number[] = []
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x
                if (d[idx * 4 + 3] <= 40) continue
                let solid = false
                for (let dy = -1; dy <= 1 && !solid; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue
                        if (d[((y + dy) * w + (x + dx)) * 4 + 3] > neighborAlpha) {
                            solid = true
                            break
                        }
                    }
                }
                if (!solid) kill.push(idx)
            }
        }
        for (const idx of kill) {
            d[idx * 4] = 0
            d[idx * 4 + 1] = 0
            d[idx * 4 + 2] = 0
            d[idx * 4 + 3] = 0
        }
        if (kill.length) target.putImageData(img, 0, 0)
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
        const g = globalEff()
        const cell = cellDims(g.margin)
        const vs = Math.min((cv.width * 0.92) / cell.W, (cv.height * 0.92) / cell.H)
        const ox = (cv.width - cell.W * vs) / 2
        const oy = (cv.height - cell.H * vs) / 2

        ctx.save()
        ctx.beginPath()
        ctx.rect(ox, oy, cell.W * vs, cell.H * vs)
        ctx.clip()
        if (it.bounds) {
            // preview com as correções de escala/posição aceitas aplicadas
            const eff = effFor(it.a.id)
            const frame = it.loop.render(loopPos % it.loop.length)
            const s = it.a.align.scale * eff.scaleMul
            const { ax, ay } = anchorOf(it.a, it.bounds)
            ctx.drawImage(
                frame,
                ox + (cell.px - (ax + eff.dx) * s) * vs,
                oy + (cell.py - (ay + eff.dy) * s) * vs,
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
            const removed = effFor(it.a.id).removed
            const next = (p: number): number => {
                let q = (p + 1) % it.loop.length
                // pula os frames removidos pelas correções aceitas (preview fiel)
                let guard = 0
                while (removed.has(q) && guard++ < it.loop.length) q = (q + 1) % it.loop.length
                return q
            }
            let spf = dur(loopPos)
            let advanced = false
            while (acc >= spf) {
                acc -= spf
                loopPos = next(loopPos)
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

    expScale.onchange = () => {
        exp.scale = Number(expScale.value)
        updateInfo()
        scheduleAnalyze()
        scheduleSave()
    }
    expPadding.oninput = () => {
        exp.padding = Math.max(0, Math.floor(Number(expPadding.value) || 0))
        updateInfo()
        scheduleSave()
    }
    expCols.oninput = () => {
        exp.columns = Math.max(0, Math.floor(Number(expCols.value) || 0))
        updateInfo()
        scheduleSave()
    }
    expColors.onchange = () => {
        exp.colors = Number(expColors.value)
        scheduleAnalyze()
        scheduleSave()
    }

    function usableItems(): Item[] {
        return items.filter((it) => it.bounds)
    }

    function updateInfo(): void {
        if (!ready) return
        const g = globalEff()
        const cell = cellDims(g.margin)
        $('#sp-info').textContent =
            `célula ${cell.W}×${cell.H}px · pivô (${Math.round(cell.px)}, ${Math.round(cell.py)})`
        const usable = usableItems()
        const summary = $('#sp-summary')
        if (!usable.length) {
            summary.textContent = 'nenhum frame para exportar'
            summary.classList.add('warn')
            return
        }
        const opts = { scale: g.scale ?? exp.scale, padding: exp.padding, columns: exp.columns }
        let maxW = 0
        let maxH = 0
        let total = 0
        for (const it of usable) {
            const eff = effFor(it.a.id)
            const kept = Math.max(
                1,
                it.loop.length - [...eff.removed].filter((p) => p < it.loop.length).length,
            )
            const l = computeLayout(kept, cell.W, cell.H, opts)
            maxW = Math.max(maxW, l.width)
            maxH = Math.max(maxH, l.height)
            total += kept
        }
        const tooBig = maxW > MAX_SHEET_DIM || maxH > MAX_SHEET_DIM
        summary.classList.toggle('warn', tooBig)
        summary.innerHTML =
            `<b>${usable.length}</b> atlas (1 por animação) · <b>${total}</b> frames (com correções)<br>` +
            `maior atlas <b>${maxW}×${maxH}px</b>` +
            (tooBig ? '<br>⚠ atlas acima de 16384px — reduza a escala' : '')
    }

    // ── geração + persistência ──────────────────────────────
    const genBtn = $<HTMLButtonElement>('#sp-generate')
    genBtn.onclick = () => void generate()

    /** proposta de escala que faz o atlas caber no limite (criada/atualizada) */
    function ensureScaleProposal(maxSide: number, effScale: number): void {
        const sugg = Math.max(0.05, Math.floor(((MAX_SHEET_DIM - 64) / maxSide) * effScale * 100) / 100)
        const label = `atlas acima de ${MAX_SHEET_DIM}px após as correções — escala ${sugg}× faz caber`
        const existing = corrections.find((c) => c.kind === 'escala')
        if (existing) {
            existing.params = { escala: sugg }
            existing.label = label
            existing.severity = 'critico'
            existing.accepted = false
        } else {
            corrections.push({
                id: 'escala:projeto',
                kind: 'escala',
                severity: 'critico',
                target: { scope: 'projeto' },
                label,
                params: { escala: sugg },
                accepted: false,
                adjusted: false,
            })
        }
        renderCorrections()
    }

    async function generate(genCorr: Correction[] = corrections, genExp: ExportCfg = exp): Promise<void> {
        if (!ready || preparing) {
            toast('AGUARDE AS ANIMAÇÕES CARREGAREM')
            return
        }
        const usable = usableItems()
        if (!usable.length) {
            toast('NENHUM FRAME PARA EXPORTAR', true)
            return
        }

        // overrides das correções aceitas
        const g = globalEff(genCorr)
        const effScale = g.scale ?? genExp.scale
        const effColors = g.colors ?? genExp.colors
        const effMargin = g.margin ?? project.alignCfg.margin
        const cell = cellDims(g.margin)
        const layoutOpts = { scale: effScale, padding: genExp.padding, columns: genExp.columns }

        // plano por animação: loop efetivo (crossfade corrigido) + frames mantidos
        interface Plan {
            it: Item
            loop: Loop
            kept: number[]
            layout: ReturnType<typeof computeLayout>
            eff: AnimEff
        }
        const plans: Plan[] = []
        let maxSide = 0
        for (const it of usable) {
            const eff = effFor(it.a.id, genCorr)
            let loop = it.loop
            if (eff.crossfade != null && eff.crossfade !== it.a.crossfade) {
                const contiguous =
                    it.selIdx.length > 0 &&
                    it.selIdx[it.selIdx.length - 1] - it.selIdx[0] === it.selIdx.length - 1
                loop = createLoop(
                    proc,
                    it.sel,
                    it.a.chroma,
                    eff.crossfade,
                    contiguous ? (it.a.drift ?? null) : null,
                )
            }
            const kept: number[] = []
            for (let p = 0; p < loop.length; p++) if (!eff.removed.has(p)) kept.push(p)
            if (!kept.length) kept.push(0)
            const layout = computeLayout(kept.length, cell.W, cell.H, layoutOpts)
            maxSide = Math.max(maxSide, layout.width, layout.height)
            plans.push({ it, loop, kept, layout, eff })
        }

        // revalida o limite DEPOIS de aplicar as correções aceitas
        if (maxSide > MAX_SHEET_DIM) {
            if (genCorr === corrections) {
                ensureScaleProposal(maxSide, effScale)
                toast('ATLAS ACIMA DE 16384PX APÓS AS CORREÇÕES — ACEITE A PROPOSTA DE ESCALA', true)
            } else {
                toast('ATLAS ACIMA DE 16384PX COM OS PARÂMETROS SALVOS — AS ANIMAÇÕES MUDARAM', true)
            }
            return
        }

        genBtn.disabled = true
        try {
            const used = new Set<string>()
            const anims: SheetAnimMeta[] = []
            const blobs: Blob[] = []
            let total = 0
            for (let i = 0; i < plans.length; i++) {
                const { it, loop, layout, eff, kept } = plans[i]
                genBtn.textContent = `GERANDO ${i + 1}/${plans.length}...`
                const slug = uniqueSlug(it.a.name, used)
                const atlas = document.createElement('canvas')
                atlas.width = layout.width
                atlas.height = layout.height
                const atx = atlas.getContext('2d')!
                const cellCv = document.createElement('canvas')
                cellCv.width = layout.cellW
                cellCv.height = layout.cellH
                const cctx = cellCv.getContext('2d', { willReadFrequently: eff.cleanAlpha != null })!
                const gs = effScale
                const s = it.a.align.scale * eff.scaleMul
                const { ax, ay } = anchorOf(it.a, it.bounds!)
                const durOf = (p: number): number => {
                    const mult = it.a.speed[it.selIdx[loop.k + p]] ?? 1
                    return Math.round(1000 / (it.a.fps * mult))
                }
                const durations: number[] = []
                let pending = 0 // duração de removidos antes do 1º frame mantido
                const removing = kept.length < loop.length
                for (let p = 0; p < loop.length; p++) {
                    if (removing && eff.removed.has(p)) {
                        // frame removido: a duração soma no frame mantido anterior
                        if (durations.length) durations[durations.length - 1] += durOf(p)
                        else pending += durOf(p)
                        continue
                    }
                    const frame = loop.render(p)
                    cctx.clearRect(0, 0, layout.cellW, layout.cellH)
                    cctx.imageSmoothingEnabled = s * gs < 1
                    cctx.imageSmoothingQuality = 'high'
                    cctx.drawImage(
                        frame,
                        (cell.px - (ax + eff.dx) * s) * gs,
                        (cell.py - (ay + eff.dy) * s) * gs,
                        frame.width * s * gs,
                        frame.height * s * gs,
                    )
                    if (eff.cleanAlpha != null) cleanOrphans(cctx, layout.cellW, layout.cellH, eff.cleanAlpha)
                    const idx = durations.length
                    const col = idx % layout.cols
                    const row = Math.floor(idx / layout.cols)
                    atx.drawImage(
                        cellCv,
                        layout.padding + col * (layout.cellW + layout.padding),
                        layout.padding + row * (layout.cellH + layout.padding),
                    )
                    durations.push(durOf(p) + pending)
                    pending = 0
                    if (p % 8 === 7) await new Promise((r) => setTimeout(r, 0))
                    if (!alive) return // aborto: nenhum registro parcial é persistido
                }
                let blob: Blob
                try {
                    blob = await encodeCanvas(atlas, effColors)
                } catch {
                    throw new Error(`falha ao codificar o PNG de "${it.a.name}"`)
                }
                total += blob.size
                blobs.push(blob)
                anims.push({
                    animId: it.a.id,
                    name: it.a.name,
                    slug,
                    frameCount: durations.length,
                    fps: it.a.fps,
                    crossfade: loop.k,
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
                    margin: effMargin,
                },
                exportCfg: {
                    scale: effScale,
                    padding: genExp.padding,
                    colors: effColors,
                    columns: genExp.columns,
                },
                corrections: genCorr
                    .filter((c) => c.accepted)
                    .map((c) => ({
                        ...c,
                        target: { ...c.target, frames: c.target.frames ? [...c.target.frames] : undefined },
                        params: { ...c.params },
                    })),
                anims,
                blobs,
                stateHash: animStateHash(project),
            }
            await putSheet(sheet)
            sheets.push(sheet)
            renderVersions()
            scheduleBackup(project)
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

    /** ZIP único: PNGs por animação + manifesto regenerado dos metadados */
    async function downloadZip(sh: SpriteSheet): Promise<void> {
        const pslug = slugify(project.name)
        const files: Record<string, Uint8Array> = {}
        for (let i = 0; i < sh.anims.length; i++) {
            files[`${pslug}_${sh.anims[i].slug}.png`] = new Uint8Array(await sh.blobs[i].arrayBuffer())
        }
        files[`${pslug}.json`] = strToU8(buildManifest(project.name, sh))
        const zipped = zipSync(files, { level: 0 }) // PNGs já estão comprimidos
        downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${pslug}_v${sh.version}.zip`)
        toast(`ZIP DA VERSÃO ${sh.version} BAIXADO ✓`)
    }

    /** regera uma nova versão com os parâmetros e correções salvos */
    async function regenerate(sh: SpriteSheet): Promise<void> {
        if (!ready || preparing) {
            toast('AGUARDE AS ANIMAÇÕES CARREGAREM')
            return
        }
        const missing = sh.anims.filter((am) => !items.some((it) => it.a.id === am.animId && it.bounds))
        if (missing.length) {
            toast(
                `DIVERGÊNCIA: ${missing.map((m) => m.name).join(', ')} NÃO ESTÁ MAIS DISPONÍVEL — REGERANDO COM AS ATUAIS`,
                true,
            )
        }
        const corrs = sh.corrections.map((c) => ({
            ...c,
            accepted: true,
            target: { ...c.target, frames: c.target.frames ? [...c.target.frames] : undefined },
            params: { ...c.params },
        }))
        await generate(corrs, sh.exportCfg)
    }

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
        const currentHash = animStateHash(project)
        for (const sh of [...sheets].sort((a, b) => b.version - a.version)) {
            const row = document.createElement('div')
            row.className = 'align-row'
            const name = document.createElement('span')
            name.className = 'ar-name'
            const bytes = sh.blobs.reduce((m, b) => m + b.size, 0)
            name.textContent = `v${sh.version} · ${new Date(sh.createdAt).toLocaleDateString('pt-BR')} · ${sh.anims.length} atlas · ${formatBytes(bytes)}`
            name.title = `célula ${sh.cell.w}×${sh.cell.h} · escala ${sh.exportCfg.scale}× · ${sh.corrections.length} correção(ões) aplicada(s)`
            row.append(name)
            if (sh.stateHash !== currentHash) {
                const stale = document.createElement('span')
                stale.className = 'ver-stale'
                stale.textContent = 'DESATUALIZADO'
                stale.title = 'as animações mudaram depois desta geração — regere'
                row.append(stale)
            }
            const zip = document.createElement('button')
            zip.className = 'btn btn-small'
            zip.textContent = 'ZIP_'
            zip.title = 'baixar PNGs + manifesto num único .zip'
            zip.onclick = () => void downloadZip(sh)
            const regen = document.createElement('button')
            regen.className = 'btn btn-small'
            regen.textContent = 'REGERAR'
            regen.title = 'gera uma nova versão com os parâmetros e correções desta'
            regen.onclick = () => void regenerate(sh)
            const del = document.createElement('button')
            del.className = 'btn btn-small danger'
            del.textContent = 'X'
            del.title = 'excluir versão'
            del.onclick = async () => {
                await deleteSheet(sh.id)
                sheets = sheets.filter((s2) => s2.id !== sh.id)
                renderVersions()
                scheduleBackup(project)
            }
            row.append(zip, regen, del)
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
        clearTimeout(analyzeTimer)
        document.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', resizeCanvas)
    }
}
