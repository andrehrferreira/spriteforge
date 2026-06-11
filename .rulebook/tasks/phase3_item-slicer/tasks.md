## 1. Implementation

- [x] 1.1 `src/slicer.ts` (novo): funções puras de geometria (`componentBoxes` 8-conectado, `mergeBoxes`, `sortReadingOrder`, `fitRect`) + remoção de fundo sólido por flood fill e máscara de alpha com limiar
- [x] 1.2 `src/slicer.ts`: tela `initSlicer` — carregar imagem (clique/arrastar), detecção com parâmetros ajustáveis (limiar/área mínima/fusão/tolerância de fundo), preview com caixas editáveis (selecionar, mover, alça de redimensionar, criar no vazio, Delete/excluir, campos X/Y/L/A) e exportação ZIP (tamanho 32–128, margem interna, quantização UPNG, nomes em ordem de leitura + manifesto)
- [x] 1.3 `index.html` + `src/main.ts` + `src/style.css`: tela `#screen-slicer`, rota `'slicer'`, entrada na home (FERRAMENTAS) e estilos

## 2. Tail (mandatory — enforced by rulebook v5.3.0)

- [x] 2.1 Update or create documentation covering the implementation (README: seção "Fatiador de itens")
- [x] 2.2 Write tests covering the new behavior (7 testes: componentBoxes com 8-conectividade e área mínima, mergeBoxes, sortReadingOrder, fitRect com proporção e margem)
- [x] 2.3 Run tests and confirm they pass (`tsc --noEmit` limpo, `vitest run` 33/33, build ok)
