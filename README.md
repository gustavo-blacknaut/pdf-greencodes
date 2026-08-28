# PDF GreenCodes

Suíte de ferramentas de PDF em Next.js, no estilo iLovePDF, com uma diferença de arquitetura:
**o arquivo nunca é enviado para lugar nenhum.** Todo o processamento roda no navegador do usuário,
e o resultado é apagado da memória depois do download.

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>. Em produção o destino é `pdf.greencodes.com.br`.

## Sem servidor, de propósito

O build gera HTML, CSS e JS em `out/` e acabou. Não existe processo de aplicação, rota de API, banco
de dados nem sessão. Isso não é só simplicidade: **não há servidor para invadir, atualizar ou manter
no ar**. A promessa de privacidade deixa de depender de confiança e vira consequência da arquitetura,
o que dá para conferir na aba Rede do navegador.

Depois que a página carrega, a única requisição que o site faz é buscar o worker do pdf.js, que é um
arquivo do próprio site. Nenhum byte do seu documento entra na rede.

O ciclo de vida do resultado está em [`lib/ephemeral.ts`](lib/ephemeral.ts):

- o arquivo gerado vive como `Blob` num cofre em memória, com prazo de 10 minutos e contador na tela;
- o **primeiro** download preserva a cópia, porque é comum o navegador perguntar onde salvar ou a
  pessoa precisar do arquivo de novo;
- o botão então vira **Baixar de novo**: esse segundo download entrega outra cópia e apaga a da
  memória na hora;
- o descarte também acontece no botão "Apagar agora", ao trocar de ferramenta, ao expirar o prazo ou
  ao fechar a aba.

## Pré-carregamento

O peso real dessas ferramentas são as bibliotecas (`@cantoo/pdf-lib` + `pdf.js`, cerca de 1,3 MB
somados). Elas ficam fora do bundle inicial, que é de 115 kB, e são buscadas em três momentos, o que
vier primeiro:

1. quando a thread principal fica ociosa, via `requestIdleCallback`
   ([`components/Warmup.tsx`](components/Warmup.tsx));
2. no `pointerenter` de um card de ferramenta, porque hover é intenção: a rota é prefetchada e o
   motor aquecido;
3. ao abrir a página da ferramenta.

Ao soltar o arquivo, ele já é lido, paginado e miniaturizado **enquanto** o usuário mexe nas opções.

## Ferramentas

20 ferramentas, em 5 categorias. Quatro trabalham com uma grade de miniaturas e duas abrem um editor
sobre a própria página: você vê o documento e mexe nele.

| Ferramenta | Rota | Observação |
|---|---|---|
| Comprimir PDF | `/comprimir-pdf` | 3 níveis; compara com a reescrita sem perda e nunca devolve arquivo maior |
| Juntar PDF | `/juntar-pdf` | ordem por arrastar, ou automática de A a Z e de Z a A |
| **Organizar páginas** | `/organizar-paginas` | grade visual: arrastar para reordenar, girar e excluir |
| **Remover páginas** | `/remover-paginas` | grade visual: clique nas páginas que devem sair |
| **Extrair páginas** | `/extrair-paginas` | grade visual: clique nas páginas que ficam |
| Dividir PDF | `/dividir-pdf` | a cada N páginas ou por intervalos; saída em `.zip` |
| Várias por folha | `/varias-por-folha` | 2 ou 4 páginas por folha A4, com moldura opcional |
| **Girar PDF** | `/girar-pdf` | grade visual: cada clique gira 90°, ou gire todas de uma vez |
| **Assinar PDF** | `/assinar-pdf` | desenhe com o mouse ou o dedo (ou envie uma foto) e arraste até o lugar |
| **Editar PDF** | `/editar-pdf` | caixas de texto, tapar trechos, marca-texto e imagens, em qualquer página |
| Cortar PDF | `/cortar-pdf` | margens por porcentagem em cada lado (CropBox) |
| Redimensionar PDF | `/redimensionar-pdf` | A4, Carta, A3 ou escala livre, preservando a orientação |
| Marca d'água | `/marca-dagua` | texto diagonal, opcional em mosaico |
| PDF para imagem | `/pdf-para-jpg` | JPG/PNG, 72 a 300 DPI, `.zip` com múltiplas páginas |
| Imagem para PDF | `/jpg-para-pdf` | JPG/PNG/WebP, página ajustada ou A4 |
| PDF para texto | `/pdf-para-texto` | extrai o texto embutido; não faz OCR e avisa quando não há texto |
| Extrair imagens | `/extrair-imagens` | imagens embutidas, sem repetir a mesma em páginas diferentes |
| Proteger PDF | `/proteger-pdf` | criptografia AES com senha de abertura e permissões |
| Desbloquear PDF | `/desbloquear-pdf` | remove a senha de um arquivo que você já sabe abrir |
| Limpar metadados | `/limpar-metadados` | zera autor, título, produtor e datas |

Adicionar uma ferramenta é uma entrada em [`lib/tools.ts`](lib/tools.ts), que gera card, rota,
metadados de SEO e o formulário, mais uma função em [`lib/pdf/engine.ts`](lib/pdf/engine.ts).

As quatro ferramentas de grade compartilham o mesmo componente
([`components/PageBoard.tsx`](components/PageBoard.tsx)) e a mesma operação no motor: a grade publica
um plano com as páginas que ficam, em que ordem e com qual rotação, e o motor só remonta o documento.

## O editor e o que ele não é

`Assinar PDF` e `Editar PDF` são o mesmo componente
([`components/PdfEditor.tsx`](components/PdfEditor.tsx)), mudando só por onde começam. Você adiciona
texto, assinatura, imagem, retângulo branco para tapar e marca-texto, arrasta sobre a página e ajusta
o tamanho pelo canto. Nada toca o arquivo enquanto você edita: as alterações viram uma lista e só são
aplicadas ao salvar.

**Ele não edita o texto que já existe no PDF**, e nenhuma ferramenta honesta promete isso sem
ressalvas. O texto num PDF é glifo posicionado com fonte quase sempre embutida em subconjunto: as
letras que você quer digitar podem simplesmente não existir no arquivo, e não há refluxo de linha
nem noção de parágrafo. O caminho que funciona, e é o que as ferramentas de mercado fazem por baixo,
é **tapar o trecho antigo e escrever por cima** — que é exatamente o par "Tapar" + "Texto".

Cuidado com uma consequência: tapar é visual. O texto original continua dentro do arquivo e pode ser
recuperado por quem souber procurar. Para esconder dado sensível de verdade, converta a página em
imagem antes (`PDF para imagem` e depois `Imagem para PDF`).

### Coordenadas, que é onde isso costuma quebrar

A tela mede de cima para baixo e ancora o elemento pelo canto superior esquerdo; o PDF mede de baixo
para cima e ancora pelo inferior esquerdo. O editor guarda tudo como fração da página (0 a 1), e a
conversão vive isolada em [`lib/pdf/layout.ts`](lib/pdf/layout.ts) para poder ser testada sem
navegador.

O preview é renderizado com `rotation: 0` de propósito: assim o que aparece na tela é exatamente o
espaço em que o pdf-lib vai desenhar, e a conversão é uma regra de três. Com a rotação embutida, cada
orientação exigiria uma matriz diferente, e um erro ali colocaria a assinatura no lugar errado sem
ninguém perceber. Páginas com rotação gravada aparecem deitadas no editor, com um aviso sugerindo
endireitar antes com `Girar PDF`.

## Como a compressão funciona

São 3 níveis, e mesmo o mais agressivo precisa render um documento que dá para ler e imprimir. Por
isso o piso é 110 DPI:

| Nível | Resolução | Qualidade JPEG |
|---|---|---|
| Baixa compressão, alta qualidade | 200 DPI | 0.85 |
| Média compressão, média qualidade | 150 DPI | 0.72 |
| Alta compressão, qualidade menor | 110 DPI | 0.55 |

Rasterizar destrói o texto vetorial, então num PDF que já é só texto o arquivo cresceria. O app
sempre compara o resultado com uma reescrita sem perda e fica com o menor dos dois, avisando na
interface qual caminho usou. Se nenhum dos dois ajudar, devolve o original intacto.

## Barreiras contra arquivo hostil

Em [`lib/pdf/guards.ts`](lib/pdf/guards.ts):

- validação por **conteúdo**, não por extensão: um `.pdf` que não traz a assinatura `%PDF-` no
  primeiro kilobyte é recusado antes de chegar ao pdf.js (mesma coisa para JPG, PNG e WebP);
- teto de 150 MB por arquivo, 300 MB por fila e 30 arquivos;
- teto de 5 minutos por operação e botão de cancelar sempre disponível, com o cancelamento
  acontecendo nos pontos onde o laço devolve a thread;
- teto de 300 miniaturas na grade: acima disso as páginas continuam lá, identificadas pelo número;
- pdf.js roda com `isEvalSupported: false`;
- error boundary em [`app/error.tsx`](app/error.tsx) e [`app/global-error.tsx`](app/global-error.tsx),
  para um erro de tela não virar página em branco.

**Isso não torna a leitura de PDF hostil segura.** O pdf.js é código complexo lendo um formato
projetado para ser complexo, e uma falha de memória nele continua possível. As camadas acima reduzem
a superfície e limitam o estrago. Desconfie de qualquer site que prometa proteção total nessa área,
inclusive deste.

O passo seguinte, se o risco justificar, é isolar o interpretador num iframe `sandbox` sem
`allow-same-origin`. É um retrabalho grande e ainda não está feito.

## Testes

```bash
npm test
```

65 testes. A maioria cobre lógica pura, que é onde um erro passa despercebido: o interpretador de
intervalos de página, as barreiras de arquivo, a geometria do editor e a consistência do registro de
ferramentas (slug duplicado, `showIf` apontando para campo inexistente, valor inicial fora da faixa,
grade misturada com editor).

Quatro deles são de integração e valem por muitos: geram um PDF com o pdf-lib usando a mesma fórmula
de coordenadas do editor e leem o resultado de volta com o pdf.js, conferindo onde o texto realmente
caiu. Se alguém um dia "consertar" a inversão do eixo vertical, o teste cai. É a diferença entre a
matemática estar certa e a assinatura ficar no lugar certo.

O que depende de canvas e de interação continua sendo verificado no navegador.

## Privacidade

- Nenhuma requisição de rede carrega o conteúdo do arquivo. Não existe endpoint de upload.
- Sem analytics, sem pixels, sem contadores de uso, sem cookies, sem fontes externas e sem CDN.
  A telemetria do Next está desligada em [`.env`](.env).
- No `localStorage` fica apenas a preferência de tema.
- A senha de Proteger e Desbloquear existe só em memória durante a operação. Não vai para o
  `localStorage`, não entra em URL e não é preenchida automaticamente.

### Cabeçalhos de segurança

Em saída estática o `next.config.mjs` não emite cabeçalhos HTTP, então eles vêm de dois lugares:

- um `<meta http-equiv="Content-Security-Policy">` no [`app/layout.tsx`](app/layout.tsx), que viaja
  junto com o HTML e vale mesmo se o host não for configurado;
- os cabeçalhos completos em [`public/_headers`](public/_headers) (Netlify e Cloudflare Pages) e
  [`vercel.json`](vercel.json).

`frame-ancestors` e `X-Frame-Options` **só funcionam como cabeçalho HTTP**, nunca em meta. Se você
hospedar em outro lugar, replique o conteúdo de `public/_headers` na configuração do servidor. Em
nginx:

```nginx
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'" always;
```

Sobre o `'unsafe-inline'` em `script-src`: o App Router do Next injeta scripts inline com o payload
de renderização, e o conteúdo deles muda a cada página, então hash fixo não cobre. A alternativa
seria nonce, que exige renderização dinâmica e mataria a saída estática. Como aqui não existe
backend, nem entrada de usuário renderizada como HTML, nem conteúdo de terceiros, o vetor de XSS é
mínimo, e o `connect-src 'self'` garante que mesmo um script hostil não teria para onde enviar um
documento.

## O que ele não faz

- **OCR e PDF para Word.** Precisam de modelos pesados; caberiam via WASM, mas mudariam a categoria
  do projeto. `PDF para texto` avisa quando o documento é digitalizado e não tem texto a extrair.
- **Quebrar senha.** `Desbloquear PDF` só funciona com a senha correta em mãos.
- **Arquivos gigantes em aparelhos fracos.** O limite é a RAM da aba. É o preço de não ter servidor.

## Detalhes que custaram caro

Armadilhas encontradas durante os testes, todas documentadas no código:

- **`requestAnimationFrame` não dispara em aba oculta.** Ceder a thread com ele congelava o
  processamento se o usuário trocasse de aba. Trocado por `MessageChannel`, que não sofre throttling.
- **Transição de CSS presa no meio.** Pelo mesmo motivo, a bolinha dos toggles parava no meio do
  caminho e mostrava um estado que não era o real. A posição agora muda sem animação.
- **O pdf.js só materializa imagens quando a página é rasterizada**, e imagens repetidas em várias
  páginas vão para `commonObjs`, não para `objs`. Sem tratar os dois casos, `Extrair imagens`
  esperava para sempre por objetos que nunca chegavam.
- **`backdrop-filter` empilhado em dezenas de cards** rende caixas em branco em rasterização por
  software e GPUs antigas. Os cards usam fundo opaco.
- **Comparar bytes de formatos diferentes engana.** Um PDF virando TXT mostrava "economia de 100%".
  A faixa de comparação agora só aparece nas ferramentas em que encolher é o objetivo.

## Stack

Next.js 15 (App Router, saída estática) · React 19 · TypeScript · Tailwind CSS ·
[@cantoo/pdf-lib](https://www.npmjs.com/package/@cantoo/pdf-lib) (fork do pdf-lib com criptografia) ·
pdf.js · JSZip · Vitest.

## Deploy

```bash
npm run build     # gera out/
npm run preview   # serve out/ localmente para conferir
```

O conteúdo de `out/` são arquivos estáticos: sobe em Vercel, Netlify, Cloudflare Pages, GitHub Pages,
S3 ou qualquer servidor de arquivos. Não há variável de ambiente, banco nem storage para configurar.
