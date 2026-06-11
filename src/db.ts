/**
 * Persistência local em IndexedDB.
 * v1: store `projects` (projetos completos, incluindo os vídeos).
 * v2: + store `spritesheets` (gerações de atlas, separadas do projeto para
 *     que salvar o projeto não reserialize os PNGs — e vice-versa).
 */

import type { ProjectData, SpriteSheet } from './types'

const DB_NAME = 'spriteforge'
const DB_VERSION = 2
const PROJECTS = 'projects'
const SHEETS = 'spritesheets'

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

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
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
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
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

export const uid = (): string => crypto.randomUUID()
