# Spec Delta: Shell completo (navbar global, gerador de imagem, previews)

## ADDED Requirements

### Requirement: Navbar global de ferramentas com tooltips

The system SHALL exibir no topo, em todas as telas, uma navbar de ícones com
tooltips para Gerador de Imagem, Normalizador, Fatiador de Sprites e Gerador
de Vídeo, com indicação visual da ferramenta ativa. O Gerador de Vídeo SHALL
exigir projeto aberto, avisando em pt-BR quando não houver.

#### Scenario: Navegar para uma ferramenta de qualquer tela
Given o usuário em qualquer tela do app
When ele clica num ícone da navbar
Then a ferramenta correspondente abre e o ícone fica marcado como ativo

#### Scenario: Gerador de vídeo sem projeto aberto
Given nenhum projeto aberto
When o usuário clica no ícone do Gerador de Vídeo
Then um aviso em pt-BR pede para abrir um projeto e a tela não muda

### Requirement: Gerador de imagem via OpenRouter

The system SHALL gerar imagens via POST /api/v1/chat/completions com
modalities ["image","text"] e image_config (aspecto e tamanho), aceitando
referências opcionais como image_url na mensagem; as imagens da resposta
(data URLs base64) SHALL ser extraídas por função pura testável e exibidas
numa galeria da sessão com download e, com projeto aberto, adição direta às
referências do projeto.

#### Scenario: Gerar imagem com referência
Given uma API key válida, um prompt e uma referência anexada
When o usuário gera
Then a requisição inclui o texto e a imagem na mensagem e a galeria mostra o resultado decodificado do base64

#### Scenario: Resposta sem imagens é tratada
Given uma resposta da API sem o campo images
When a extração roda
Then retorna lista vazia e a UI mostra erro amigável em pt-BR, sem exceção não tratada

### Requirement: Home com preview visual dos projetos

The system SHALL mostrar em cada card de projeto na home uma faixa com até 6
miniaturas (thumbs das animações e referências) para identificação visual.

#### Scenario: Projeto com animações mostra miniaturas
Given um projeto com animações com thumb salvo
When a home é renderizada
Then o card do projeto exibe a faixa de miniaturas correspondente
