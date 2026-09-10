# A arte original

O `logo-original.png` tem 3464x3464 e 4,7 MB. Ele mora aqui, e nao em
`public/`, por um motivo medido: tudo que esta em `public/` e copiado para
`out/` no build e viaja dentro do instalador — eram 4,7 MB carregados em toda
versao, e o arquivo **nao era referenciado por nada**.

O que o programa usa de verdade:

- `public/logo-128.png` (22 KB) — o simbolo na barra e no cabecalho
- `public/logo.ico` (70 KB) — o icone da janela e do atalho
- `electron/icone.ico` — o icone do instalador

Precisando gerar um tamanho novo, e daqui que ele sai. Nada nesta pasta e
empacotado.
