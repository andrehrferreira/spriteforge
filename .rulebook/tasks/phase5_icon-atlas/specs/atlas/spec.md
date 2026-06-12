# Spec Delta: Biblioteca de ícones e atlas composto

## ADDED Requirements

### Requirement: Biblioteca persistente de ícones

The system SHALL manter uma biblioteca global de ícones no IndexedDB (store
`icons`, schema v3, migração não destrutiva), alimentada pelo fatiador via
botão dedicado que grava cada caixa aparada e encaixada no tamanho de saída.

#### Scenario: Salvar ícones do fatiador
Given 10 caixas detectadas no fatiador com tamanho 64
When o usuário aciona SALVAR P/ ATLAS
Then 10 registros são gravados na biblioteca com nome base_NNN, tamanho 64 e blob PNG

### Requirement: Tela de composição de atlas

The system SHALL oferecer uma tela (acessível pela navbar) listando a
biblioteca com seleção por clique e exclusão; o atlas SHALL usar célula
uniforme igual ao maior tamanho selecionado, layout por computeLayout
(colunas/padding configuráveis) com preview ao vivo, e exportar um ZIP com o
PNG quantizado e um manifesto JSON (posição w/h de cada ícone) gerado por
função pura.

#### Scenario: Compor e exportar um atlas
Given 30 ícones selecionados de tamanhos 64 e 128
When o usuário exporta
Then o atlas usa célula 128, o PNG e o manifesto saem num único ZIP e cada ícone tem x/y/w/h corretos no manifesto

#### Scenario: Atlas acima do limite é bloqueado
Given uma seleção cujo layout excede 16384px
When o usuário tenta exportar
Then a exportação é bloqueada com aviso em pt-BR
