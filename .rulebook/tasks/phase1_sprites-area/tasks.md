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

- [x] 3.1 `src/analyze.ts` (novo): infraestrutura — amostragem reduzida pós-chroma com cópia imediata do canvas reutilizado de `loop.render` (`sampleFromCanvas`); métricas (`diffPct`, `centroidOf`, `orphanCount`, `uniqueColorCount`, `estimateAtlasBytes`); `detectAll` com saída determinística (ordem estável)
- [x] 3.2 `src/analyze.ts`: detectores de proporção entre animações (`detectProportion`) e de ajuste fino de posição (`detectPosition`), com fator/offset sugerido
- [x] 3.3 `src/analyze.ts`: detectores de frames duplicados (`detectDuplicates`, com economia estimada e fusão de duração) e de descontinuidade na emenda (`detectContinuity`)
- [x] 3.4 `src/analyze.ts`: detectores de redução de arquivo — `detectTrim` (margem), `detectQuantization` (cores em uso vs paleta) e `detectScale`, com impacto estimado
- [x] 3.5 `src/analyze.ts`: detector de pixel — `detectPixels` (pixels órfãos/resíduo de chroma), com limpeza aplicável na geração

## 4. Propostas e geração com correções

- [x] 4.1 `src/sprites.ts`: painel de propostas — `Correction[]` com severidade/impacto em pt-BR; aceitar/rejeitar (toggle), ajustar parâmetro (marca `adjusted`); estado vazio "nenhuma correção sugerida" permite gerar; REANALISAR preserva decisões; preview reflete escala/posição/remoções aceitas
- [x] 4.2 `src/sprites.ts`: correções aplicadas na rasterização da célula (`effFor`/`globalEff`/`cleanOrphans`; remoção de frame = omissão no atlas com duração somada no anterior, sem tocar `anim.selected`; crossfade corrigido recompõe o loop só na geração); correções aceitas registradas no `SpriteSheet` com params finais
- [x] 4.3 `src/sprites.ts`: `MAX_SHEET_DIM` revalidado após as correções; proposta de escala automática (`ensureScaleProposal`, severidade crítico) quando excede; falha de `encodeCanvas` identificada por animação, sem registro parcial

## 5. Versões: persistir, baixar, regerar, reverter

- [x] 5.1 `src/sprites.ts`: geração persistida no store `spritesheets` com `version` incremental e metadados completos; lista de versões com resumo (data, atlas, bytes, correções no tooltip); excluir versão mantém as demais
- [x] 5.2 `src/sprites.ts` + `package.json`: download em ZIP único (fflate, level 0) com PNGs por animação + manifesto regenerado dos metadados (`meta.version = 4`, slugs desambiguados via `uniqueSlug` consistentes entre manifesto e imagens)
- [x] 5.3 `src/sprites.ts`: REGERAR aplica exportCfg + correções salvas numa nova versão (animação ausente → reporta divergência sem travar); selo DESATUALIZADO via `animStateHash` quando as animações mudaram após a geração

## 6. Tail (mandatory — enforced by rulebook v5.3.0)

- [x] 6.1 Update or create documentation covering the implementation (README: fluxo projeto → alinhamento → SPRITES, formato do ZIP/manifesto v4, correções, `npm test`)
- [x] 6.2 Write tests covering the new behavior (vitest instalado; 24 testes: métricas e 8 detectores de `analyze` + determinismo, layout/escala/padding, slugs e desambiguação, manifesto v4 com coordenadas e durações, `animStateHash` para stale)
- [x] 6.3 Run tests and confirm they pass (`tsc --noEmit` limpo, `vitest run` 24/24, `vite build` ok)
