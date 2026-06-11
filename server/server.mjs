/**
 * Servidor local de backups do SpriteForge — zero dependências.
 *
 * Guarda cada projeto como um arquivo `.sfproj` (zip com JSON + blobs) em
 * data/backups/, com um sidecar `.json` de metadados para listagem rápida.
 *
 *   GET    /api/health        → { ok: true }
 *   GET    /api/backups       → [{ id, name, updatedAt, size }]
 *   GET    /api/backups/:id   → binário .sfproj
 *   PUT    /api/backups/:id   → grava (escrita atômica: tmp + rename)
 *   DELETE /api/backups/:id   → remove backup + metadados
 */

import { createServer } from 'node:http'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.SPRITEFORGE_BACKUP_PORT ?? 5175)
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'backups')
const ID = /^[\w-]{1,64}$/

await mkdir(DATA, { recursive: true })

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean) // ['api', 'backups', id?]
    if (parts[0] !== 'api') return send(res, 404, { error: 'não encontrado' })

    if (parts[1] === 'health') return send(res, 200, { ok: true })
    if (parts[1] !== 'backups') return send(res, 404, { error: 'não encontrado' })

    const id = parts[2]
    if (!id) {
      if (req.method !== 'GET') return send(res, 405, { error: 'método não permitido' })
      const list = []
      for (const f of await readdir(DATA)) {
        if (!f.endsWith('.json')) continue
        try {
          list.push(JSON.parse(await readFile(join(DATA, f), 'utf8')))
        } catch {
          // sidecar corrompido: ignora na listagem
        }
      }
      list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return send(res, 200, list)
    }

    if (!ID.test(id)) return send(res, 400, { error: 'id inválido' })
    const bin = join(DATA, `${id}.sfproj`)
    const metaPath = join(DATA, `${id}.json`)

    if (req.method === 'GET') {
      try {
        const buf = await readFile(bin)
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length })
        return res.end(buf)
      } catch {
        return send(res, 404, { error: 'backup não encontrado' })
      }
    }

    if (req.method === 'PUT') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const buf = Buffer.concat(chunks)
      if (!buf.length) return send(res, 400, { error: 'corpo vazio' })
      const tmp = `${bin}.tmp`
      await writeFile(tmp, buf)
      await rename(tmp, bin) // escrita atômica: nunca deixa .sfproj pela metade
      const meta = {
        id,
        name: decodeURIComponent(String(req.headers['x-project-name'] ?? id)),
        updatedAt: Number(req.headers['x-updated-at'] ?? Date.now()),
        size: buf.length,
      }
      await writeFile(metaPath, JSON.stringify(meta))
      return send(res, 200, { ok: true, size: buf.length })
    }

    if (req.method === 'DELETE') {
      await rm(bin, { force: true })
      await rm(metaPath, { force: true })
      return send(res, 200, { ok: true })
    }

    send(res, 405, { error: 'método não permitido' })
  } catch (err) {
    send(res, 500, { error: String(err) })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[spriteforge-backup] http://127.0.0.1:${PORT} · dados em ${DATA}`)
})
