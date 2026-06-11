# Proposal: phase2_server-backup

## Why

Todo o estado do SpriteForge (projetos, vídeos, referências, spritesheets)
vive no IndexedDB do navegador. Limpar dados do site, trocar de navegador ou
de perfil perde tudo — risco inaceitável para projetos com horas de ajuste.
É preciso uma camada de backup persistente fora do navegador.

## What Changes

- **Servidor local zero-dep** (`server/server.mjs`, Node http puro): API
  `/api/backups` (listar, baixar, enviar, excluir) + `/api/health`, gravando
  arquivos `.sfproj` em `data/backups/` no disco com escrita atômica
  (tmp + rename) e um sidecar `.json` de metadados (nome, data, tamanho).
- **Formato `.sfproj`**: zip (fflate, level 0) com `project.json` +
  `sheets.json` (blobs substituídos por referências) + `blobs/<n>` —
  empacota o projeto completo, incluindo vídeos e versões de spritesheet.
- **Cliente** (`src/backup.ts`): pack/unpack, upload/list/restore/delete,
  detecção de disponibilidade do servidor (`/api/health`, cache) e
  `scheduleBackup` com debounce de 15s.
- **Hooks de auto-backup**: `saveProject` (state.ts) e gravação/exclusão de
  spritesheets (sprites.ts) agendam backup automático.
- **UI**: na home, backups que não existem no IndexedDB aparecem como cards
  "no servidor" com RESTAURAR (regrava projeto + spritesheets no IndexedDB)
  e excluir; no dashboard do projeto, botão BACKUP_ manual.
- **Dev**: `vite.config.ts` com proxy `/api` → `127.0.0.1:5175`;
  `npm run dev` sobe servidor + vite juntos (concurrently); `data/` no
  .gitignore.

## Impact

- Affected specs: nova capability `backup` (specs/backup/spec.md)
- Affected code: server/server.mjs (novo), vite.config.ts (novo),
  src/backup.ts (novo), src/state.ts, src/sprites.ts, src/main.ts,
  index.html, src/style.css, package.json, .gitignore
- Breaking change: NO (sem servidor, o app segue funcionando 100% local)
- User benefit: limpar o cache do navegador (ou abrir outro navegador no
  mesmo PC) deixa de perder os projetos — tudo restaurável em um clique.
