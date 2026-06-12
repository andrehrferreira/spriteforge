## 1. Implementation

- [x] 1.1 `src/types.ts` + `src/db.ts`: interface `IconRecord`; IndexedDB v3 com store `icons` (migração não destrutiva) e CRUD `listIcons`/`putIcon`/`deleteIcon`
- [x] 1.2 `src/slicer.ts`: botão SALVAR P/ ATLAS — compõe cada caixa (aparada + encaixada no tamanho atual) e grava na biblioteca
- [x] 1.3 `src/atlas.ts` (novo): tela com grade da biblioteca (selecionar/excluir), célula = maior tamanho selecionado, preview ao vivo, exportação ZIP (PNG + manifesto via `buildIconManifest` pura)
- [x] 1.4 `index.html` + `src/main.ts` + `src/style.css`: 5º ícone na navbar com tooltip, rota `'atlas'`, tela e estilos

## 2. Tail (mandatory — enforced by rulebook v5.3.0)

- [x] 2.1 Update or create documentation covering the implementation (README)
- [x] 2.2 Write tests covering the new behavior (buildIconManifest)
- [x] 2.3 Run tests and confirm they pass (`tsc --noEmit` + `vitest run` verdes; build ok)
