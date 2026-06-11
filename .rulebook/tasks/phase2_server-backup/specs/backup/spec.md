# Spec Delta: Backup persistente em servidor local

## ADDED Requirements

### Requirement: Servidor local de backups com escrita atômica

The system SHALL fornecer um servidor Node sem dependências
(`server/server.mjs`) expondo `/api/health` e `/api/backups` (listar GET,
baixar GET `/:id`, enviar PUT `/:id`, excluir DELETE `/:id`), gravando cada
backup como `data/backups/<id>.sfproj` com escrita atômica (tmp + rename) e
metadados (nome, updatedAt, tamanho) num sidecar JSON.

#### Scenario: Upload grava com escrita atômica
Given o servidor rodando
When o cliente envia PUT /api/backups/abc com o corpo binário
Then o arquivo é escrito como tmp e renomeado para abc.sfproj, e o sidecar abc.json registra nome, updatedAt e tamanho

#### Scenario: Id inválido é rejeitado
Given uma requisição com id fora de `[\w-]{1,64}`
When o servidor a processa
Then responde 400 sem tocar o disco

### Requirement: Formato .sfproj completo e reversível

The system SHALL empacotar o projeto completo (ProjectData com vídeos,
thumbs e referências + todos os SpriteSheets com seus PNGs) num zip
`.sfproj` e SHALL reconstruí-lo de volta sem perdas (roundtrip): blobs
restaurados com o mesmo conteúdo e type.

#### Scenario: Roundtrip preserva blobs e metadados
Given um projeto com animação (vídeo + thumb), referência e um SpriteSheet
When packProject é seguido de unpackProject
Then os campos JSON são iguais e cada blob restaurado tem o mesmo conteúdo e MIME type

### Requirement: Auto-backup com debounce e tolerância a servidor ausente

The system SHALL agendar backup automático (debounce ≥ 10s) após
`saveProject` e após gravar/excluir spritesheets; quando o servidor não
responde, o app SHALL continuar funcionando normalmente, sem erros visíveis
repetidos.

#### Scenario: Servidor desligado não quebra o app
Given o servidor de backup não está rodando
When o usuário edita e salva o projeto
Then o app funciona normalmente e o backup é silenciosamente ignorado

### Requirement: Restauração pela tela inicial

The system SHALL listar na home os backups do servidor que não existem no
IndexedDB, permitindo RESTAURAR (regrava projeto e spritesheets no
IndexedDB e abre o projeto) e excluir o backup; o dashboard SHALL oferecer
um botão de backup manual.

#### Scenario: Navegador vazio recupera do servidor
Given um navegador sem dados do IndexedDB e backups existentes no servidor
When o usuário abre a home
Then os backups aparecem como cards "no servidor" e RESTAURAR reconstrói o projeto completo, incluindo as versões de spritesheet
