# SPRITEFORGE

Ferramenta web para transformar vídeos em spritesheets de jogo: organize vários
vídeos em um **projeto** (um por animação — idle, walk, attack...), remova o
chroma key na GPU (shader WebGL2), monte o loop frame a frame com crossfade da
emenda, alinhe todas as animações num **pivô e célula comuns** e exporte um
atlas único PNG transparente + JSON de metadados.

Roda 100% no navegador — os vídeos e configurações ficam salvos localmente
(IndexedDB); nada sai da sua máquina.

## Rodar

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/ estático
```

## Fluxo

1. **Projetos** — crie um projeto com nome. Tudo fica salvo: reabra depois para
   corrigir ajustes ou adicionar novas animações.
2. **Projeto** — adicione vídeos (cada um vira uma animação). Escolha FPS de
   extração e resolução máxima por vídeo.
3. **Editor da animação** —
   - *Chroma key*: cor detectada automaticamente; conta-gotas, similaridade,
     suavização, anti-reflexo e remoção de halo. Tudo em tempo real na GPU.
   - *Frames*: clique inclui/exclui do loop, shift+clique seleciona intervalo.
   - *LOOPING (auto)*: analisa os frames e encontra o melhor par início/fim
     (semelhança de pose com compensação de translação + coerência de
     movimento), ignorando os frames que impedem o loop de fechar. Também
     mede a deriva de posição do personagem ao longo do ciclo e distribui a
     correção inversa pelos frames — o último emenda exatamente no primeiro,
     sem o "pulo" típico de vídeo gerado por IA.
   - *Crossfade*: funde o fim do loop com o início para eliminar o salto da
     emenda (frames consumidos ficam marcados em âmbar).
   - *Preview*: play/pause (espaço), passo a passo (←/→), FPS, zoom, fundos.
4. **Alinhar & exportar** —
   - Analisa o conteúdo opaco de cada animação (bounding box após o chroma).
   - Define a **célula comum** (tamanho único para todas) e o **pivô
     compartilhado** (presets pé/centro/topo ou X/Y manual + margem).
   - Ajuste fino por animação: deslocamento X/Y e escala, com **ghost** de
     outra animação sobreposto para comparar.
   - Exporta o atlas: escala global, padding, colunas e compactação PNG
     (paleta 256/128/64 cores via UPNG.js, sem perda, ou nativo).

## Geração de vídeo (OpenRouter)

Dentro do projeto, a tela **GERAR VÍDEO_** usa o `x-ai/grok-imagine-video`
via OpenRouter: as imagens de referência ficam salvas no projeto (painel
REFERÊNCIAS do dashboard), você clica para escolher quais entram (até 7),
escreve o mini prompt da ação e o sistema anexa as diretrizes fixas de
sprite sheet (fundo #00b140, câmera fixa, pivô fixo, looping etc. —
editáveis). Config: 1:1, 480p, 2–6s, sem áudio (~$0.05/s). O job roda
assíncrono com polling; ao terminar dá para baixar o MP4 ou clicar
**USAR NO PROJETO_** para importá-lo direto como animação. A API key fica
no localStorage do navegador.

## Normalizador de referências

Ferramenta avulsa (na tela inicial) para padronizar imagens de referência
antes de gerar os vídeos: envie várias imagens, o fundo é removido (chroma na
GPU com cor detectada por imagem, ou alpha existente), os pés de todas são
alinhados no mesmo pivô (base central, com a "linha do chão" configurável),
ajuste manual de Y/escala por imagem, "igualar alturas" em um clique, e
exportação de todas no mesmo tamanho com fundo chroma padrão `#00b140`.

## Formato da exportação

Um PNG **por animação** (`projeto_anim.png`) + um manifesto JSON único:

```jsonc
{
  "meta": {
    "project": "heroi",
    "frameSize": { "w": 256, "h": 256 },  // célula única de todas as animações
    "pivot": { "x": 0.5, "y": 1 },        // pivô normalizado (base dos pés)
    "compression": "paleta-256-cores"
  },
  "animations": {
    "idle": {
      "image": "heroi_idle.png",
      "size": { "w": 1024, "h": 768 },
      "columns": 4, "rows": 3,
      "frameCount": 12, "fps": 23, "loop": true, "crossfade": 3,
      "frames": [
        { "name": "idle_000", "index": 0, "x": 0, "y": 0, "w": 256, "h": 256, "duration_ms": 43 }
      ]
    },
    "walk": { "image": "heroi_walk.png", /* ... */ }
  }
}
```

Todos os atlas compartilham a mesma célula e pivô — a engine pode trocar de
animação sem o sprite "pular".

## Limites

- Máximo de 600 frames por extração.
- Atlas final limitado a 16384×16384 px (limite de canvas dos navegadores).
- Requer WebGL2 (qualquer navegador moderno).
- Os projetos vivem no IndexedDB do navegador — limpar dados do site apaga os
  projetos salvos (os vídeos originais continuam no seu disco).
