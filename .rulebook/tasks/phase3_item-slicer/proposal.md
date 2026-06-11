# Proposal: phase3_item-slicer

## Why

Sprites de itens (gemas, ícones, drops) chegam como uma folha única com vários
itens em grade irregular, tamanho de folha desconhecido e às vezes sem
transparência. Recortar na mão item a item é lento e produz tamanhos
inconsistentes. É preciso uma ferramenta que detecte cada item
automaticamente, permita ajustar os cortes num preview e exporte todos no
mesmo tamanho (64×64 por padrão) com PNG otimizado.

## What Changes

- **Nova ferramenta FATIADOR DE ITENS** (tela própria, entrada na home):
  recebe uma imagem (PNG com alpha ou fundo sólido — removido por flood fill
  a partir das bordas, como no normalizador).
- **Detecção automática**: máscara de alpha com limiar configurável →
  componentes conectados (8-conectividade) → fusão de caixas próximas
  (brilhos/partículas separados do item) → ordenação em ordem de leitura.
  Parâmetros ajustáveis (limiar alfa, área mínima, distância de fusão) com
  REDETECTAR.
- **Preview editável**: caixas numeradas sobre a imagem; clique seleciona,
  arrastar move, alça no canto redimensiona, arrastar em área vazia cria
  caixa nova, EXCLUIR remove; campos numéricos X/Y/L/A para ajuste fino.
- **Exportação**: cada caixa vira um PNG quadrado (32/48/64/96/128, padrão
  64×64), conteúdo centralizado com margem interna configurável,
  quantização UPNG (otimizado por padrão), nomes `base_001.png...` em ordem
  de leitura, baixados num ZIP único (fflate).
- Lógica geométrica pura exportada para testes: `componentBoxes`,
  `mergeBoxes`, `sortReadingOrder`, `fitRect`.

## Impact

- Affected specs: nova capability `slicer` (specs/slicer/spec.md)
- Affected code: src/slicer.ts (novo), src/main.ts, index.html,
  src/style.css, tests/slicer.test.ts (novo)
- Breaking change: NO (ferramenta avulsa, sem persistência)
- User benefit: folha de itens → N PNGs uniformes 64×64 otimizados em
  segundos, com controle visual do corte.
