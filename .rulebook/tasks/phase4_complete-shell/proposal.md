# Proposal: phase4_complete-shell

## Why

As ferramentas do SpriteForge (normalizador, fatiador, gerador de vídeo)
estão espalhadas: duas escondidas num painel da home e uma só acessível de
dentro do projeto. Falta também o primeiro elo do pipeline — gerar a própria
imagem de referência — e a home não dá nenhuma pista visual do que existe em
cada projeto. Para virar um sistema completo, é preciso navegação global e
identificação visual imediata.

## What Changes

- **Navbar global de ícones com tooltips** no topo (sempre visível):
  Gerador de Imagem, Normalizador, Fatiador de Sprites e Gerador de Vídeo,
  com estado ativo por tela e tooltips no tema pixel/CRT. O painel
  FERRAMENTAS da home é removido (substituído pela navbar). O Gerador de
  Vídeo exige projeto aberto (aviso quando não houver).
- **Gerador de Imagem** (novo, `src/genimage.ts`): geração via OpenRouter
  `POST /api/v1/chat/completions` com `modalities: ["image","text"]` e
  `image_config` (aspecto/tamanho); modelos selecionáveis (gemini flash
  image, grok imagine image, flux); referências opcionais anexadas à
  mensagem (image-to-image); galeria da sessão com download e, com projeto
  aberto, "adicionar às referências do projeto"; mesma API key do gerador
  de vídeo (localStorage compartilhado).
- **Home com preview dos projetos**: cada card mostra uma faixa de
  miniaturas (thumbs das animações + referências, até 6) para identificar o
  projeto de relance.

## Impact

- Affected specs: nova capability `shell` (specs/shell/spec.md)
- Affected code: index.html, src/main.ts, src/genimage.ts (novo),
  src/style.css, tests/genimage.test.ts (novo)
- Breaking change: NO
- User benefit: pipeline completo navegável de qualquer tela (imagem →
  normalizar → vídeo → frames → sprites) e projetos reconhecíveis à vista.
