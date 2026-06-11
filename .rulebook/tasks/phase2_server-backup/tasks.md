## 1. Servidor e infraestrutura

- [x] 1.1 `server/server.mjs` (novo, zero-dep): rotas GET/PUT/DELETE `/api/backups[/:id]` + `/api/health`; arquivos `.sfproj` em `data/backups/` com escrita atômica e sidecar de metadados; validação de id (smoke test de todos os endpoints ok)
- [x] 1.2 `vite.config.ts` (novo) com proxy `/api` → `127.0.0.1:5175`; `package.json` com `concurrently` (`npm run dev` sobe servidor + vite) e script `server`; `data/` no `.gitignore`

## 2. Cliente de backup

- [x] 2.1 `src/backup.ts` (novo): `packProject`/`unpackProject` (.sfproj via fflate, blobs explícitos: vídeo, thumb, referências, atlas), cliente da API, `backupAvailable` com cache e `scheduleBackup` (debounce 15s, 1 envio por vez)
- [x] 2.2 hooks de auto-backup: `saveProject` (src/state.ts) e gravar/excluir spritesheet (src/sprites.ts) agendam backup

## 3. UI de restauração

- [x] 3.1 `src/main.ts` + `index.html`: home lista backups do servidor ausentes no IndexedDB com RESTAURAR (regrava projeto + sheets e abre) e excluir; botão BACKUP_ manual no dashboard; estilos (card âmbar)

## 4. Tail (mandatory — enforced by rulebook v5.3.0)

- [x] 4.1 Update or create documentation covering the implementation (README: seção "Backup no servidor local" + scripts)
- [x] 4.2 Write tests covering the new behavior (roundtrip pack/unpack preservando blobs/types/metadados; backup mínimo sem sheets/refs)
- [x] 4.3 Run tests and confirm they pass (`tsc --noEmit` limpo, `vitest run` 26/26, build ok, smoke test do servidor)
