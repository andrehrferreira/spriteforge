/**
 * Normalizador de referências: recebe imagens (geralmente com fundo sólido
 * preto), remove o fundo por flood fill a partir das bordas (preserva as
 * áreas escuras internas do personagem) ou por chroma/alpha, alinha os pés
 * de todas no mesmo pivô, permite ajuste de Y/escala e exporta com fundo
 * chroma #00b140.
 */

import { ChromaProcessor, DEFAULT_SETTINGS, type ChromaSettings } from './chroma'
import { autoKey } from './editor'
import { downloadBlob } from './export'
import { toast } from './toast'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

interface Bounds {
    x: number
    y: number
    w: number
    h: number
}

type CutMode = 'none' | 'flood' | 'chroma'

interface RefImage {
    id: number
    name: string
    bitmap: ImageBitmap
    /** cor do fundo detectada pelos cantos */
    key: [number, number, number]
    hasAlpha: boolean
    mode: CutMode
    /** imagem já recortada (null = usar o bitmap original) */
    cut: HTMLCanvasElement | null
    dy: number
    scale: number
    bounds: Bounds | null
}

export function initNormalize(): () => void {
    const proc = new ChromaProcessor()
    let alive = true
    const images: RefImage[] = []
    let nextId = 1
    let currentId = -1
    // padrões calibrados para as referências (fundo preto sólido)
    const settings: ChromaSettings = { ...DEFAULT_SETTINGS, similarity: 0.048, smoothness: 0.47 }
    const removal = { mode: 'auto' as 'auto' | CutMode, tol: 14, feather: 0.3 }
    const out = { w: 0, h: 0, auto: true, ground: 32, bg: '#00b140' }
    let lastVs = 1 // escala de visualização do último render (para o arraste)

    const wrap = $('#norm-wrap')
    const cv = $<HTMLCanvasElement>('#norm-canvas')
    const ctx = cv.getContext('2d')!

    function current(): RefImage | null {
        return images.find((i) => i.id === currentId) ?? null
    }

    // ── recorte do fundo ────────────────────────────────────

    function resolveMode(img: RefImage): CutMode {
        if (removal.mode !== 'auto') return removal.mode
        if (img.hasAlpha) return 'none'
        // fundo sem saturação (preto/branco/cinza) → flood; colorido → chroma
        const [r, g, b] = img.key
        return Math.max(r, g, b) - Math.min(r, g, b) < 32 ? 'flood' : 'chroma'
    }

    function rebuildCut(img: RefImage): void {
        img.mode = resolveMode(img)
        if (img.mode === 'none') {
            img.cut = null
        } else if (img.mode === 'chroma') {
            const o = proc.render(img.bitmap, { ...settings, key: img.key })
            const c = document.createElement('canvas')
            c.width = o.width
            c.height = o.height
            c.getContext('2d')!.drawImage(o, 0, 0)
            img.cut = c
        } else {
            img.cut = floodCut(img.bitmap, img.key, removal.tol, removal.feather)
        }
    }

    /**
     * Remove o fundo por inundação a partir das bordas: só fica transparente
     * o que está conectado à borda com cor próxima do fundo — áreas escuras
     * dentro do personagem são preservadas.
     */
    function floodCut(
        bmp: ImageBitmap,
        bg: [number, number, number],
        tol: number,
        feather: number,
    ): HTMLCanvasElement {
        const w = bmp.width
        const h = bmp.height
        const src = document.createElement('canvas')
        src.width = w
        src.height = h
        const sctx = src.getContext('2d', { willReadFrequently: true })!
        sctx.drawImage(bmp, 0, 0)
        const d = sctx.getImageData(0, 0, w, h).data

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

        // máscara branca onde mantém, transparente onde é fundo
        const maskCv = document.createElement('canvas')
        maskCv.width = w
        maskCv.height = h
        const mctx = maskCv.getContext('2d')!
        const mid = mctx.createImageData(w, h)
        for (let i = 0; i < w * h; i++) {
            const o = i * 4
            mid.data[o] = 255
            mid.data[o + 1] = 255
            mid.data[o + 2] = 255
            mid.data[o + 3] = isBg[i] ? 0 : 255
        }
        mctx.putImageData(mid, 0, 0)

        const outCv = document.createElement('canvas')
        outCv.width = w
        outCv.height = h
        const octx = outCv.getContext('2d')!
        octx.drawImage(src, 0, 0)
        octx.globalCompositeOperation = 'destination-in'
        if (feather > 0) octx.filter = `blur(${feather}px)`
        octx.drawImage(maskCv, 0, 0)
        octx.filter = 'none'
        octx.globalCompositeOperation = 'source-over'
        return outCv
    }

    function processed(img: RefImage): HTMLCanvasElement | ImageBitmap {
        return img.cut ?? img.bitmap
    }

    function computeBounds(img: RefImage): Bounds | null {
        const srcW = img.bitmap.width
        const srcH = img.bitmap.height
        const scan = Math.min(1, 384 / Math.max(srcW, srcH))
        const sw = Math.max(1, Math.round(srcW * scan))
        const sh = Math.max(1, Math.round(srcH * scan))
        const c = document.createElement('canvas')
        c.width = sw
        c.height = sh
        const cx = c.getContext('2d', { willReadFrequently: true })!
        cx.drawImage(processed(img), 0, 0, sw, sh)
        const d = cx.getImageData(0, 0, sw, sh).data
        let minX = Infinity,
            minY = Infinity,
            maxX = -1,
            maxY = -1
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                if (d[(y * sw + x) * 4 + 3] > 24) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
        }
        if (maxX < 0) return null
        return {
            x: Math.max(0, Math.floor(minX / scan) - 1),
            y: Math.max(0, Math.floor(minY / scan) - 1),
            w: Math.min(srcW, Math.ceil((maxX - minX + 1) / scan) + 2),
            h: Math.min(srcH, Math.ceil((maxY - minY + 1) / scan) + 2),
        }
    }

    /** reprocessa o recorte e os limites de todas as imagens (em chunks) */
    let rebuildToken = 0
    let rebuildTimer = 0
    function scheduleRebuild(): void {
        clearTimeout(rebuildTimer)
        rebuildTimer = window.setTimeout(() => void rebuildAll(), 220)
    }
    async function rebuildAll(): Promise<void> {
        const token = ++rebuildToken
        for (let i = 0; i < images.length; i++) {
            if (token !== rebuildToken || !alive) return
            $('#norm-info').textContent = `processando ${i + 1}/${images.length}...`
            await new Promise((r) => setTimeout(r, 0))
            rebuildCut(images[i])
            images[i].bounds = computeBounds(images[i])
        }
        if (out.auto) autoSize()
        buildRows()
        render()
    }

    // ── entrada de imagens ──────────────────────────────────
    const fileInput = $<HTMLInputElement>('#norm-files')
    $('#norm-add').onclick = () => fileInput.click()
    fileInput.onchange = () => {
        if (fileInput.files?.length) void addFiles(Array.from(fileInput.files))
        fileInput.value = ''
    }
    wrap.ondragover = (e) => e.preventDefault()
    wrap.ondrop = (e) => {
        e.preventDefault()
        if (e.dataTransfer?.files?.length) void addFiles(Array.from(e.dataTransfer.files))
    }

    async function addFiles(files: File[]): Promise<void> {
        let added = 0
        for (const f of files) {
            if (!f.type.startsWith('image/')) continue
            try {
                const bmp = await createImageBitmap(f)
                if (!alive) return
                const img: RefImage = {
                    id: nextId++,
                    name: f.name.replace(/\.[^.]+$/, ''),
                    bitmap: bmp,
                    key: [0, 0, 0],
                    hasAlpha: detectAlpha(bmp),
                    mode: 'none',
                    cut: null,
                    dy: 0,
                    scale: 1,
                    bounds: null,
                }
                if (!img.hasAlpha) img.key = autoKey(bmp)
                rebuildCut(img)
                img.bounds = computeBounds(img)
                images.push(img)
                if (currentId < 0) currentId = img.id
                added++
            } catch (err) {
                console.error(err)
                toast(`FALHA AO LER ${f.name}`, true)
            }
        }
        if (!added) return
        if (out.auto) autoSize()
        buildTabs()
        buildRows()
        render()
    }

    function detectAlpha(bmp: ImageBitmap): boolean {
        const s = Math.min(1, 64 / Math.max(bmp.width, bmp.height))
        const w = Math.max(1, Math.round(bmp.width * s))
        const h = Math.max(1, Math.round(bmp.height * s))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const cx = c.getContext('2d', { willReadFrequently: true })!
        cx.drawImage(bmp, 0, 0, w, h)
        const d = cx.getImageData(0, 0, w, h).data
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true
        return false
    }

    // ── remoção de fundo: controles ─────────────────────────
    const modeSelect = $<HTMLSelectElement>('#n-mode')
    modeSelect.value = removal.mode
    modeSelect.onchange = () => {
        removal.mode = modeSelect.value as typeof removal.mode
        scheduleRebuild()
    }

    function bindSlider(rangeSel: string, valSel: string, initial: number, apply: (v: number) => void): void {
        const el = $<HTMLInputElement>(rangeSel)
        el.value = String(initial)
        $(valSel).textContent = el.value
        el.oninput = () => {
            $(valSel).textContent = el.value
            apply(Number(el.value))
            scheduleRebuild()
        }
    }
    bindSlider('#n-tol', '#n-tol-val', removal.tol, (v) => {
        removal.tol = v
    })
    bindSlider('#n-feather', '#n-feather-val', removal.feather * 10, (v) => {
        removal.feather = v / 10
    })
    bindSlider('#n-sim', '#n-sim-val', Math.round(settings.similarity * 1000), (v) => {
        settings.similarity = v / 1000
    })
    bindSlider('#n-smooth', '#n-smooth-val', Math.round(settings.smoothness * 1000), (v) => {
        settings.smoothness = v / 1000
    })

    // ── dimensões de saída ──────────────────────────────────
    const wInput = $<HTMLInputElement>('#nout-w')
    const hInput = $<HTMLInputElement>('#nout-h')
    const groundInput = $<HTMLInputElement>('#nout-ground')
    const bgInput = $<HTMLInputElement>('#nout-bg')
    groundInput.value = String(out.ground)
    bgInput.value = out.bg

    function autoSize(): void {
        let maxW = 0
        let maxH = 0
        for (const img of images) {
            if (!img.bounds) continue
            maxW = Math.max(maxW, img.bounds.w * img.scale)
            maxH = Math.max(maxH, img.bounds.h * img.scale)
        }
        if (!maxW) return
        out.w = Math.ceil(maxW) + 64
        out.h = Math.ceil(maxH) + out.ground + 48
        wInput.value = String(out.w)
        hInput.value = String(out.h)
    }

    wInput.oninput = () => {
        out.w = Math.max(32, Math.floor(Number(wInput.value) || 0))
        out.auto = false
        render()
    }
    hInput.oninput = () => {
        out.h = Math.max(32, Math.floor(Number(hInput.value) || 0))
        out.auto = false
        render()
    }
    $('#btn-nauto').onclick = () => {
        out.auto = true
        autoSize()
        render()
    }
    groundInput.oninput = () => {
        out.ground = Math.max(0, Math.floor(Number(groundInput.value) || 0))
        if (out.auto) autoSize()
        render()
    }
    bgInput.oninput = () => {
        out.bg = bgInput.value
        render()
    }

    // ── tabs e linhas ───────────────────────────────────────
    const MODE_TAG: Record<CutMode, string> = { none: 'alpha', flood: 'sólido', chroma: 'chroma' }

    function buildTabs(): void {
        const tabs = $('#norm-tabs')
        tabs.innerHTML = ''
        for (const img of images) {
            const b = document.createElement('button')
            b.className = 'chip' + (img.id === currentId ? ' active' : '')
            b.textContent = img.name.toUpperCase().slice(0, 22)
            b.onclick = () => {
                currentId = img.id
                buildTabs()
                render()
            }
            tabs.append(b)
        }
    }

    function buildRows(): void {
        const rows = $('#norm-rows')
        rows.innerHTML = ''
        for (const img of images) {
            const row = document.createElement('div')
            row.className = 'align-row'
            const name = document.createElement('span')
            name.className = 'ar-name'
            name.textContent = `${img.name}${img.bounds ? '' : ' ⚠'} (${MODE_TAG[img.mode]})`
            name.title = img.bounds ? 'clique para ver no preview' : 'nenhum conteúdo detectado'
            name.onclick = () => {
                currentId = img.id
                buildTabs()
                render()
            }
            row.append(name)
            row.append(
                miniInput('Y', img.dy, 1, (v) => {
                    img.dy = v
                }),
            )
            row.append(
                miniInput('ESC', img.scale, 0.05, (v) => {
                    img.scale = Math.max(0.05, v)
                }),
            )
            const del = document.createElement('button')
            del.className = 'btn btn-small danger'
            del.textContent = 'X'
            del.onclick = () => {
                const idx = images.findIndex((i) => i.id === img.id)
                if (idx >= 0) images.splice(idx, 1)
                if (currentId === img.id) currentId = images[0]?.id ?? -1
                if (out.auto) autoSize()
                buildTabs()
                buildRows()
                render()
            }
            row.append(del)
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
            if (out.auto) autoSize()
            render()
        }
        wrapEl.append(span, input)
        return wrapEl
    }

    $('#btn-equalize').onclick = () => {
        const ref = images.find((i) => i.bounds)
        if (!ref?.bounds) return
        const target = ref.bounds.h * ref.scale
        for (const img of images) {
            if (img.bounds) img.scale = Math.round((target / img.bounds.h) * 100) / 100
        }
        if (out.auto) autoSize()
        buildRows()
        render()
        toast('ALTURAS IGUALADAS PELA 1ª IMAGEM')
    }

    // ── preview ─────────────────────────────────────────────
    function resizeCanvas(): void {
        const r = wrap.getBoundingClientRect()
        cv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
        cv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
        render()
    }

    function compose(
        target: CanvasRenderingContext2D,
        img: RefImage,
        vs: number,
        ox: number,
        oy: number,
    ): void {
        const b = img.bounds
        if (!b) return
        const s = img.scale
        const ax = b.x + b.w / 2
        const ay = b.y + b.h
        const feetY = out.h - out.ground + img.dy
        const src = processed(img)
        target.drawImage(
            src,
            ox + (out.w / 2 - ax * s) * vs,
            oy + (feetY - ay * s) * vs,
            src.width * s * vs,
            src.height * s * vs,
        )
    }

    function render(): void {
        ctx.clearRect(0, 0, cv.width, cv.height)
        const img = current()
        if (!img || !out.w || !out.h) {
            ctx.font = `${13 * devicePixelRatio}px Silkscreen, monospace`
            ctx.fillStyle = '#75896d'
            ctx.textAlign = 'center'
            ctx.fillText('ADICIONE IMAGENS DE REFERÊNCIA', cv.width / 2, cv.height / 2)
            $('#norm-info').textContent = ''
            return
        }
        const vs = Math.min((cv.width * 0.92) / out.w, (cv.height * 0.92) / out.h)
        lastVs = vs
        const ox = (cv.width - out.w * vs) / 2
        const oy = (cv.height - out.h * vs) / 2

        // fundo chroma (é o resultado real da exportação)
        ctx.fillStyle = out.bg
        ctx.fillRect(ox, oy, out.w * vs, out.h * vs)

        ctx.save()
        ctx.beginPath()
        ctx.rect(ox, oy, out.w * vs, out.h * vs)
        ctx.clip()
        compose(ctx, img, vs, ox, oy)
        ctx.restore()

        // linha do chão + pivô
        const gy = oy + (out.h - out.ground) * vs
        ctx.strokeStyle = 'rgba(255, 79, 216, 0.7)'
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(ox, gy)
        ctx.lineTo(ox + out.w * vs, gy)
        ctx.stroke()
        ctx.setLineDash([])
        const px = ox + (out.w / 2) * vs
        ctx.strokeStyle = 'rgba(255, 79, 216, 0.9)'
        ctx.beginPath()
        ctx.moveTo(px - 10, gy)
        ctx.lineTo(px + 10, gy)
        ctx.moveTo(px, gy - 10)
        ctx.lineTo(px, gy + 10)
        ctx.stroke()

        // moldura
        ctx.strokeStyle = 'rgba(82, 255, 122, 0.5)'
        ctx.strokeRect(ox + 0.5, oy + 0.5, out.w * vs, out.h * vs)

        $('#norm-info').textContent =
            `${images.length} imagens · saída ${out.w}×${out.h}px · chão a ${out.ground}px da base`
    }

    // arraste vertical no preview ajusta o Y da imagem atual
    let dragRef: { startY: number; startDy: number } | null = null
    cv.onpointerdown = (e) => {
        if (!current()) return
        dragRef = { startY: e.clientY, startDy: current()!.dy }
        cv.setPointerCapture(e.pointerId)
    }
    cv.onpointermove = (e) => {
        if (!dragRef) return
        const img = current()
        if (!img) return
        img.dy = Math.round(dragRef.startDy + ((e.clientY - dragRef.startY) * devicePixelRatio) / lastVs)
        render()
    }
    cv.onpointerup = () => {
        if (!dragRef) return
        dragRef = null
        buildRows()
    }

    // ── exportação ──────────────────────────────────────────
    const exportBtn = $<HTMLButtonElement>('#btn-norm-export')
    exportBtn.onclick = async () => {
        const ok = images.filter((i) => i.bounds)
        if (!ok.length || !out.w || !out.h) {
            toast('NENHUMA IMAGEM PARA EXPORTAR', true)
            return
        }
        exportBtn.disabled = true
        try {
            for (let i = 0; i < ok.length; i++) {
                exportBtn.textContent = `GERANDO ${i + 1}/${ok.length}...`
                const c = document.createElement('canvas')
                c.width = out.w
                c.height = out.h
                const cx = c.getContext('2d')!
                cx.fillStyle = out.bg
                cx.fillRect(0, 0, out.w, out.h)
                cx.imageSmoothingEnabled = ok[i].scale < 1
                cx.imageSmoothingQuality = 'high'
                compose(cx, ok[i], 1, 0, 0)
                const png = await new Promise<Blob>((resolve, reject) => {
                    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG'))), 'image/png')
                })
                downloadBlob(png, `${ok[i].name}_chroma.png`)
                await new Promise((r) => setTimeout(r, 250))
            }
            toast(`${ok.length} IMAGENS EXPORTADAS ✓`)
        } catch (err) {
            console.error(err)
            toast('ERRO AO EXPORTAR', true)
        } finally {
            exportBtn.disabled = false
            exportBtn.textContent = 'EXPORTAR IMAGENS_'
        }
    }

    // ── inicialização / teardown ────────────────────────────
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()
    buildTabs()
    buildRows()

    return () => {
        alive = false
        clearTimeout(rebuildTimer)
        rebuildToken++
        window.removeEventListener('resize', resizeCanvas)
        images.forEach((i) => i.bitmap.close())
    }
}
