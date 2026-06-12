## 1. Implementation

- [x] 1.1 `index.html` + `src/style.css`: navbar de ícones (SVG inline) com tooltips CSS no tema pixel, entre o logo e o breadcrumb; remover o painel FERRAMENTAS da home; tela `#screen-genimage`
- [x] 1.2 `src/genimage.ts` (novo): cliente OpenRouter chat/completions com modalities image (extração das imagens da resposta como função pura `extractImages`), modelos selecionáveis, image_config (aspecto/tamanho), referências opcionais (upload + do projeto), galeria da sessão com download e "adicionar às referências"
- [x] 1.3 `src/main.ts`: rota `'genimage'`, wiring da navbar (com estado ativo por tela e guarda de projeto no gerador de vídeo), home com faixa de miniaturas por projeto (thumbs de animações + referências)

## 2. Tail (mandatory — enforced by rulebook v5.3.0)

- [x] 2.1 Update or create documentation covering the implementation (README: navbar + gerador de imagem)
- [x] 2.2 Write tests covering the new behavior (extractImages com respostas válidas/vazias/malformadas)
- [x] 2.3 Run tests and confirm they pass (`tsc --noEmit` + `vitest run` verdes; build ok)
