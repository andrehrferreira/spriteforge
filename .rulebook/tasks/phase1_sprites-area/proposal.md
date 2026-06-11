# Proposal: phase1_sprites-area

## Why

Hoje a tela de alinhamento (`src/align.ts`) acumula duas responsabilidades:
definir a célula/pivô comum E exportar os atlas. A exportação é a etapa final
do fluxo, mas vive escondida dentro do alinhamento, dispara downloads diretos
(N PNGs sequenciais + 1 JSON solto) e não deixa vestígio no projeto — os
spritesheets não são salvos, não têm versão e não podem ser regerados sem
refazer todo o processo. Além disso, o sistema não inspeciona o resultado:
artefatos de chroma, frames duplicados, proporções inconsistentes entre
animações e células maiores que o necessário passam direto para a engine do
jogo, exigindo correção manual.

## What Changes

**Fluxo (roteamento — `src/main.ts`)**
- Adiciona a tela `'sprites'` ao union `Screen` e ao laço de `show()`.
- Novo fluxo: projeto → animações → alinhamento → **SPRITES**.
- Dois pontos de entrada: botão SPRITES no dashboard do projeto e botão
  "AVANÇAR → SPRITES" na tela de alinhamento. Ao abrir, a tela recomputa
  loops/bounds/célula do zero com carregamento incremental (mesmo padrão do
  `prepare()` do align), reutilizando `ensureFrames` e o cache `state.frames`.

**Separação da exportação (`src/align.ts` → novo `src/sprites.ts`)**
- Remoção limpa: `buildAtlasFor`, `animLayouts`, o handler de
  `#btn-export-all` e os controles `aexp-*` saem do alinhamento (HTML e TS,
  sem referências mortas) e a geração passa a viver na área SPRITES.
- O alinhamento mantém APENAS célula/pivô/margem e o ajuste fino por animação.
- `exportCfg` continua salvo no projeto e passa a ser editado na área SPRITES.
- `src/export.ts` (`computeLayout`/`encodeCanvas`) é reutilizado sem mudança.

**Motor de análise (novo `src/analyze.ts`)**
- Função determinística: recebe animações alinhadas + célula/pivô e devolve
  `Correction[]` (propostas), cada uma com `kind` (union fechado),
  `severity`, `target` (projeto/animação/frame) e parâmetros ajustáveis.
- 8 categorias na v1: proporção entre animações, continuidade entre frames,
  remoção de frames duplicados/desnecessários, recorte de célula,
  quantização, escala, correções de pixel (artefatos de chroma/pixels
  órfãos) e ajuste fino de posição.
- TODAS as correções são não-destrutivas: afetam somente a pipeline de
  geração do atlas; nunca alteram `AnimationData`/`selected`/bitmaps/chroma.
- Comparações de pixel em resolução reduzida (lado máx. 384px, pós-chroma,
  RGBA premultiplicado), com limiares default em `spritesCfg`; o canvas
  reutilizado de `loop.render(p)` é copiado antes de qualquer análise.
- Correções de pixel/posição aplicadas somente na rasterização da célula do
  atlas (pós-processo antes do encode) — editor e alinhamento intocados.

**Persistência (novo store IndexedDB `spritesheets`, `src/db.ts` v2)**
- Bump do IndexedDB para v2 com store separado `spritesheets` (keyPath `id`,
  índice `projectId`); migração não destrutiva. Atlas desacoplados do
  registro do projeto: `saveProject` não reserializa PNGs.
- `SpriteSheet` persiste: PNGs por animação (blobs), metadados de geração
  (célula, pivô, escala, padding, compressão), correções aplicadas (incluindo
  parâmetros ajustados pelo usuário), `createdAt` e `version` incremental.
- O manifesto JSON NÃO é persistido: é regenerado no download a partir dos
  metadados, com `meta.version = 4` (versão de FORMATO, distinta da versão de
  geração do `SpriteSheet`).
- `ProjectData` ganha apenas `spritesCfg`; backfill para projetos antigos no
  `openProjectState`, espelhando o padrão de `refs`.
- `QuotaExceededError` tratado com mensagem pt-BR sem corromper dados.

**Operações na área SPRITES**
- Analisar → revisar propostas (aceitar/rejeitar/ajustar) → gerar → persistir.
- Versões salvas: baixar (ZIP único com PNGs + manifesto, via `fflate`),
  regerar a partir dos metadados, excluir/reverter.
- Detecção de stale: editar animação (frames/chroma/curva/seleção) após gerar
  marca as versões salvas como desatualizadas, com aviso de regeração.
- Revalidação de `MAX_SHEET_DIM` (16384px) APÓS as correções aceitas; se
  exceder, propõe correção de escala automaticamente; persiste o bloqueio com
  aviso pt-BR se ainda exceder.

**UI (`index.html` + `src/style.css`)**
- Nova `#screen-sprites` no tema pixel/CRT, pt-BR: painel de propostas,
  pré-visualização dos sprites, lista de versões com baixar/regerar/excluir.
- `formatBytes` extraído para utilitário compartilhado (hoje duplicado).

## Impact

- Affected specs: nova capability `sprites` (specs/sprites/spec.md)
- Affected code: src/main.ts, src/align.ts, src/sprites.ts (novo),
  src/analyze.ts (novo), src/types.ts, src/db.ts, src/state.ts,
  src/export.ts, index.html, src/style.css, package.json (fflate, vitest)
- Breaking change: NO (migração IndexedDB não destrutiva; projetos antigos
  recebem backfill de `spritesCfg`)
- User benefit: spritesheets versionados e regeráveis salvos no projeto,
  correções automáticas propostas antes da geração (arquivos menores e
  composição consistente na engine), download em um único ZIP e tela de
  alinhamento focada só em alinhar.
