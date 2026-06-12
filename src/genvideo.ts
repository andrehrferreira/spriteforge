/**
 * Gerador de vídeo via OpenRouter (grok-imagine-video): seleciona imagens
 * de referência salvas no projeto, monta o prompt com as diretrizes de
 * sprite sheet, faz polling do job e devolve o vídeo para baixar ou
 * importar direto como animação.
 */

import { uid } from './db'
import { downloadBlob } from './export'
import { saveProject, state } from './state'
import { toast } from './toast'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

const API_BASE = 'https://openrouter.ai/api/v1/videos'
const KEY_INFO_URL = 'https://openrouter.ai/api/v1/key'
const DEFAULT_MODEL = 'x-ai/grok-imagine-video'
const MAX_REFS = 7

const LS = {
    key: 'sf-or-key',
    model: 'sf-or-model',
    prompt: 'sf-gv-prompt',
    directives: 'sf-gv-directives2', // v2: regras reescritas como restrições positivas
    duration: 'sf-gv-duration',
    loop: 'sf-gv-loop',
    imgmode: 'sf-gv-imgmode',
    size: 'sf-gv-size',
}

const DEFAULT_DIRECTIVES = `vídeo para geração de sprite sheet de jogo
fundo de cor sólida fixa #00b140, uniforme, sem degradê e sem sombras
sem áudio
animação simples e contida
o personagem permanece exatamente no mesmo lugar (pivô fixo), sem se deslocar pelo quadro
a cabeça e o rosto ficam TRAVADOS na mesma direção da imagem de referência, do primeiro ao último frame
o personagem mantém o olhar fixo nessa direção o tempo inteiro: a cabeça permanece em perfil, sem virar para a câmera e sem mudar o ângulo
armas e membros permanecem dentro da área do frame durante todo o vídeo
a arma permanece na mesma mão do início ao fim
sequência de movimento coesa e contínua
câmera 100% estática e travada: sem zoom, sem pan, sem cortes, sem mudança de enquadramento`

const LOOP_LINE =
    'a animação é em looping: o último frame precisa terminar exatamente igual ao primeiro frame'

/** contrato de cada modelo (GET /api/v1/videos/models) */
interface ModelCfg {
    sizes: string[]
    durations: number[]
    /** aceita o parâmetro generate_audio (enviamos false) */
    sendAudioOff: boolean
    /** suporta last_frame — permite fechar o loop por construção */
    lastFrame: boolean
    /** preço por segundo, ou null quando a cobrança é por tokens */
    pricePerSec: ((size: string) => number) | null
}

const MODELS: Record<string, ModelCfg> = {
    'x-ai/grok-imagine-video': {
        sizes: [
            '480x480',
            '720x720',
            '640x480',
            '960x720',
            '854x480',
            '1280x720',
            '720x480',
            '1080x720',
            '480x640',
            '720x960',
            '480x854',
            '720x1280',
            '480x720',
            '720x1080',
        ],
        durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        sendAudioOff: false, // grok não aceita generate_audio
        lastFrame: false,
        pricePerSec: (size) => {
            const [w, h] = size.split('x').map(Number)
            return Math.max(w, h) >= 720 ? 0.07 : 0.05
        },
    },
    'bytedance/seedance-2.0': {
        sizes: [
            '480x480',
            '480x640',
            '480x854',
            '640x480',
            '854x480',
            '1120x480',
            '720x720',
            '720x960',
            '720x1280',
            '720x1680',
            '960x720',
            '1280x720',
            '1680x720',
            '1080x1080',
            '1080x1440',
            '1080x1920',
            '1440x1080',
            '1920x1080',
            '2520x1080',
        ],
        durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        sendAudioOff: true,
        lastFrame: true,
        pricePerSec: null, // cobrança por tokens de vídeo
    },
}

export function initGenVideo(opts: { onUse: (file: File) => void }): () => void {
    const project = state.project!
    let alive = true
    let running = false
    let cancelled = false
    let resultBlob: Blob | null = null
    let resultUrl: string | null = null
    let elapsedTimer = 0

    // seleção de referências (ids) — começa com as primeiras 7 do projeto
    const selected = new Set<string>()
    project.refs.slice(0, MAX_REFS).forEach((r) => selected.add(r.id))
    const urlMap = new Map<string, string>()

    function refUrl(id: string, blob: Blob): string {
        let u = urlMap.get(id)
        if (!u) {
            u = URL.createObjectURL(blob)
            urlMap.set(id, u)
        }
        return u
    }

    // ── campos persistidos ──────────────────────────────────
    const keyInput = $<HTMLInputElement>('#gv-key')
    const modelSelect = $<HTMLSelectElement>('#gv-model')
    const promptInput = $<HTMLTextAreaElement>('#gv-prompt')
    const directivesInput = $<HTMLTextAreaElement>('#gv-directives')
    const durationSelect = $<HTMLSelectElement>('#gv-duration')
    const loopToggle = $<HTMLInputElement>('#gv-loop')
    const imgModeSelect = $<HTMLSelectElement>('#gv-imgmode')
    const sizeSelect = $<HTMLSelectElement>('#gv-size')

    /** chave saneada: remove espaços, quebras de linha e aspas de cópia/cola */
    function cleanKey(): string {
        return keyInput.value.replace(/["'\s]+/g, '')
    }

    function authHeaders(): Record<string, string> {
        return {
            Authorization: `Bearer ${cleanKey()}`,
            'HTTP-Referer': location.origin,
            'X-Title': 'SpriteForge',
        }
    }

    /** extrai a mensagem de erro do corpo JSON do OpenRouter, se houver */
    function apiError(status: number, bodyText: string): string {
        try {
            const j = JSON.parse(bodyText) as { error?: { message?: string } }
            if (j.error?.message) return `HTTP ${status}: ${j.error.message}`
        } catch {
            /* corpo não é JSON */
        }
        return `HTTP ${status}: ${bodyText.slice(0, 300)}`
    }

    keyInput.value = localStorage.getItem(LS.key) ?? ''
    modelSelect.value = localStorage.getItem(LS.model) ?? DEFAULT_MODEL
    if (!modelSelect.value) modelSelect.value = DEFAULT_MODEL // valor antigo fora da lista

    function modelCfg(): ModelCfg {
        return MODELS[modelSelect.value] ?? MODELS[DEFAULT_MODEL]
    }

    /** repovoa tamanho/duração com o contrato do modelo, preservando a escolha */
    function syncModelOptions(): void {
        const cfg = modelCfg()
        const prevSize = sizeSelect.value || localStorage.getItem(LS.size) || '640x480'
        sizeSelect.innerHTML = cfg.sizes
            .map((s) => `<option value="${s}">${s.replace('x', '×')}</option>`)
            .join('')
        sizeSelect.value = cfg.sizes.includes(prevSize) ? prevSize : '640x480'

        const prevDur = Number(durationSelect.value || localStorage.getItem(LS.duration) || 4)
        durationSelect.innerHTML = cfg.durations.map((d) => `<option value="${d}">${d} s</option>`).join('')
        durationSelect.value = String(
            cfg.durations.includes(prevDur) ? prevDur : cfg.durations[0] >= 4 ? cfg.durations[0] : 4,
        )
        updateEstimate()
    }
    promptInput.value = localStorage.getItem(LS.prompt) ?? ''
    directivesInput.value = localStorage.getItem(LS.directives) ?? DEFAULT_DIRECTIVES
    durationSelect.value = localStorage.getItem(LS.duration) ?? '4'
    loopToggle.checked = (localStorage.getItem(LS.loop) ?? '1') === '1'
    imgModeSelect.value = localStorage.getItem(LS.imgmode) ?? 'first'
    imgModeSelect.onchange = () => localStorage.setItem(LS.imgmode, imgModeSelect.value)
    sizeSelect.onchange = () => {
        localStorage.setItem(LS.size, sizeSelect.value)
        updateEstimate()
    }

    $<HTMLButtonElement>('#gv-dir-reset').onclick = () => {
        directivesInput.value = DEFAULT_DIRECTIVES
        localStorage.setItem(LS.directives, DEFAULT_DIRECTIVES)
        toast('DIRETRIZES RESTAURADAS')
    }

    keyInput.oninput = () => localStorage.setItem(LS.key, keyInput.value.trim())
    modelSelect.onchange = () => {
        localStorage.setItem(LS.model, modelSelect.value)
        syncModelOptions()
    }

    $<HTMLButtonElement>('#gv-test').onclick = async () => {
        const key = cleanKey()
        if (!key) {
            toast('COLE A API KEY PRIMEIRO', true)
            return
        }
        setStatus(`TESTANDO CHAVE (sk-...${key.slice(-4)})...`)
        try {
            const res = await fetch(KEY_INFO_URL, { headers: authHeaders() })
            const text = await res.text()
            if (!res.ok) {
                setStatus(`CHAVE RECUSADA — ${apiError(res.status, text)}`, true)
                return
            }
            const info = JSON.parse(text) as {
                data?: { label?: string; usage?: number; limit?: number | null }
            }
            const d = info.data
            setStatus(
                `CHAVE OK ✓ ${d?.label ?? ''} · uso $${(d?.usage ?? 0).toFixed(2)}` +
                    (d?.limit != null ? ` / limite $${d.limit.toFixed(2)}` : ''),
            )
            toast('CHAVE VÁLIDA ✓')
        } catch (err) {
            setStatus(`FALHA NO TESTE: ${err instanceof Error ? err.message : String(err)}`, true)
        }
    }
    promptInput.oninput = () => localStorage.setItem(LS.prompt, promptInput.value)
    directivesInput.oninput = () => localStorage.setItem(LS.directives, directivesInput.value)
    durationSelect.onchange = () => {
        localStorage.setItem(LS.duration, durationSelect.value)
        updateEstimate()
    }
    loopToggle.onchange = () => localStorage.setItem(LS.loop, loopToggle.checked ? '1' : '0')

    function updateEstimate(): void {
        const s = Number(durationSelect.value)
        const cfg = modelCfg()
        const c = cfg.pricePerSec ? cfg.pricePerSec(sizeSelect.value) : null
        $('#gv-estimate').textContent =
            (c != null
                ? `≈ $${(s * c).toFixed(2)} por geração`
                : 'custo por tokens de vídeo (ver OpenRouter)') +
            ` · ${sizeSelect.value.replace('x', '×')} · sem áudio`
    }
    syncModelOptions()

    // ── referências do projeto ──────────────────────────────
    const refsBox = $('#gv-refs')
    const fileInput = $<HTMLInputElement>('#gv-files')
    $('#gv-add').onclick = () => fileInput.click()
    fileInput.onchange = () => {
        if (fileInput.files?.length) void addRefs(Array.from(fileInput.files))
        fileInput.value = ''
    }
    refsBox.ondragover = (e) => e.preventDefault()
    refsBox.ondrop = (e) => {
        e.preventDefault()
        if (e.dataTransfer?.files?.length) void addRefs(Array.from(e.dataTransfer.files))
    }

    async function addRefs(files: File[]): Promise<void> {
        let added = 0
        for (const f of files) {
            if (!f.type.startsWith('image/')) continue
            const ref = { id: uid(), name: f.name, blob: f as Blob }
            project.refs.push(ref)
            if (selected.size < MAX_REFS) selected.add(ref.id)
            added++
        }
        if (!added) return
        await saveProject()
        renderRefs()
        toast(`${added} REFERÊNCIA${added > 1 ? 'S' : ''} SALVA${added > 1 ? 'S' : ''} NO PROJETO`)
    }

    function renderRefs(): void {
        refsBox.innerHTML = ''
        if (!project.refs.length) {
            const hint = document.createElement('span')
            hint.className = 'dim refs-empty'
            hint.textContent = 'o projeto ainda não tem referências — adicione com o botão acima'
            refsBox.append(hint)
        }
        for (const ref of project.refs) {
            const cell = document.createElement('button')
            cell.className = 'gv-ref' + (selected.has(ref.id) ? ' sel' : '')
            cell.title = ref.name
            const img = document.createElement('img')
            img.src = refUrl(ref.id, ref.blob)
            cell.append(img)
            cell.onclick = () => {
                if (selected.has(ref.id)) {
                    selected.delete(ref.id)
                } else if (selected.size >= MAX_REFS) {
                    toast(`MÁXIMO DE ${MAX_REFS} REFERÊNCIAS POR GERAÇÃO`, true)
                    return
                } else {
                    selected.add(ref.id)
                }
                renderRefs()
            }
            refsBox.append(cell)
        }
        $('#gv-refs-count').textContent = `${selected.size}/${MAX_REFS}`
    }

    // ── prompt final ────────────────────────────────────────
    function fullPrompt(): string {
        const lines = directivesInput.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        if (loopToggle.checked) lines.push(LOOP_LINE)
        return `${promptInput.value.trim()}\n\nDiretrizes obrigatórias:\n${lines.map((l) => `- ${l}`).join('\n')}`
    }

    /**
     * Prepara a referência para o envio: reduz para no máx. 1024px e
     * re-codifica em JPEG sobre fundo chroma — payloads de base64 grandes
     * derrubam a geração no provedor com "internal error".
     */
    async function prepRef(blob: Blob): Promise<string> {
        const bmp = await createImageBitmap(blob)
        const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
        const w = Math.max(1, Math.round(bmp.width * s))
        const h = Math.max(1, Math.round(bmp.height * s))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')!
        ctx.fillStyle = '#00b140'
        ctx.fillRect(0, 0, w, h)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bmp, 0, 0, w, h)
        bmp.close()
        return cv.toDataURL('image/jpeg', 0.9)
    }

    // ── geração ─────────────────────────────────────────────
    const genBtn = $<HTMLButtonElement>('#btn-generate')
    const statusEl = $('#gv-status')
    const video = $<HTMLVideoElement>('#gv-video')
    const downloadBtn = $<HTMLButtonElement>('#btn-gv-download')
    const useBtn = $<HTMLButtonElement>('#btn-gv-use')

    function setStatus(msg: string, error = false): void {
        statusEl.textContent = msg ? `· ${msg}` : ''
        statusEl.classList.toggle('warn', error)
    }

    function setLoading(on: boolean): void {
        $('#gv-loading').classList.toggle('hidden', !on)
    }

    function setResult(blob: Blob | null): void {
        resultBlob = blob
        if (resultUrl) {
            URL.revokeObjectURL(resultUrl)
            resultUrl = null
        }
        if (blob) {
            resultUrl = URL.createObjectURL(blob)
            video.src = resultUrl
            video.classList.remove('hidden')
            void video.play().catch(() => undefined)
        } else {
            video.removeAttribute('src')
            video.classList.add('hidden')
        }
        downloadBtn.disabled = !blob
        useBtn.disabled = !blob
    }

    genBtn.onclick = () => {
        if (running) {
            cancelled = true
            setStatus('CANCELADO (o job continua no OpenRouter, mas foi descartado aqui)')
            finishRun()
            return
        }
        void generate()
    }

    function finishRun(): void {
        running = false
        clearInterval(elapsedTimer)
        setLoading(false)
        genBtn.textContent = 'GERAR VÍDEO_'
        genBtn.classList.remove('armed')
    }

    async function generate(): Promise<void> {
        const key = cleanKey()
        if (!key) {
            toast('INFORME A API KEY DO OPENROUTER', true)
            keyInput.focus()
            return
        }
        if (!promptInput.value.trim()) {
            toast('DESCREVA A ANIMAÇÃO NO PROMPT', true)
            promptInput.focus()
            return
        }
        const chosen = project.refs.filter((r) => selected.has(r.id))
        running = true
        cancelled = false
        setResult(null)
        setLoading(true)
        $('#gv-loading-time').textContent = '0s'
        genBtn.textContent = 'CANCELAR'
        genBtn.classList.add('armed')
        $('#gv-cost').textContent = ''

        const startedAt = Date.now()
        const elapsed = (): string => `${Math.round((Date.now() - startedAt) / 1000)}s`

        try {
            setStatus('PREPARANDO REFERÊNCIAS...')
            const dataUrls = await Promise.all(chosen.map((r) => prepRef(r.blob)))

            setStatus('ENVIANDO REQUISIÇÃO...')
            const cfg = modelCfg()
            const body: Record<string, unknown> = {
                model: modelSelect.value || DEFAULT_MODEL,
                prompt: fullPrompt(),
                duration: Number(durationSelect.value),
                size: sizeSelect.value,
            }
            // grok não aceita generate_audio (contrato lista null); seedance aceita
            if (cfg.sendAudioOff) body.generate_audio = false
            // a xAI não aceita frame_images e input_references na mesma requisição —
            // os modos são exclusivos
            const asImageUrl = (url: string): object => ({ type: 'image_url', image_url: { url } })
            if (dataUrls.length) {
                if (imgModeSelect.value === 'first') {
                    // image-to-video: só a 1ª referência selecionada, como frame inicial
                    const frameImgs: object[] = [{ ...asImageUrl(dataUrls[0]), frame_type: 'first_frame' }]
                    // modelos com last_frame (seedance) + loop: termina na mesma
                    // imagem do início → loop perfeito por construção
                    if (cfg.lastFrame && loopToggle.checked) {
                        frameImgs.push({ ...asImageUrl(dataUrls[0]), frame_type: 'last_frame' })
                    }
                    body.frame_images = frameImgs
                    if (dataUrls.length > 1) toast('MODO FRAME INICIAL: USANDO SÓ A 1ª REFERÊNCIA')
                } else {
                    body.input_references = dataUrls.map(asImageUrl)
                }
            }

            const res = await fetch(API_BASE, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            if (!res.ok) {
                const msg = apiError(res.status, await res.text())
                if (res.status === 401) {
                    throw new Error(
                        `${msg} — chave recusada; use TESTAR e confira em openrouter.ai/settings/keys`,
                    )
                }
                if (res.status === 402) {
                    throw new Error(`${msg} — créditos insuficientes no OpenRouter`)
                }
                throw new Error(msg)
            }
            const job = (await res.json()) as { id: string; polling_url?: string }
            const pollUrl = job.polling_url ?? `${API_BASE}/${job.id}`

            elapsedTimer = window.setInterval(() => {
                if (running && !cancelled) {
                    setStatus(`GERANDO... ${elapsed()}`)
                    $('#gv-loading-time').textContent = elapsed()
                }
            }, 1000)

            for (;;) {
                await new Promise((r) => setTimeout(r, 10000))
                if (cancelled || !alive) return
                let poll: {
                    status: string
                    unsigned_urls?: string[]
                    error?: unknown
                    usage?: { cost?: number }
                }
                try {
                    const pr = await fetch(pollUrl, { headers: authHeaders() })
                    if (!pr.ok) continue // erro transitório de polling: tenta de novo
                    poll = await pr.json()
                } catch {
                    continue
                }
                if (cancelled || !alive) return

                if (poll.status === 'completed') {
                    setStatus(`BAIXANDO VÍDEO... ${elapsed()}`)
                    const contentUrl = poll.unsigned_urls?.[0] ?? `${API_BASE}/${job.id}/content?index=0`
                    const vres = await fetch(contentUrl, { headers: authHeaders() })
                    if (!vres.ok) throw new Error(`falha ao baixar o vídeo (HTTP ${vres.status})`)
                    const blob = await vres.blob()
                    if (cancelled || !alive) return
                    setResult(blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' }))
                    setStatus(`PRONTO ✓ ${elapsed()}`)
                    if (poll.usage?.cost != null) {
                        $('#gv-cost').textContent = `custo: $${poll.usage.cost.toFixed(3)}`
                    }
                    toast('VÍDEO GERADO ✓')
                    return
                }
                if (poll.status === 'failed') {
                    const detail =
                        typeof poll.error === 'string'
                            ? poll.error
                            : JSON.stringify(poll.error ?? 'sem detalhes')
                    throw new Error(`geração falhou: ${detail.slice(0, 300)} (job ${job.id})`)
                }
            }
        } catch (err) {
            console.error(err)
            setStatus(`ERRO: ${err instanceof Error ? err.message : String(err)}`, true)
            toast('FALHA NA GERAÇÃO', true)
        } finally {
            finishRun()
        }
    }

    // ── resultado ───────────────────────────────────────────
    downloadBtn.onclick = () => {
        if (!resultBlob) return
        downloadBlob(resultBlob, `${slugify(promptInput.value) || 'animacao'}.mp4`)
    }

    useBtn.onclick = () => {
        if (!resultBlob) return
        const file = new File([resultBlob], `${slugify(promptInput.value) || 'animacao'}.mp4`, {
            type: 'video/mp4',
        })
        opts.onUse(file)
    }

    setResult(null)
    renderRefs()
    setStatus(project.refs.length ? '' : 'adicione referências do personagem')

    return () => {
        alive = false
        cancelled = true
        clearInterval(elapsedTimer)
        if (resultUrl) URL.revokeObjectURL(resultUrl)
        urlMap.forEach((u) => URL.revokeObjectURL(u))
    }
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\w-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40)
}
