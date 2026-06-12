/**
 * Gerador de imagens via OpenRouter (chat/completions com modalities
 * ["image","text"]): cria imagens de referência de personagem a partir de
 * prompt + referências opcionais (image-to-image). As imagens geradas podem
 * ser baixadas ou adicionadas direto às referências do projeto aberto.
 */

import { uid } from './db'
import { downloadBlob, slugify } from './export'
import { saveProject, state } from './state'
import { toast } from './toast'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

const API = 'https://openrouter.ai/api/v1/chat/completions'

const LS = {
    key: 'sf-or-key', // compartilhada com o gerador de vídeo
    model: 'sf-gi-model',
    prompt: 'sf-gi-prompt',
    aspect: 'sf-gi-aspect',
    size: 'sf-gi-size',
}

export const IMAGE_MODELS = [
    { id: 'google/gemini-3.1-flash-image-preview', name: 'Google · Gemini 3.1 Flash Image' },
    { id: 'google/gemini-3-pro-image-preview', name: 'Google · Gemini 3 Pro Image' },
    { id: 'x-ai/grok-imagine-image-quality', name: 'xAI · Grok Imagine Image (quality)' },
    { id: 'openai/gpt-5.4-image-2', name: 'OpenAI · GPT-5.4 Image 2' },
] as const

/** extrai as data URLs das imagens de uma resposta do chat/completions */
export function extractImages(response: unknown): string[] {
    if (!response || typeof response !== 'object') return []
    const r = response as {
        choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]
    }
    const images = r.choices?.[0]?.message?.images
    if (!Array.isArray(images)) return []
    return images
        .map((i) => i.image_url?.url)
        .filter((u): u is string => typeof u === 'string' && u.startsWith('data:image/'))
}

/** data URL → Blob (sem fetch, para funcionar offline) */
export function dataUrlToBlob(dataUrl: string): Blob {
    const [head, body] = dataUrl.split(',', 2)
    const mime = head.match(/^data:([^;]+)/)?.[1] ?? 'image/png'
    const bin = atob(body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
}

interface GalleryItem {
    dataUrl: string
    prompt: string
}

export function initGenImage(): () => void {
    let alive = true
    let running = false
    const refs: string[] = [] // data URLs das referências anexadas
    const gallery: GalleryItem[] = []
    let currentIdx = -1

    const keyInput = $<HTMLInputElement>('#gi-key')
    const modelSelect = $<HTMLSelectElement>('#gi-model')
    const promptInput = $<HTMLTextAreaElement>('#gi-prompt')
    const aspectSelect = $<HTMLSelectElement>('#gi-aspect')
    const sizeSelect = $<HTMLSelectElement>('#gi-size')

    modelSelect.innerHTML = IMAGE_MODELS.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')
    keyInput.value = localStorage.getItem(LS.key) ?? ''
    modelSelect.value = localStorage.getItem(LS.model) ?? IMAGE_MODELS[0].id
    if (!modelSelect.value) modelSelect.value = IMAGE_MODELS[0].id
    promptInput.value = localStorage.getItem(LS.prompt) ?? ''
    aspectSelect.value = localStorage.getItem(LS.aspect) ?? '1:1'
    sizeSelect.value = localStorage.getItem(LS.size) ?? '1K'

    keyInput.oninput = () => localStorage.setItem(LS.key, keyInput.value.trim())
    modelSelect.onchange = () => localStorage.setItem(LS.model, modelSelect.value)
    promptInput.oninput = () => localStorage.setItem(LS.prompt, promptInput.value)
    aspectSelect.onchange = () => localStorage.setItem(LS.aspect, aspectSelect.value)
    sizeSelect.onchange = () => localStorage.setItem(LS.size, sizeSelect.value)

    function status(msg: string, error = false): void {
        const el = $('#gi-status')
        el.textContent = msg ? `· ${msg}` : ''
        el.classList.toggle('warn', error)
    }

    // ── referências anexadas ────────────────────────────────
    const refsBox = $('#gi-refs')
    const fileInput = $<HTMLInputElement>('#gi-files')
    $('#gi-add').onclick = () => fileInput.click()
    fileInput.onchange = () => {
        if (fileInput.files?.length) void addRefs(Array.from(fileInput.files))
        fileInput.value = ''
    }

    async function addRefs(files: File[]): Promise<void> {
        for (const f of files) {
            if (!f.type.startsWith('image/')) continue
            const url = await new Promise<string>((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(r.result as string)
                r.onerror = () => reject(new Error('falha ao ler'))
                r.readAsDataURL(f)
            })
            if (!alive) return
            refs.push(url)
        }
        renderRefs()
    }

    function renderRefs(): void {
        refsBox.innerHTML = ''
        refs.forEach((url, i) => {
            const cell = document.createElement('div')
            cell.className = 'gv-ref sel'
            const img = document.createElement('img')
            img.src = url
            const del = document.createElement('button')
            del.className = 'ref-del'
            del.textContent = '×'
            del.onclick = () => {
                refs.splice(i, 1)
                renderRefs()
            }
            cell.append(img, del)
            refsBox.append(cell)
        })
        $('#gi-refs-count').textContent = String(refs.length)
    }

    // ── galeria ─────────────────────────────────────────────
    const bigImg = $<HTMLImageElement>('#gi-big')

    function renderGallery(): void {
        const strip = $('#gi-gallery')
        strip.innerHTML = ''
        gallery.forEach((g, i) => {
            const cell = document.createElement('button')
            cell.className = 'gv-ref' + (i === currentIdx ? ' sel' : '')
            cell.title = g.prompt
            const img = document.createElement('img')
            img.src = g.dataUrl
            cell.append(img)
            cell.onclick = () => {
                currentIdx = i
                renderGallery()
                showCurrent()
            }
            strip.append(cell)
        })
        showCurrent()
    }

    function showCurrent(): void {
        const g = currentIdx >= 0 ? gallery[currentIdx] : null
        if (g) {
            bigImg.src = g.dataUrl
            bigImg.classList.remove('hidden')
        } else {
            bigImg.removeAttribute('src')
            bigImg.classList.add('hidden')
        }
        $<HTMLButtonElement>('#gi-download').disabled = !g
        const useBtn = $<HTMLButtonElement>('#gi-use')
        useBtn.classList.toggle('hidden', !state.project)
        useBtn.disabled = !g
    }

    // ── geração ─────────────────────────────────────────────
    const genBtn = $<HTMLButtonElement>('#gi-generate')
    genBtn.onclick = () => void generate()

    async function generate(): Promise<void> {
        if (running) return
        const key = keyInput.value.replace(/["'\s]+/g, '')
        if (!key) {
            toast('INFORME A API KEY DO OPENROUTER', true)
            keyInput.focus()
            return
        }
        const prompt = promptInput.value.trim()
        if (!prompt) {
            toast('DESCREVA A IMAGEM NO PROMPT', true)
            promptInput.focus()
            return
        }
        running = true
        genBtn.disabled = true
        genBtn.textContent = 'GERANDO...'
        status('GERANDO IMAGEM...')
        try {
            const content: unknown = refs.length
                ? [
                      { type: 'text', text: prompt },
                      ...refs.map((url) => ({ type: 'image_url', image_url: { url } })),
                  ]
                : prompt
            const res = await fetch(API, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': location.origin,
                    'X-Title': 'SpriteForge',
                },
                body: JSON.stringify({
                    model: modelSelect.value,
                    messages: [{ role: 'user', content }],
                    modalities: ['image', 'text'],
                    image_config: {
                        aspect_ratio: aspectSelect.value,
                        image_size: sizeSelect.value,
                    },
                }),
            })
            const text = await res.text()
            if (!res.ok) {
                let msg = `HTTP ${res.status}`
                try {
                    const j = JSON.parse(text) as { error?: { message?: string } }
                    if (j.error?.message) msg = `${msg}: ${j.error.message}`
                } catch {
                    /* corpo não é JSON */
                }
                throw new Error(msg)
            }
            const images = extractImages(JSON.parse(text))
            if (!alive) return
            if (!images.length) {
                throw new Error('o modelo não devolveu imagem — tente outro modelo ou reformule o prompt')
            }
            for (const url of images) gallery.push({ dataUrl: url, prompt })
            currentIdx = gallery.length - 1
            renderGallery()
            status(`PRONTO ✓ ${images.length} imagem(ns)`)
            toast('IMAGEM GERADA ✓')
        } catch (err) {
            console.error(err)
            status(`ERRO: ${err instanceof Error ? err.message : String(err)}`, true)
            toast('FALHA NA GERAÇÃO', true)
        } finally {
            running = false
            genBtn.disabled = false
            genBtn.textContent = 'GERAR IMAGEM_'
        }
    }

    // ── ações do resultado ──────────────────────────────────
    $<HTMLButtonElement>('#gi-download').onclick = () => {
        const g = currentIdx >= 0 ? gallery[currentIdx] : null
        if (!g) return
        downloadBlob(dataUrlToBlob(g.dataUrl), `${slugify(g.prompt).slice(0, 40) || 'imagem'}.png`)
    }

    $<HTMLButtonElement>('#gi-use').onclick = async () => {
        const g = currentIdx >= 0 ? gallery[currentIdx] : null
        const p = state.project
        if (!g || !p) return
        p.refs.push({
            id: uid(),
            name: `${slugify(g.prompt).slice(0, 30) || 'gerada'}.png`,
            blob: dataUrlToBlob(g.dataUrl),
        })
        await saveProject()
        toast('ADICIONADA ÀS REFERÊNCIAS DO PROJETO ✓')
    }

    // ── inicialização / teardown ────────────────────────────
    renderRefs()
    renderGallery()
    status(state.project ? `projeto aberto: ${state.project.name}` : '')

    return () => {
        alive = false
    }
}
