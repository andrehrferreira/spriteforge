/**
 * Persistência local em IndexedDB — projetos completos, incluindo os
 * vídeos originais (Blobs), para reabrir/editar/adicionar depois.
 */

import type { ProjectData } from './types'

const DB_NAME = 'spriteforge'
const STORE = 'projects'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const listProjects = (): Promise<ProjectData[]> => tx('readonly', (s) => s.getAll())
export const putProject = (p: ProjectData): Promise<void> => tx('readwrite', (s) => s.put(p)).then(() => undefined)
export const deleteProject = (id: string): Promise<void> => tx('readwrite', (s) => s.delete(id)).then(() => undefined)
export const uid = (): string => crypto.randomUUID()
