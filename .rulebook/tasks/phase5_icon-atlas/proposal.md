# Proposal: phase5_icon-atlas

## Why

O fatiador exporta os ícones como PNGs soltos num ZIP, mas para o jogo o
ideal é um atlas único (menos arquivos, menos draw calls, carregamento mais
rápido). Falta um caminho para acumular ícones fatiados em sessões
diferentes e compor um atlas otimizado com manifesto.

## What Changes

- **Biblioteca de ícones persistente**: novo store IndexedDB `icons` (bump
  v3, migração não destrutiva) com id, nome, tamanho, blob e data.
- **Fatiador**: botão "SALVAR P/ ATLAS_" grava cada caixa (aparada e
  encaixada no tamanho escolhido) na biblioteca, sem precisar baixar ZIP.
- **Nova tela ATLAS DE ÍCONES** (5º ícone da navbar): grade da biblioteca
  com seleção por clique e exclusão; célula uniforme = maior tamanho entre
  os selecionados; opções de colunas/padding/compactação; preview ao vivo do
  atlas montado; exportação em ZIP (PNG + manifesto JSON com posição de cada
  ícone), com manifesto construído por função pura testável.

## Impact

- Affected specs: nova capability `atlas` (specs/atlas/spec.md)
- Affected code: src/types.ts, src/db.ts, src/slicer.ts, src/atlas.ts
  (novo), src/main.ts, index.html, src/style.css, tests/atlas.test.ts
- Breaking change: NO (migração IndexedDB só adiciona store)
- User benefit: ícones de várias folhas acumulam numa biblioteca e saem num
  atlas único otimizado para a engine.
