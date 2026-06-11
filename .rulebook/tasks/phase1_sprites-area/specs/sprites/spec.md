# Spec Delta: Área de SPRITES (geração, análise e persistência de spritesheets)

## ADDED Requirements

### Requirement: Tela SPRITES como etapa própria pós-alinhamento

The system SHALL expor uma tela `'sprites'` no roteamento de `src/main.ts`
(union `Screen` + laço de `show()`), acessível por dois pontos de entrada: um
botão SPRITES no dashboard do projeto e um controle "AVANÇAR → SPRITES" na
tela de alinhamento. Ao abrir, a tela SHALL recomputar loops, bounds e célula
comum do zero com carregamento incremental (padrão do `prepare()` do
alinhamento), reutilizando `ensureFrames` e o cache de sessão `state.frames`.

#### Scenario: Avançar do alinhamento para SPRITES
Given um projeto aberto com ao menos uma animação com conteúdo visível após o chroma
When o usuário aciona "AVANÇAR → SPRITES" na tela de alinhamento
Then `show('sprites')` é chamado, `#screen-sprites` fica visível e as demais telas recebem `hidden`
Then o breadcrumb exibe `<projeto> / sprites` e a navegação oferece "← VOLTAR"

#### Scenario: Entrar direto pelo dashboard
Given um projeto aberto com animações
When o usuário aciona o botão SPRITES no dashboard do projeto
Then a tela SPRITES abre e recomputa loops/bounds/célula incrementalmente, ficando interativa conforme cada animação termina de carregar

#### Scenario: Projeto sem animações exportáveis
Given um projeto cujas animações não têm nenhum frame com conteúdo visível após o chroma
When o usuário tenta gerar spritesheets na área SPRITES
Then o sistema exibe aviso em pt-BR ("NENHUM FRAME PARA EXPORTAR" ou equivalente) e não persiste nada

#### Scenario: Compilação com o novo membro do union
Given o tipo `Screen` em `src/main.ts` com `'sprites'`
When o código é compilado com `tsc --noEmit`
Then não há erro de tipo e nenhum uso de `any`

### Requirement: Modelo de dados de correções e spritesheets

The system SHALL estender `src/types.ts` com `CorrectionKind` (union fechado
das 8 categorias: proporção, continuidade, frames duplicados, recorte de
célula, quantização, escala, correção de pixel, ajuste de posição),
`Correction` (kind, severity, target por projeto/animação/frame, parâmetros
ajustáveis), `SpriteSheet` (id, projectId, version, createdAt, blobs PNG por
animação, metadados de geração, correções aplicadas) e `SpritesCfg`
(limiares default). `ProjectData` SHALL ganhar apenas `spritesCfg`.

#### Scenario: Switch exaustivo sobre o kind
Given um `switch` sobre `Correction['kind']`
When uma nova categoria é adicionada ao union sem tratar o caso
Then a compilação falha pelo guard `const _exhaustive: never`

#### Scenario: Projeto antigo abre sem os novos campos
Given um `ProjectData` salvo antes desta feature, sem `spritesCfg`
When o projeto é aberto via `openProjectState`
Then `spritesCfg` é preenchido com os defaults (espelhando o backfill de `refs`), sem erro e sem reescrever o projeto silenciosamente

### Requirement: Persistência em store IndexedDB separado

The system SHALL fazer bump do IndexedDB para a versão 2 com um novo store
`spritesheets` (keyPath `id`, índice `projectId`) em migração não destrutiva,
de modo que os atlas fiquem desacoplados do registro do projeto e
`saveProject` não reserialize blobs de PNG. O manifesto JSON SHALL NOT ser
persistido: ele é regenerado no download a partir dos metadados salvos.

#### Scenario: Migração preserva projetos existentes
Given um banco `spriteforge` na versão 1 com projetos salvos
When o app abre com o schema v2
Then o store `projects` permanece intacto e o store `spritesheets` é criado vazio

#### Scenario: Salvar projeto não reserializa atlas
Given um projeto com spritesheets persistidos
When o usuário edita o nome do projeto e `saveProject` roda
Then apenas o registro do projeto é gravado; nenhum blob de atlas é reescrito

#### Scenario: Quota excedida não corrompe dados
Given o IndexedDB próximo da quota do navegador
When a persistência de um `SpriteSheet` falha com `QuotaExceededError`
Then o sistema captura o erro, exibe mensagem clara em pt-BR e os dados já salvos permanecem íntegros

### Requirement: Motor de análise determinístico e não destrutivo

The system SHALL fornecer um módulo `src/analyze.ts` que, dadas as animações
alinhadas e a célula/pivô comum, retorna uma lista determinística de
`Correction[]` cobrindo as 8 categorias. Para a mesma entrada e configuração,
a saída SHALL ser idêntica (mesmo conteúdo, mesma ordem). As comparações de
pixel SHALL rodar em resolução reduzida (lado máximo 384px, pós-chroma, RGBA
premultiplicado) com limiares default registrados em `spritesCfg`, e o canvas
reutilizado de `loop.render(p)` SHALL ser copiado antes de qualquer leitura.
Nenhuma proposta SHALL alterar `AnimationData`, `selected`, bitmaps ou chroma.

#### Scenario: Análise é reprodutível
Given o mesmo conjunto de animações alinhadas, mesma célula/pivô e mesma configuração
When a análise é executada duas vezes
Then as duas listas de `Correction` são iguais em conteúdo e ordem

#### Scenario: Proporção inconsistente é detectada
Given duas animações cujos bounding boxes resultam em escalas efetivas divergentes além do limiar de `spritesCfg`
When a análise roda
Then é emitida uma proposta de proporção com `target` nas animações afetadas e o fator de ajuste sugerido
Then nenhum dado da animação é alterado pela proposta

#### Scenario: Frames duplicados são apontados com economia estimada
Given uma animação com frames consecutivos cuja diferença fica abaixo do limiar (% de pixels diferentes em resolução reduzida)
When a análise roda
Then é emitida uma proposta de remoção indicando os índices candidatos e a economia estimada em bytes, formatada em pt-BR

#### Scenario: Redução de arquivo é proposta
Given uma célula comum maior que o bounding box real, ou contagem de cores acima da paleta necessária
When a análise roda
Then são emitidas propostas de recorte de célula, quantização e/ou escala, cada uma com impacto estimado em bytes

#### Scenario: Correções de pixel não são aplicadas em silêncio
Given frames com artefatos residuais de chroma ou pixels órfãos isolados
When a análise roda
Then é emitida uma proposta descrevendo o ajuste, e nada é gravado até o usuário aceitar

#### Scenario: Nenhuma correção encontrada
Given animações já consistentes entre si
When a análise roda e a lista de propostas volta vazia
Then a UI mostra o estado "nenhuma correção sugerida" em pt-BR e a geração continua disponível

### Requirement: Revisão de propostas antes da geração

The system SHALL listar as propostas na área SPRITES permitindo aceitar,
rejeitar ou ajustar os parâmetros de cada uma; somente as aceitas SHALL
influenciar a geração. As correções de pixel e de posição SHALL ser aplicadas
exclusivamente na rasterização da célula do atlas (pós-processo no canvas da
célula, antes do encode) — nunca dentro de `createLoop`/chroma — e a remoção
de frames SHALL ocorrer por omissão no atlas, sem tocar `anim.selected`.

#### Scenario: Rejeitar não altera a saída
Given uma proposta listada
When o usuário a rejeita e gera os spritesheets
Then a geração ocorre como se a proposta não existisse e ela não consta nas correções aplicadas

#### Scenario: Proposta ajustada grava o parâmetro ajustado
Given uma proposta cujo parâmetro foi alterado pelo usuário antes de aceitar
When os spritesheets são gerados
Then o efeito aplicado e o registro no `SpriteSheet` refletem o parâmetro ajustado, não o originalmente proposto

#### Scenario: Editor e alinhamento não são afetados
Given correções de pixel aceitas e aplicadas na geração
When o usuário volta ao editor ou ao alinhamento
Then os previews exibem os frames originais, sem nenhuma das correções da área SPRITES

### Requirement: Geração persistida com versionamento

The system SHALL gerar 1 atlas PNG por animação reutilizando `computeLayout` e
`encodeCanvas` de `src/export.ts`, persistindo cada geração como um
`SpriteSheet` no store `spritesheets` com `version` incremental, metadados
completos e as correções aplicadas. A validação de `MAX_SHEET_DIM` (16384px)
SHALL rodar APÓS a aplicação das correções aceitas; quando exceder, o sistema
SHALL propor automaticamente uma correção de escala e, persistindo o excesso,
bloquear a geração com aviso em pt-BR.

#### Scenario: Geração equivalente à atual sem correções
Given a mesma célula, pivô e configuração de exportação do fluxo atual e nenhuma correção aceita
When o sistema gera os atlas
Then o resultado por animação é equivalente ao que `buildAtlasFor` produzia (mesma célula, mesmo pivô, mesma contagem de frames)

#### Scenario: Versão anterior é preservada
Given um projeto que já tem um `SpriteSheet` salvo
When o usuário gera novamente com configuração diferente
Then o registro anterior permanece no store e o novo recebe `version` incrementada

#### Scenario: Limite revalidado após correções
Given correções aceitas que alteram escala/recorte
When o tamanho final calculado de um atlas excede 16384px
Then a geração é bloqueada com aviso em pt-BR e uma correção de escala é proposta automaticamente

#### Scenario: Falha de encode não deixa registro parcial
Given `encodeCanvas` rejeita para uma das animações
When a geração roda
Then o erro informa qual animação falhou, nenhum `SpriteSheet` parcial é persistido e as demais animações não são corrompidas

#### Scenario: Sair da tela durante a geração
Given uma geração ou análise em andamento
When o usuário navega para outra tela (cleanup é chamado)
Then a flag de aborto interrompe o trabalho, o contexto WebGL2 é liberado e nenhum registro parcial é persistido

#### Scenario: Persistência sobrevive ao recarregar
Given um spritesheet gerado e salvo
When o usuário fecha e reabre o projeto
Then as versões aparecem na área SPRITES com seus metadados intactos

### Requirement: Download em ZIP, regeração e exclusão de versões

The system SHALL permitir baixar uma versão salva como um único arquivo ZIP
(via `fflate`) contendo os PNGs por animação e o manifesto JSON regenerado dos
metadados com `meta.version = 4` (versão de formato, distinta da `version` de
geração); regerar uma versão a partir dos seus metadados; e excluir uma versão
mantendo as demais. Slugs de animação colidentes SHALL ser desambiguados com
sufixo `_2`, mantendo consistência manifesto↔imagem.

#### Scenario: Baixar versão como ZIP único
Given um `SpriteSheet` persistido
When o usuário aciona "baixar"
Then um único `.zip` é entregue contendo os PNGs por animação e o manifesto que referencia exatamente esses nomes de arquivo

#### Scenario: Regerar a partir dos metadados
Given um `SpriteSheet` salvo com metadados e correções aplicadas
When o usuário aciona "regerar"
Then o sistema reconstrói os atlas com os mesmos parâmetros registrados e produz resultado equivalente

#### Scenario: Regerar com animações divergentes
Given um `SpriteSheet` salvo cujo conjunto de animações mudou (animação removida ou renomeada desde a geração)
When a regeração roda
Then o sistema reporta a divergência em pt-BR e continua com as animações disponíveis, sem travar

#### Scenario: Excluir uma versão
Given um projeto com múltiplas versões salvas
When o usuário exclui uma versão
Then ela é removida do store e as demais permanecem intactas

### Requirement: Detecção de versões desatualizadas (stale)

The system SHALL detectar quando uma animação foi editada (frames, chroma,
curva, seleção ou alinhamento) após a geração de um `SpriteSheet` e marcar as
versões afetadas como desatualizadas na área SPRITES, com aviso de regeração.

#### Scenario: Edição posterior marca a versão como desatualizada
Given um `SpriteSheet` gerado e salvo
When o usuário edita o chroma de uma animação e volta à área SPRITES
Then a versão salva aparece marcada como desatualizada ("precisa regerar") em pt-BR

### Requirement: UI da área SPRITES em pt-BR no tema pixel/CRT

The system SHALL adicionar `#screen-sprites` ao `index.html` e ao
`src/style.css` seguindo o padrão visual existente (alternância via classe
`hidden`, fontes Silkscreen/IBM Plex Mono, paleta CRT), com painel de
propostas, pré-visualização, configuração de exportação e lista de versões. O
utilitário `formatBytes` SHALL ser extraído para módulo compartilhado em vez
de duplicado.

#### Scenario: Tela segue o padrão visual e o idioma
Given a tela SPRITES exibida
When seus elementos são inspecionados
Then todos os rótulos, dicas, avisos e propostas estão em pt-BR e usam o tema pixel/CRT existente

## MODIFIED Requirements

### Requirement: Tela de alinhamento sem responsabilidade de exportação

The system SHALL reduzir a tela de alinhamento ao escopo de célula comum,
pivô, margem, ghost e ajuste fino por animação. A configuração de exportação
(`exportCfg`) SHALL continuar persistida no projeto e passar a ser editada na
área SPRITES, sem perda dos valores existentes.

#### Scenario: Alinhamento mantém só o alinhamento
Given a tela de alinhamento após a migração
When o usuário interage com seus controles
Then célula/pivô/margem, ghost e ajuste fino (incluindo arraste no preview) funcionam como antes e não existe nenhum controle de exportação

#### Scenario: Configuração de exportação não se perde
Given um projeto cujo `exportCfg` já tinha valores definidos
When o usuário abre a área SPRITES
Then escala, padding, colunas e compactação aparecem com os valores salvos e seguem editáveis

## REMOVED Requirements

### Requirement: Exportação de atlas na tela de alinhamento

The system SHALL NOT expor geração de atlas, manifesto ou download na tela de
alinhamento após a migração.

**Reason**: a exportação migra para a área SPRITES (decisão de remoção limpa,
sem período de coexistência).
**Migration**: `buildAtlasFor`, `animLayouts`, o handler de `#btn-export-all`
e os controles `aexp-*` saem de `src/align.ts` e do `#screen-align` no
`index.html`; a lógica é reaproveitada em `src/sprites.ts`. Após a migração,
`tsc --noEmit` não acusa referências mortas no alinhamento.
