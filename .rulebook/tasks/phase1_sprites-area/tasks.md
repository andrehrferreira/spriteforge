## 1. Modelo de dados e persistência

- [x] 1.1 `src/types.ts`: adicionar `CorrectionKind` (union fechado das 8 categorias), `Correction` (kind, severity, target, params, accepted/adjusted), `SheetAnimMeta`, `SpriteSheet` (id, projectId, version, createdAt, blobs por animação, metadados, correções aplicadas, stateHash) e `SpritesCfg` (limiares default); `ProjectData` ganha `spritesCfg`
- [x] 1.2 `src/db.ts`: bump IndexedDB para v2 com store `spritesheets` (keyPath `id`, índice `projectId`) em migração não destrutiva; CRUD `listSheets(projectId)`, `putSheet`, `deleteSheet`; captura de `QuotaExceededError` com erro tipado
- [x] 1.3 `src/state.ts`: backfill de `spritesCfg` em `openProjectState` (padrão de `refs`); helper `animStateHash` (frames/chroma/curva/seleção/align) para detecção de stale
- [x] 1.4 `src/export.ts`: extraídos `formatBytes`, `slugify`, `uniqueSlug` e `buildManifest` (manifesto v4) como utilitários compartilhados; consumidores atualizados

## 2. Migração da exportação (align → sprites)

- [x] 2.1 `index.html`: criar `#screen-sprites` (tema pixel/CRT, pt-BR) com painel de propostas, preview, configuração de exportação (escala/padding/colunas/compactação migrados do align) e lista de versões; remover `aexp-*` e `#btn-export-all` do `#screen-align`; adicionar "AVANÇAR → SPRITES" no align e botão SPRITES no dashboard
- [x] 2.2 `src/main.ts`: adicionar `'sprites'` ao union `Screen` e ao `show()`; rota `goSprites()` acessível do dashboard e do alinhamento; navegação VOLTAR
- [x] 2.3 `src/sprites.ts` (novo): tela base com `prepare()` incremental (ensureFrames + loops + bounds + célula comum, padrão do align), flag `alive` para aborto e cleanup; geração movida reutilizando `computeLayout`/`encodeCanvas`, persistindo via `putSheet`
- [x] 2.4 `src/align.ts`: removida geração/manifesto/exportação e referências mortas (`tsc --noEmit` limpo); mantidos célula/pivô/margem/ajuste fino/ghost

## 3. Motor de análise

- [ ] 3.1 `src/analyze.ts` (novo): infraestrutura — amostragem reduzida (lado máx. 384px) pós-chroma com cópia imediata do canvas reutilizado de `loop.render`; métricas (% de pixels com diferença acima de limiar, RGBA premultiplicado); saída determinística (ordem estável)
- [ ] 3.2 `src/analyze.ts`: detectores de proporção entre animações e de ajuste fino de posição (desvio de pivô), com fator/offset sugerido
- [ ] 3.3 `src/analyze.ts`: detectores de frames duplicados/desnecessários e de descontinuidade entre frames, com índices candidatos e economia estimada em bytes
- [ ] 3.4 `src/analyze.ts`: detectores de redução de arquivo — recorte de célula (célula > bbox real), quantização (contagem de cores vs paleta) e escala, cada um com impacto estimado
- [ ] 3.5 `src/analyze.ts`: detectores de pixel — artefatos residuais de chroma e pixels órfãos isolados, descrevendo o ajuste proposto

## 4. Propostas e geração com correções

- [ ] 4.1 `src/sprites.ts`: painel de propostas — listar `Correction[]` com severidade/impacto em pt-BR; aceitar, rejeitar e ajustar parâmetros; estado vazio "nenhuma correção sugerida" permite gerar mesmo assim
- [ ] 4.2 `src/sprites.ts`: aplicar correções aceitas na rasterização da célula (pós-processo no canvas da célula antes do encode; remoção de frame = omissão no atlas, sem tocar `anim.selected`); registrar correções aplicadas (com parâmetros ajustados) no `SpriteSheet`
- [ ] 4.3 `src/sprites.ts`: revalidar `MAX_SHEET_DIM` por animação após correções aceitas; propor correção de escala automática quando exceder; bloquear com aviso pt-BR se ainda exceder; falha de `encodeCanvas` tratada por animação sem persistir registro parcial

## 5. Versões: persistir, baixar, regerar, reverter

- [ ] 5.1 `src/sprites.ts`: persistir geração no store `spritesheets` com `version` incremental e metadados completos; lista de versões com resumo; excluir versão mantém as demais
- [ ] 5.2 `src/sprites.ts` + `package.json`: download em ZIP único (fflate) com PNGs por animação + manifesto regenerado dos metadados (`meta.version = 4`, slugs desambiguados com sufixo `_2` consistentes entre manifesto e imagens)
- [ ] 5.3 `src/sprites.ts`: regerar a partir dos metadados salvos (animação removida/alterada → reporta divergência sem travar); detecção de stale via hash com aviso "precisa regerar" nas versões desatualizadas

## 6. Tail (mandatory — enforced by rulebook v5.3.0)

- [ ] 6.1 Update or create documentation covering the implementation (README: fluxo projeto → alinhamento → SPRITES, formato do ZIP/manifesto v4, correções)
- [ ] 6.2 Write tests covering the new behavior (instalar vitest; unit tests das partes puras: métricas/limiares e determinismo de `analyze`, layout pós-correções, desambiguação de slugs, montagem do manifesto, hash de stale, migração de schema)
- [ ] 6.3 Run tests and confirm they pass (`tsc --noEmit` + `vitest run` verdes; build vite ok)
