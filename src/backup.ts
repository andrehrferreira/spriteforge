/**
 * Backup persistente no servidor local: empacota o projeto COMPLETO
 * (vídeos, thumbs, referências e spritesheets gerados) num `.sfproj`
 * (zip via fflate) e fala com a API /api/backups do server/server.mjs.
 * Sem servidor rodando, tudo falha silenciosamente — o app segue 100%
 * funcional só com o IndexedDB.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { listSheets, putProject, putSheet } from './db'
import type { ProjectData, SpriteSheet } from './types'

const API = '/api/backups'
const DEBOUNCE_MS = 15000

export interface BackupMeta {
    id: string
    name: string
    updatedAt: number
    size: number
}

let serverOk: boolean | null = null

/** o servidor de backup está acessível? (resultado em cache na sessão) */
export async function backupAvailable(): Promise<boolean> {
    if (serverOk !== null) return serverOk
    try {
        const r = await fetch('/api/health')
        serverOk = r.ok
    } catch {
        serverOk = false
    }
    return serverOk
}

// ── empacotamento (.sfproj) ───────────────────────────────

interface BlobRef {
    __blob: number
    type: string
}

async function blobToU8(b: Blob): Promise<Uint8Array> {
    return new Uint8Array(await b.arrayBuffer())
}

/** projeto + spritesheets → zip com JSON e blobs referenciados por índice */
export async function packProject(project: ProjectData, sheets: SpriteSheet[]): Promise<Uint8Array> {
    const blobs: Blob[] = []
    const ref = (b: Blob): BlobRef => {
        blobs.push(b)
        return { __blob: blobs.length - 1, type: b.type }
    }
    const proj = {
        ...project,
        animations: project.animations.map((a) => ({
            ...a,
            video: ref(a.video),
            thumb: a.thumb ? ref(a.thumb) : null,
        })),
        refs: project.refs.map((r) => ({ ...r, blob: ref(r.blob) })),
    }
    const shs = sheets.map((s) => ({ ...s, blobs: s.blobs.map(ref) }))

    const files: Record<string, Uint8Array> = {
        'project.json': strToU8(JSON.stringify(proj)),
        'sheets.json': strToU8(JSON.stringify(shs)),
    }
    for (let i = 0; i < blobs.length; i++) files[`blobs/${i}`] = await blobToU8(blobs[i])
    // level 0: vídeos e PNGs já são comprimidos — zip vira só um contêiner
    return zipSync(files, { level: 0 })
}

/** reconstrói o projeto e os spritesheets a partir do .sfproj */
export function unpackProject(bytes: Uint8Array): { project: ProjectData; sheets: SpriteSheet[] } {
    const files = unzipSync(bytes)
    const blobAt = (r: BlobRef): Blob => new Blob([files[`blobs/${r.__blob}`]], { type: r.type })

    type PackedAnim = Omit<ProjectData['animations'][number], 'video' | 'thumb'> & {
        video: BlobRef
        thumb: BlobRef | null
    }
    type PackedRef = Omit<ProjectData['refs'][number], 'blob'> & { blob: BlobRef }
    type PackedProject = Omit<ProjectData, 'animations' | 'refs'> & {
        animations: PackedAnim[]
        refs: PackedRef[]
    }
    type PackedSheet = Omit<SpriteSheet, 'blobs'> & { blobs: BlobRef[] }

    const proj = JSON.parse(strFromU8(files['project.json'])) as PackedProject
    const shs = files['sheets.json'] ? (JSON.parse(strFromU8(files['sheets.json'])) as PackedSheet[]) : []

    const project: ProjectData = {
        ...proj,
        animations: proj.animations.map((a) => ({
            ...a,
            video: blobAt(a.video),
            thumb: a.thumb ? blobAt(a.thumb) : null,
        })),
        refs: (proj.refs ?? []).map((r) => ({ ...r, blob: blobAt(r.blob) })),
    }
    const sheets: SpriteSheet[] = shs.map((s) => ({ ...s, blobs: s.blobs.map(blobAt) }))
    return { project, sheets }
}

// ── API ───────────────────────────────────────────────────

export async function uploadBackup(project: ProjectData): Promise<void> {
    if (!(await backupAvailable())) return
    const sheets = await listSheets(project.id)
    const bytes = await packProject(project, sheets)
    const res = await fetch(`${API}/${project.id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Project-Name': encodeURIComponent(project.name),
            'X-Updated-At': String(project.updatedAt),
        },
        // fflate sempre aloca ArrayBuffer comum — o cast só satisfaz o BlobPart
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    })
    if (!res.ok) throw new Error(`backup falhou (HTTP ${res.status})`)
}

export async function listBackups(): Promise<BackupMeta[]> {
    if (!(await backupAvailable())) return []
    try {
        const res = await fetch(API)
        if (!res.ok) return []
        return (await res.json()) as BackupMeta[]
    } catch {
        return []
    }
}

/** baixa o backup e regrava projeto + spritesheets no IndexedDB */
export async function restoreBackup(id: string): Promise<ProjectData> {
    const res = await fetch(`${API}/${id}`)
    if (!res.ok) throw new Error(`backup não encontrado (HTTP ${res.status})`)
    const { project, sheets } = unpackProject(new Uint8Array(await res.arrayBuffer()))
    await putProject(project)
    for (const s of sheets) await putSheet(s)
    return project
}

export async function deleteBackup(id: string): Promise<void> {
    await fetch(`${API}/${id}`, { method: 'DELETE' })
}

// ── auto-backup ───────────────────────────────────────────

let timer = 0
let pending: ProjectData | null = null
let inFlight = false

/** agenda um backup do projeto (debounce; silencioso se o servidor faltar) */
export function scheduleBackup(project: ProjectData): void {
    pending = project
    clearTimeout(timer)
    timer = window.setTimeout(() => {
        const p = pending
        pending = null
        if (!p || inFlight) return
        inFlight = true
        void uploadBackup(p)
            .catch((err) => console.warn('[backup] envio falhou:', err))
            .finally(() => {
                inFlight = false
            })
    }, DEBOUNCE_MS)
}
