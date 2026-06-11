# Spec Delta: Fatiador de sprites de itens

## ADDED Requirements

### Requirement: Detecção automática dos itens na folha

The system SHALL detectar automaticamente os itens de uma folha: imagens com
alpha são usadas direto e imagens com fundo sólido SHALL ter o fundo removido
por flood fill a partir das bordas; os itens são encontrados por componentes
conectados (8-conectividade) sobre a máscara de alpha com limiar
configurável, caixas próximas SHALL ser fundidas pela distância configurada e
o resultado SHALL ser ordenado em ordem de leitura (linhas → colunas).

#### Scenario: Folha de gemas em grade é detectada
Given uma folha com 30 itens separados por transparência
When a detecção roda com os parâmetros padrão
Then 30 caixas são propostas, numeradas em ordem de leitura

#### Scenario: Brilhos soltos não viram itens separados
Given um item com partículas de brilho desconectadas a poucos px do corpo
When a detecção roda com distância de fusão padrão
Then o brilho é fundido na caixa do item, e componentes menores que a área mínima são ignorados

### Requirement: Preview com ajuste manual dos cortes

The system SHALL mostrar as caixas sobre a imagem num preview interativo:
clique seleciona, arrastar move, alça de canto redimensiona, arrastar em área
vazia cria caixa nova e a seleção pode ser excluída ou ajustada por campos
numéricos X/Y/L/A; REDETECTAR SHALL reexecutar a detecção com os parâmetros
atuais.

#### Scenario: Ajustar uma caixa antes de exportar
Given uma caixa detectada cortando parte de um item
When o usuário arrasta a alça de redimensionar
Then a caixa muda em tempo real no preview e a exportação usa a caixa ajustada

### Requirement: Exportação uniforme em ZIP

The system SHALL exportar cada caixa como PNG quadrado no tamanho escolhido
(32/48/64/96/128, padrão 64×64), com o conteúdo centralizado preservando a
proporção e respeitando a margem interna configurada, quantizado via UPNG
(padrão 256 cores), nomeado `base_NNN.png` em ordem de leitura e entregue num
único arquivo ZIP.

#### Scenario: Trinta itens viram trinta PNGs 64x64 num ZIP
Given 30 caixas confirmadas e tamanho 64
When o usuário exporta
Then um ZIP é baixado com 30 PNGs de 64×64, transparentes, com cada item centralizado e nomes base_001..base_030

#### Scenario: Item retangular não é distorcido
Given uma caixa mais larga que alta
When o item é encaixado no quadrado de saída
Then a proporção é preservada (escala pelo maior lado) e o conteúdo fica centralizado com margem
