/**
 * Persistência local em IndexedDB.
 * v1: store `projects` (projetos completos, incluindo os vídeos).
 * v2: + store `spritesheets` (gerações de atlas, separadas do projeto para
 *     que salvar o projeto não reserialize os PNGs — e vice-versa).
 * v3: + store `icons` (biblioteca global de ícones do fatiador).
 */

import type { IconRecord, ProjectData, SpriteSheet } from './types'

const DB_NAME = 'spriteforge'
const PROJECTS = 'projects'
const SHEETS = 'spritesheets'
const ICONS = 'icons'

/** quota do navegador esgotada ao gravar no IndexedDB */
export class QuotaError extends Error {
  constructor() {
    super('Espaço de armazenamento do navegador esgotado')
    this.name = 'QuotaError'
  }
}

function isQuota(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError'
}

let dbPromise: Promise<IDBDatabase> | null = null

function openWith(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME)
    req.onupgradeneeded = () => {
      // migração não destrutiva: cria apenas o que não existe
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SHEETS)) {
        const s = db.createObjectStore(SHEETS, { keyPath: 'id' })
        s.createIndex('projectId', 'projectId', { unique: false })
      }
      if (!db.objectStoreNames.contains(ICONS)) {
        db.createObjectStore(ICONS, { keyPath: 'id' })
      }
    }
    req.onblocked = () => console.warn('[db] upgrade bloqueado — feche outras abas do SpriteForge')
    req.onsuccess = () => {
      const db = req.result
      // permite que outra aba faça upgrade sem travar
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Auto-reparo: se a conexão abrir sem algum store (ex.: upgrade feito por
 * uma versão antiga do código), força um bump de versão que cria o que
 * falta — sem tocar nos dados existentes.
 */
async function ensureStores(db: IDBDatabase): Promise<IDBDatabase> {
  const missing = [PROJECTS, SHEETS, ICONS].some((s) => !db.objectStoreNames.contains(s))
  if (!missing) return db
  const next = db.version + 1
  db.close()
  return openWith(next)
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    // abre na versão atual do banco (a que for) e repara o schema se preciso
    dbPromise = openWith()
      .then(ensureStores)
      .catch((err) => {
        dbPromise = null
        throw err
      })
  }
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(isQuota(req.error) ? new QuotaError() : req.error)
        t.onabort = () => reject(isQuota(t.error) ? new QuotaError() : t.error)
      }),
  )
}

// ── projetos ──────────────────────────────────────────────
export const listProjects = (): Promise<ProjectData[]> => tx(PROJECTS, 'readonly', (s) => s.getAll())
export const putProject = (p: ProjectData): Promise<void> =>
  tx(PROJECTS, 'readwrite', (s) => s.put(p)).then(() => undefined)
export const deleteProject = (id: string): Promise<void> =>
  tx(PROJECTS, 'readwrite', (s) => s.delete(id)).then(() => undefined)

// ── spritesheets ──────────────────────────────────────────
export const listSheets = (projectId: string): Promise<SpriteSheet[]> =>
  tx(SHEETS, 'readonly', (s) => s.index('projectId').getAll(projectId))
export const putSheet = (sheet: SpriteSheet): Promise<void> =>
  tx(SHEETS, 'readwrite', (s) => s.put(sheet)).then(() => undefined)
export const deleteSheet = (id: string): Promise<void> =>
  tx(SHEETS, 'readwrite', (s) => s.delete(id)).then(() => undefined)

// ── ícones (biblioteca do fatiador) ───────────────────────
export const listIcons = (): Promise<IconRecord[]> => tx(ICONS, 'readonly', (s) => s.getAll())
export const putIcon = (icon: IconRecord): Promise<void> =>
  tx(ICONS, 'readwrite', (s) => s.put(icon)).then(() => undefined)
export const deleteIcon = (id: string): Promise<void> =>
  tx(ICONS, 'readwrite', (s) => s.delete(id)).then(() => undefined)

export const uid = (): string => crypto.randomUUID()
