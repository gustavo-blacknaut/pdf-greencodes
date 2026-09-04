# PDF.GreenCodes

52 ferramentas de PDF que rodam inteiras na sua máquina. Sem upload, sem servidor, sem conta.
Roda como site em [pdf.greencodes.com.br](https://pdf.greencodes.com.br) e como aplicativo de
desktop no Windows.

O aplicativo foi feito para gráfica: converte RGB para CMYK sem rasterizar, imprime em 600 e
1200 DPI, chega no tipo de papel do driver da impressora, e o preto puro sai **C20 M20 Y0 K100** em
vez das quatro tintas que um perfil ICC entregaria.

```bash
npm install
npm run dev          # site em http://localhost:3000
npm run app:dev      # aplicativo de desktop
```

---

## Por que não tem upload

Quase todo site de PDF recebe o seu arquivo, processa num servidor e promete apagar depois. Aqui a
promessa é outra, e ela não depende de confiança: **o servidor nunca recebe o documento.**

O arquivo é lido pela File API e processado na memória da aba, com `pdf-lib` e `pdf.js`. O build
gera HTML, CSS e JS estáticos em `out/` — não existe rota de API, banco de dados nem processo de
aplicação. Dá para conferir: abra a aba **Rede** do navegador e rode qualquer ferramenta. A única
requisição é o worker do pdf.js, que é arquivo do próprio site.

O resultado vive num cofre em memória com prazo de 10 minutos e contador na tela. O primeiro
download preserva a cópia, porque é comum o navegador perguntar onde salvar. O botão então vira
**Baixar de novo**: essa segunda cópia apaga a da memória na hora.

No aplicativo é diferente, e por um motivo: ali o arquivo é gravado em disco e é seu. O prazo some,
o processamento pesado sai da aba e vai para um processo Python local, e nada disso muda a única
coisa que importa aqui — **o documento não sai da máquina em nenhum dos dois.**

---

## As 52 ferramentas

| Organizar | Editar | Converter | Otimizar e cor | Privacidade |
|---|---|---|---|---|
| **Juntar PDF** | Assinar PDF | PDF para imagem | Comprimir PDF | Proteger PDF |
| Organizar páginas | Editar PDF | Imagem para PDF | RGB para CMYK | Desbloquear PDF |
| Remover páginas | Girar PDF | PDF para texto | Tons de cinza | Limpar metadados |
| Extrair páginas | Cortar PDF | PDF para Word | Tons de preto | Definir metadados |
| Dividir PDF | Redimensionar PDF | Word para PDF | Inverter cor | |
| Dividir páginas | Marca d'água | Excel para PDF | Reparar PDF | |
| Várias por folha | Numerar páginas | PowerPoint para PDF | | |
| Inverter páginas | Cabeçalho e rodapé | Texto para PDF | | |
| Intercalar PDF | Achatar PDF | OCR: PDF pesquisável | | |
| Livreto | | Extrair imagens | | |
| Separar pares e ímpares | | | | |
| Páginas em branco | | | | |

E a categoria **Gráfica**, que é o serviço entre a arte pronta e a máquina:

| | |
|---|---|
| **Marcas de corte** | sangria e marca para a guilhotina |
| **Cartão de visita** | enche a folha e marca as ruas para o corte |
| **Etiquetas e adesivos** | a mesma grade, com a medida que você quiser |
| **Numeração sequencial** | talão, ingresso, rifa e senha |
| **Espelhar PDF** | sublimação, transfer e serigrafia |
| **Repetir páginas** | a tiragem toda num arquivo só |
| **Conferir antes de imprimir** | acha a foto borrada e a fonte que falta |
| **Folha de fotos** | 3x4, passaporte, 5x7, polaroid, adesivo, revelação |
| **Separar chapas** | cada cor sozinha, como vai para a chapa |
| **Cobertura de tinta** | antes de o papel encharcar |

Mais **Imprimir**, que tem tela própria. Quatro ferramentas só existem no aplicativo — *RGB para
CMYK*, *Folha de fotos*, *Separar chapas* e *Cobertura de tinta* —, porque dependem do motor
Python para ler a página em quatro canais. **No site elas nem aparecem na lista**: o site é 100%
JavaScript e roda inteiro no navegador, e mostrar uma tela que não entrega o que promete seria pior
que não ter a ferramenta.

Quatro delas trabalham com uma **grade de miniaturas** em vez de formulário: organizar, remover,
extrair e girar. Você vê o documento e clica nele. Outras duas abrem um **editor sobre a página**:
assinar e editar.

### Juntar PDF, o carro-chefe

Aceita PDFs e imagens misturados, na ordem que você definir arrastando os cards ou ordenando pelo
nome (a comparação é numérica, então `arquivo 2` vem antes de `arquivo 10`).

Arquivo protegido por senha entra também: o campo de senha aparece no próprio card, o botão fica
travado até você informá-la, e **o resultado sai sem senha**.

### Assinar e editar

Desenhe a assinatura com o mouse ou o dedo, ou envie uma foto dela. O traço é recortado no contorno,
então entra no documento sem moldura branca em volta. Depois é só arrastar até o lugar e ajustar o
tamanho pelo canto.

O editor completo acrescenta caixa de texto, retângulo branco para cobrir um trecho e escrever por
cima, e marca-texto.

**Ele não edita o texto que já existe no PDF**, e nenhuma ferramenta honesta promete isso sem
ressalvas: o texto num PDF é glifo posicionado com fonte quase sempre embutida em subconjunto, então
as letras que você quer digitar podem simplesmente não existir no arquivo. O caminho que funciona,
e é o que as ferramentas de mercado fazem por baixo, é **tapar e escrever por cima**.

> Cuidado: tapar é visual. O texto original continua dentro do arquivo. Para esconder dado sensível
> de verdade, converta a página em imagem antes (`PDF para imagem` e depois `Imagem para PDF`).

### Comprimir

| Nível | O que faz |
|---|---|
| **Sem perda** (padrão) | Reescreve a estrutura interna. Não altera nem um pixel. |
| Equilibrada | 150 DPI. As páginas viram imagem. |
| Máxima | 110 DPI. Menor arquivo. |

O padrão é sem perda de propósito. Rasterizar reduz muito mais, mas converte tudo para sRGB e o
JPEG ainda faz subamostragem de croma: um PDF em CMYK ou com perfil ICC sai com a cor visivelmente
diferente. Quem pede "só comprimir" não espera isso, então virou escolha explícita.

Nos dois modos com perda, o resultado é comparado com a reescrita sem perda e com o arquivo
original, e entregamos o menor dos três. Se nada ajudar, você recebe o original intacto.

---

## Aplicativo de desktop

O app não é o site numa janela. Ele faz o que só um programa instalado consegue:

- **Menu do botão direito no Explorador.** Clique em um PDF e escolha *Abrir no PDF.GreenCodes*.
  Selecione vários e escolha *Juntar com o PDF.GreenCodes* — todos chegam de uma vez, porque a
  chave usa `MultiSelectModel=Player` em vez de abrir uma janela por arquivo.
- **Salva sozinho em `Downloads/PDF.GreenCodes`.** O nome é o primeiro número livre — `1.pdf`,
  `2.pdf`, `3.pdf`. Quem processa vinte documentos seguidos não quer escolher pasta e nome vinte
  vezes. Também há o diálogo nativo, e um atalho *Mostrar na pasta*.
- **Sem prazo de expiração.** O contador de 10 minutos some: o disco é seu. Se o arquivo era só
  para imprimir agora, dá para marcar *Apagar sozinho em 1 dia* — por arquivo, e a marca pode ser
  posta ou tirada depois de salvar.
- **Abertura por clique duplo e "Abrir com".** O arquivo cai direto na ferramenta que estiver aberta.
- **Vive na bandeja** e inicia com o Windows em modo oculto, sem pular na cara ao ligar o computador.

```bash
npm run app:build    # gera o instalador em dist-app/
```

As duas integrações (menu do botão direito e início automático) são opcionais e ficam no menu da
bandeja. As chaves de registro vão em `HKCU`, e não em `HKLM`: não pedem elevação, não sequestram o
programa padrão do `.pdf` e somem junto com o perfil do usuário.

### Como o app é montado por dentro

A interface é servida por um **servidor HTTP local**, e não por `file://`, porque o pdf.js carrega o
worker com `new URL(...)` e o protocolo de arquivo bloqueia isso. O servidor só entrega o que está
dentro de `out/`, com trava de diretório testada contra travessia codificada em percentual.

A janela roda com `contextIsolation` e `sandbox` ligados: a página não tem Node nem acesso ao disco.
Tudo que ela consegue fazer passa por uma lista fechada de canais em `electron/preload.js`, cada um
validado do outro lado. Não existe `invoke` genérico de propósito — assim uma falha na interface não
vira acesso ao sistema de arquivos.

### Três linguagens, e por que cada uma

O aplicativo usa JavaScript, Python e C#. Não por gosto: cada parte foi para onde a alternativa
media pior.

| Parte | Linguagem | Por quê |
|---|---|---|
| Interface | TypeScript / React | É a mesma tela do site. Escrever duas vezes seria manter duas. |
| Motor de PDF | Python (PyMuPDF) | Velocidade medida, não suposta. |
| Impressão | C# (.NET Framework) | É o único caminho até o driver da impressora. |

**O motor.** Rasterizar página no pdf.js é lento. No mesmo arquivo de 141 páginas: **1189 ms por
página no pdf.js contra 277 ms no PyMuPDF**, com o arquivo de saída do mesmo tamanho. Só as
ferramentas que rasterizam passam por lá; as que mexem na estrutura do PDF continuam na janela,
onde já eram rápidas. A conversa é por linhas de JSON no stdin/stdout de um processo só, que sobe
uma vez e fica.

O Python vai embutido na instalação (distribuição *embeddable*), então **não é preciso ter Python
na máquina**. Ele fica em `motor/runtime/`, que é ignorado pelo git — quem clona roda o script de
preparo, e quem instala recebe pronto.

**A impressão.** O Chromium não expõe tipo e espessura de papel — comum, fotográfico, cartão. Essa
escolha não é do sistema de impressão, é do driver, e no Windows só se chega nela pelo
`DocumentProperties` com uma DEVMODE. Daí o executável em C#, compilado pelo `csc.exe` que já vem
no Windows (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`): **não é preciso instalar o SDK do
.NET**, e o binário de 12 KB roda em qualquer Windows 10 ou 11 sem runtime junto.

### O preto que sai preto

`RGB para CMYK` e `Tons de preto` existem por um motivo prático de gráfica. Um preto RGB convertido
por perfil ICC vira algo como **C72 M67 Y67 K88**: quatro tintas fazendo o trabalho de uma, papel
encharcado, e franja colorida no texto fino se as chapas saírem de registro.

Aqui o preto neutro é reescrito como **C20 M20 Y0 K100** — a chapa preta faz o preto, e um pouco de
ciano e magenta dão profundidade sem sujar. Cinza neutro sai em K puro. Cor de verdade e foto ficam
como estão.

O documento ainda é marcado como `/DeviceCMYK`. Sem isso o MuPDF grava um `ICCBased`, e um perfil é
permissão para o RIP reconverter — o K100 que você mandou chegaria na impressora em quatro tintas
de novo.

Nada disso rasteriza: o `recolor` do MuPDF converte vetor, texto e imagem embutida de uma vez. Um
contrato de 200 KB continua com 200 KB, e não vira 40 MB de imagem.

---

## Rodando e testando

```bash
npm run dev          # desenvolvimento
npm run build        # gera out/
npm run preview      # serve out/ para conferir o build
npm run verificar    # tamanho dos arquivos + typecheck + os 225 testes
npm run motor        # os 222 testes do motor Python
npm run impressora   # compila o executavel de impressao em C#
```

Os testes cobrem a lógica pura, que é onde erro passa despercebido: interpretador de intervalos de
página, barreiras de arquivo, geometria do editor e consistência do registro de ferramentas.

Alguns são de integração e valem por muitos: geram PDFs de verdade com o pdf-lib e leem o resultado
de volta com o pdf.js. É o que garante que a assinatura cai no lugar certo e que o merge não volta a
sair em branco. Do lado do Python, os testes abrem cada saída de volta com o PyMuPDF e conferem a
cor no fluxo de conteúdo — é assim que se sabe que o K100 continuou K100.

`npm run verificar` também recusa arquivo com mais de 800 linhas. É arbitrário de propósito: passar
disso quase sempre quer dizer que dois assuntos foram parar no mesmo lugar.

---

## Bugs que custaram caro

Estão documentados no código, porque cada um levou tempo para achar.

**Juntar gerava arquivo em branco.** O documento era aberto com `ignoreEncryption: true`, que abre o
PDF sem descriptografar. As páginas existem, a contagem bate, a miniatura até aparece, e o conteúdo
copiado continua cifrado. O caso que pega na prática é o PDF protegido só com senha de dono — prova,
boleto, extrato: abre normalmente em qualquer leitor e nunca pede senha, então ninguém desconfia.
Agora abrimos sempre com senha (vazia por padrão) e há 7 testes de regressão.

**Páginas saíam cinza ou pretas ao juntar.** Muitos PDFs não desenham fundo e contam com o papel
branco do leitor. Quando a página tem grupo de transparência, esse fundo some. A correção pinta um
retângulo branco **antes** do conteúdo via `wrapContentStreams`, o que preserva links, anotações e
campos de formulário — reembrulhar a página num XObject perderia tudo isso.

**"Várias por folha" comia meio centímetro de cada lado.** O espaçamento era aplicado também nas
bordas externas (`gap * (colunas + 1)`). Agora espaçamento interno e margem externa são
independentes e ambos começam em zero: o PDF não precisa de margem de segurança, quem cuida disso é
a impressora.

**`requestAnimationFrame` não dispara em aba oculta.** Ceder a thread com ele congelava o
processamento se a pessoa trocasse de aba. Trocado por `MessageChannel`, que não sofre throttling.
Pelo mesmo motivo, a bolinha dos toggles parava no meio do caminho e mostrava um estado que não era
o real — a posição agora muda sem animação.

**O pdf.js só materializa imagens quando a página é rasterizada**, e imagens repetidas em várias
páginas vão para `commonObjs`, não para `objs`. Sem tratar os dois casos, `Extrair imagens` esperava
para sempre por objetos que nunca chegavam.

**`backdrop-filter` empilhado em dezenas de cards** rende caixas em branco em rasterização por
software e GPUs antigas. Os cards usam fundo opaco.

**Item de grid tem `min-width: auto`.** Sem `min-w-0` nas colunas, conteúdo largo esticava a coluna
e criava rolagem horizontal no celular.

---

## Segurança

O arquivo que entra é de origem desconhecida, então:

- validação por **conteúdo**, não por extensão: um `.pdf` que não traz a assinatura `%PDF-` no
  primeiro kilobyte é recusado antes de chegar ao pdf.js;
- teto de 150 MB por arquivo, 1 GB por fila e 100 arquivos;
- teto de 5 minutos por operação, com botão de cancelar sempre disponível;
- teto de 300 miniaturas na grade;
- pdf.js roda com `isEvalSupported: false`;
- error boundary para um erro de tela não virar página em branco.

**Isso não torna a leitura de PDF hostil segura.** O pdf.js é código complexo lendo um formato
projetado para ser complexo. As camadas acima reduzem a superfície e limitam o estrago. Desconfie de
qualquer site que prometa proteção total nessa área, inclusive deste.

### Cabeçalhos

Em saída estática o `next.config.mjs` não emite cabeçalhos HTTP, então eles vêm de dois lugares: um
`<meta http-equiv="Content-Security-Policy">` no layout, que viaja junto com o HTML, e os cabeçalhos
completos em [`public/_headers`](public/_headers) e [`vercel.json`](vercel.json).

`frame-ancestors` e `X-Frame-Options` **só funcionam como cabeçalho HTTP**, nunca em meta. Se
hospedar em outro lugar, replique o conteúdo de `public/_headers`.

Sobre o `'unsafe-inline'` em `script-src`: o App Router injeta scripts inline com o payload de
renderização, e o conteúdo muda a cada página, então hash fixo não cobre. A alternativa seria nonce,
que exige renderização dinâmica e mataria a saída estática. Como não existe backend, nem entrada de
usuário renderizada como HTML, nem conteúdo de terceiros, o vetor de XSS é mínimo — e o
`connect-src 'self'` garante que nem um script hostil teria para onde enviar um documento.

---

## Privacidade

- Nenhuma requisição carrega o conteúdo do arquivo. Não existe endpoint de upload.
- Sem analytics, sem pixels, sem contadores de uso, sem cookies, sem fontes externas, sem CDN.
  A telemetria do Next está desligada.
- O único uso de armazenamento local é o cache do motor de OCR (IndexedDB), guardado depois do
  primeiro uso para não baixar de novo os mesmos poucos megabytes a cada vez.
- A senha de Proteger e Desbloquear existe só em memória durante a operação.

---

## Adicionando uma ferramenta

Uma entrada em [`lib/tools.ts`](lib/tools.ts) gera o card, a rota, os metadados de SEO e o
formulário. A lógica vai em [`lib/pdf/engine.ts`](lib/pdf/engine.ts) e entra no mapa `OPERATIONS`.

As quatro ferramentas de grade compartilham [`components/PageBoard.tsx`](components/PageBoard.tsx) e
uma operação só no motor: a grade publica um plano com as páginas que ficam, em que ordem e com qual
rotação, e o motor apenas remonta o documento.

---

## OCR: PDF pesquisável

Digitalizado não tem texto embutido — só a imagem da página. A ferramenta **OCR: PDF pesquisável**
roda um motor de reconhecimento inteiro dentro do navegador ([tesseract.js](https://github.com/naptha/tesseract.js),
compilado para WebAssembly) e desenha o texto reconhecido, invisível, na posição de cada palavra por
cima da imagem original. A página parece igual; o que muda é que agora dá para selecionar, copiar e
pesquisar.

Motor, worker e os pacotes de idioma (português e inglês) ficam em `public/tesseract/`, servidos pelo
próprio site — sem CDN, mesmo princípio das outras ferramentas. Só baixam na primeira vez que a
ferramenta roda; depois ficam em cache no IndexedDB.

## PDF para Word

Monta um `.docx` de verdade (é um zip de XML, sem biblioteca de terceiros para isso) a partir do
mesmo texto que `PDF para texto` extrai. Só o texto atravessa: layout, colunas, imagens e tabelas do
PDF original não são preservados. Para digitalizado, rode o OCR antes.

## O que ele não faz

- **Reconhecer texto com perfeição.** OCR erra, principalmente em digitalizações de baixa qualidade.
  A ferramenta mostra a confiança média do reconhecimento para você saber quando conferir.
- **Preservar layout na conversão para Word.** Sai só o texto corrido, sem colunas, tabelas nem
  imagens. Para manter a aparência exata, use `PDF para imagem`.
- **Quebrar senha.** `Desbloquear PDF` só funciona com a senha correta em mãos.
- **Arquivos gigantes em aparelhos fracos.** No navegador o limite é a RAM da aba. É o preço de não
  ter servidor — e é justamente onde o aplicativo de desktop se sai melhor.

---

## Stack

Next.js 16 (App Router, Turbopack, saída estática) · React 19 · TypeScript · Tailwind CSS 4 ·
[@cantoo/pdf-lib](https://www.npmjs.com/package/@cantoo/pdf-lib) · pdf.js · [tesseract.js](https://github.com/naptha/tesseract.js) ·
JSZip · Vitest · Electron 33.

No aplicativo, mais dois: **Python 3.12 embutido com [PyMuPDF](https://pymupdf.readthedocs.io/)**
(o motor de PDF) e **C# / .NET Framework** (a impressão). Nenhum dos dois precisa estar instalado
na máquina — o Python vai junto no instalador e o C# é compilado pelo `csc.exe` do próprio Windows.

## Deploy

```bash
npm run build
```

O conteúdo de `out/` são arquivos estáticos: sobe em Vercel, Netlify, Cloudflare Pages, GitHub
Pages, S3 ou qualquer servidor de arquivos. Não há variável de ambiente, banco nem storage para
configurar.
