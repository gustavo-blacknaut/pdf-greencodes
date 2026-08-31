# PDF.GreenCodes

Ferramentas de PDF que rodam inteiras no seu navegador. Sem upload, sem servidor, sem conta.
Roda como site em [pdf.greencodes.com.br](https://pdf.greencodes.com.br) e como aplicativo de
desktop no Windows.

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

---

## As 20 ferramentas

| Organizar | Editar | Converter | Otimizar e privacidade |
|---|---|---|---|
| **Juntar PDF** | Assinar PDF | PDF para imagem | Comprimir PDF |
| Organizar páginas | Editar PDF | Imagem para PDF | Proteger PDF |
| Remover páginas | Girar PDF | PDF para texto | Desbloquear PDF |
| Extrair páginas | Cortar PDF | Extrair imagens | Limpar metadados |
| Dividir PDF | Redimensionar PDF | | |
| Várias por folha | Marca d'água | | |

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
- **Diálogo nativo de salvar.** Você escolhe a pasta, o arquivo vai direto para o disco e aparece um
  atalho *Mostrar na pasta*. Nada de pasta de downloads.
- **Sem prazo de expiração.** O contador de 10 minutos some: o disco é seu.
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

---

## Rodando e testando

```bash
npm run dev          # desenvolvimento
npm run build        # gera out/
npm run preview      # serve out/ para conferir o build
npm test             # 75 testes
npm run typecheck
```

Os testes cobrem a lógica pura, que é onde erro passa despercebido: interpretador de intervalos de
página, barreiras de arquivo, geometria do editor e consistência do registro de ferramentas.

Alguns são de integração e valem por muitos: geram PDFs de verdade com o pdf-lib e leem o resultado
de volta com o pdf.js. É o que garante que a assinatura cai no lugar certo e que o merge não volta a
sair em branco.

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
- teto de 150 MB por arquivo, 300 MB por fila e 30 arquivos;
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
- No `localStorage` fica apenas a preferência de tema.
- A senha de Proteger e Desbloquear existe só em memória durante a operação.

---

## Adicionando uma ferramenta

Uma entrada em [`lib/tools.ts`](lib/tools.ts) gera o card, a rota, os metadados de SEO e o
formulário. A lógica vai em [`lib/pdf/engine.ts`](lib/pdf/engine.ts) e entra no mapa `OPERATIONS`.

As quatro ferramentas de grade compartilham [`components/PageBoard.tsx`](components/PageBoard.tsx) e
uma operação só no motor: a grade publica um plano com as páginas que ficam, em que ordem e com qual
rotação, e o motor apenas remonta o documento.

---

## O que ele não faz

- **OCR e PDF para Word.** Precisam de modelos pesados. `PDF para texto` avisa quando o documento é
  digitalizado e não tem texto a extrair.
- **Quebrar senha.** `Desbloquear PDF` só funciona com a senha correta em mãos.
- **Arquivos gigantes em aparelhos fracos.** No navegador o limite é a RAM da aba. É o preço de não
  ter servidor — e é justamente onde o aplicativo de desktop se sai melhor.

---

## Stack

Next.js 16 (App Router, Turbopack, saída estática) · React 19 · TypeScript · Tailwind CSS 4 ·
[@cantoo/pdf-lib](https://www.npmjs.com/package/@cantoo/pdf-lib) · pdf.js · JSZip · Vitest ·
Electron.

## Deploy

```bash
npm run build
```

O conteúdo de `out/` são arquivos estáticos: sobe em Vercel, Netlify, Cloudflare Pages, GitHub
Pages, S3 ou qualquer servidor de arquivos. Não há variável de ambiente, banco nem storage para
configurar.
