/**
 * Atlas de ícones: compõe um atlas único a partir da biblioteca de ícones
 * salvos pelo fatiador (store `icons`). Célula uniforme = maior tamanho
 * entre os selecionados, layout via computeLayout, preview ao vivo e
 * exportação em ZIP (PNG quantizado + manifesto JSON).
 */

import { strToU8, zipSync } from 'fflate'
import { deleteIcon, listIcons } from './db'
import { computeLayout, downloadBlob, encodeCanvas, formatBytes, MAX_SHEET_DIM, slugify } from './export'
import { toast } from './toast'
import type { IconRecord } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T

export interface AtlasIconMeta {
    name: string
    x: number
    y: number
    w: number
    h: number
}

/** manifesto do atlas de ícones (função pura, testável) */
export function buildIconManifest(
    meta: {
        name: string
        width: number
        height: number
        cell: number
        padding: number
        columns: number
        rows: number
        compression: string
    },
    icons: AtlasIconMeta[],
): string {
    return JSON.stringify(
        {
            meta: {
                app: 'SpriteForge',
                tool: 'atlas',
                version: 1,
                image: `${meta.name}.png`,
                size: { w: meta.width, h: meta.height },
                cell: meta.cell,
                padding: meta.padding,
                columns: meta.columns,
                rows: meta.rows,
                count: icons.length,
                compression: meta.compression,
            },
            icons,
        },
        null,
        2,
    )
}

export function initAtlas(): () => void {
    let alive = true
    let icons: IconRecord[] = []
    const selected = new Set<string>()
    const bitmaps = new Map<string, ImageBitmap>()

    const wrap = $('#at-wrap')
    const cv = $<HTMLCanvasElement>('#at-canvas')
    const ctx = cv.getContext('2d')!
    const colsInput = $<HTMLInputElement>('#at-cols')
    const padInput = $<HTMLInputElement>('#at-padding')
    const colorsSelect = $<HTMLSelectElement>('#at-colors')
    const nameInput = $<HTMLInputElement>('#at-name')

    // fundo do preview (transparente/preto/branco), como no fatiador
    document.querySelectorAll<HTMLButtonElement>('[data-atbg]').forEach((btn) => {
        btn.onclick = () => {
            document.querySelectorAll('[data-atbg]').forEach((b) => b.classList.remove('active'))
            btn.classList.add('active')
            const bg = btn.dataset.atbg
            const cls = bg === 'black' ? 'bg-black' : bg === 'white' ? 'bg-white' : 'checker'
            wrap.className = `preview-wrap align-wrap ${cls}`
        }
    })

    function chosen(): IconRecord[] {
        return icons.filter((i) => selected.has(i.id))
    }

    function cellSize(): number {
        return chosen().reduce((m, i) => Math.max(m, i.size), 0) || 64
    }

    function layoutNow(): ReturnType<typeof computeLayout> {
        const cell = cellSize()
        return computeLayout(Math.max(1, chosen().length), cell, cell, {
            scale: 1,
            padding: Math.max(0, Math.floor(Number(padInput.value) || 0)),
            columns: Math.max(0, Math.floor(Number(colsInput.value) || 0)),
        })
    }

    // ── biblioteca ──────────────────────────────────────────
    async function load(): Promise<void> {
        icons = (await listIcons()).sort((a, b) => a.name.localeCompare(b.name))
        if (!alive) return
        for (const i of icons) {
            if (!bitmaps.has(i.id)) {
                try {
                    bitmaps.set(i.id, await createImageBitmap(i.blob))
                } catch {
                    // blob inválido: ignora no preview
                }
            }
            if (!alive) return
        }
        icons.forEach((i) => selected.add(i.id))
        renderGrid()
        update()
    }

    function renderGrid(): void {
        const grid = $('#at-grid')
        grid.innerHTML = ''
        $('#at-count').textContent = icons.length ? `· ${selected.size}/${icons.length} no atlas` : ''
        if (!icons.length) {
            const hint = document.createElement('span')
            hint.className = 'dim refs-empty'
            hint.textContent = 'biblioteca vazia — salve ícones pelo FATIADOR (botão SALVAR P/ ATLAS)'
            grid.append(hint)
            return
        }
        for (const icon of icons) {
            const cell = document.createElement('div')
            cell.className = 'at-cell' + (selected.has(icon.id) ? ' sel' : '')
            cell.title = `${icon.name} · ${icon.size}×${icon.size}`
            const img = document.createElement('img')
            img.src = URL.createObjectURL(icon.blob)
            img.onload = () => URL.revokeObjectURL(img.src)
            const tag = document.createElement('span')
            tag.className = 'at-tag'
            tag.textContent = String(icon.size)
            const del = document.createElement('button')
            del.className = 'ref-del'
            del.textContent = '×'
            del.title = 'excluir da biblioteca'
            del.onclick = async (e) => {
                e.stopPropagation()
                await deleteIcon(icon.id)
                bitmaps.get(icon.id)?.close()
                bitmaps.delete(icon.id)
                selected.delete(icon.id)
                icons = icons.filter((i) => i.id !== icon.id)
                renderGrid()
                update()
            }
            cell.onclick = () => {
                if (selected.has(icon.id)) selected.delete(icon.id)
                else selected.add(icon.id)
                renderGrid()
                update()
            }
            cell.append(img, tag, del)
            grid.append(cell)
        }
    }

    $('#at-all').onclick = () => {
        icons.forEach((i) => selected.add(i.id))
        renderGrid()
        update()
    }
    $('#at-none').onclick = () => {
        selected.clear()
        renderGrid()
        update()
    }

    // ── preview ─────────────────────────────────────────────
    function resizeCanvas(): void {
        const r = wrap.getBoundingClientRect()
        cv.width = Math.max(1, Math.round(r.width * devicePixelRatio))
        cv.height = Math.max(1, Math.round(r.height * devicePixelRatio))
        renderPreview()
    }

    function renderPreview(): void {
        ctx.clearRect(0, 0, cv.width, cv.height)
        const items = chosen()
        if (!items.length) {
            ctx.font = `${13 * devicePixelRatio}px Silkscreen, monospace`
            ctx.fillStyle = '#75896d'
            ctx.textAlign = 'center'
            ctx.fillText('SELECIONE ÍCONES DA BIBLIOTECA', cv.width / 2, cv.height / 2)
            return
        }
        const l = layoutNow()
        const cell = cellSize()
        const vs = Math.min((cv.width * 0.96) / l.width, (cv.height * 0.96) / l.height)
        const ox = (cv.width - l.width * vs) / 2
        const oy = (cv.height - l.height * vs) / 2
        ctx.imageSmoothingEnabled = vs < 1
        items.forEach((icon, i) => {
            const bmp = bitmaps.get(icon.id)
            if (!bmp) return
            const col = i % l.cols
            const row = Math.floor(i / l.cols)
            const x = l.padding + col * (l.cellW + l.padding)
            const y = l.padding + row * (l.cellH + l.padding)
            const off = (cell - icon.size) / 2 // centraliza ícone menor na célula
            ctx.drawImage(bmp, ox + (x + off) * vs, oy + (y + off) * vs, icon.size * vs, icon.size * vs)
        })
        ctx.strokeStyle = 'rgba(255, 79, 216, 0.6)'
        ctx.strokeRect(ox + 0.5, oy + 0.5, l.width * vs, l.height * vs)
    }

    function update(): void {
        const items = chosen()
        const summary = $('#at-summary')
        if (!items.length) {
            summary.textContent = 'nenhum ícone selecionado'
            summary.classList.remove('warn')
            renderPreview()
            return
        }
        const l = layoutNow()
        const tooBig = l.width > MAX_SHEET_DIM || l.height > MAX_SHEET_DIM
        summary.classList.toggle('warn', tooBig)
        summary.innerHTML =
            `<b>${items.length}</b> ícones · célula <b>${cellSize()}px</b> · grade <b>${l.cols}×${l.rows}</b><br>` +
            `atlas <b>${l.width}×${l.height}px</b>` +
            (tooBig ? '<br>⚠ atlas acima de 16384px — divida a seleção' : '')
        renderPreview()
    }

    colsInput.oninput = update
    padInput.oninput = update

    // ── exportação ──────────────────────────────────────────
    const exportBtn = $<HTMLButtonElement>('#at-export')
    exportBtn.onclick = async () => {
        const items = chosen()
        if (!items.length) {
            toast('SELECIONE AO MENOS 1 ÍCONE', true)
            return
        }
        const l = layoutNow()
        if (l.width > MAX_SHEET_DIM || l.height > MAX_SHEET_DIM) {
            toast('ATLAS GRANDE DEMAIS — DIVIDA A SELEÇÃO', true)
            return
        }
        exportBtn.disabled = true
        exportBtn.textContent = 'GERANDO...'
        try {
            const cell = cellSize()
            const atlas = document.createElement('canvas')
            atlas.width = l.width
            atlas.height = l.height
            const atx = atlas.getContext('2d')!
            const metas: AtlasIconMeta[] = []
            items.forEach((icon, i) => {
                const bmp = bitmaps.get(icon.id)
                const col = i % l.cols
                const row = Math.floor(i / l.cols)
                const x = l.padding + col * (l.cellW + l.padding)
                const y = l.padding + row * (l.cellH + l.padding)
                const off = Math.round((cell - icon.size) / 2)
                if (bmp) atx.drawImage(bmp, x + off, y + off, icon.size, icon.size)
                metas.push({ name: icon.name, x: x + off, y: y + off, w: icon.size, h: icon.size })
            })
            const colors = Number(colorsSelect.value)
            const png = await encodeCanvas(atlas, colors)
            const base = slugify(nameInput.value || 'atlas')
            const files: Record<string, Uint8Array> = {
                [`${base}.png`]: new Uint8Array(await png.arrayBuffer()),
                [`${base}.json`]: strToU8(
                    buildIconManifest(
                        {
                            name: base,
                            width: l.width,
                            height: l.height,
                            cell,
                            padding: l.padding,
                            columns: l.cols,
                            rows: l.rows,
                            compression: colors <= 0 ? 'rgba32-otimizado' : `paleta-${colors}-cores`,
                        },
                        metas,
                    ),
                ),
            }
            const zipped = zipSync(files, { level: 0 })
            downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${base}.zip`)
            toast(`ATLAS EXPORTADO ✓ ${formatBytes(png.size)}`)
        } catch (err) {
            console.error(err)
            toast('ERRO AO EXPORTAR O ATLAS', true)
        } finally {
            exportBtn.disabled = false
            exportBtn.textContent = 'EXPORTAR ATLAS_'
        }
    }

    // ── inicialização / teardown ────────────────────────────
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()
    void load()

    return () => {
        alive = false
        window.removeEventListener('resize', resizeCanvas)
        bitmaps.forEach((b) => b.close())
        bitmaps.clear()
    }
}
