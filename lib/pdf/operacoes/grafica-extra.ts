'use client';

/**
 * Cartaz em partes, sangria, dobra, frente e verso, e carimbo de logo.
 *
 * São as cinco montagens que sobraram da vizinha `grafica.ts`, e que têm em
 * comum precisar de recorte de verdade — o `W n` do PostScript, que manda o
 * leitor desenhar só dentro de um retângulo. Sem isso, a folha de um cartaz
 * mostraria o cartaz inteiro em cada pedaço, e a sangria espelhada cobriria
 * a arte com a própria imagem invertida.
 *
 * O pdf-lib não tem função de recorte, mas expõe os operadores crus. É o que
 * este arquivo usa, e o motivo de ele existir separado.
 */

import { FORMATOS_MM, mmParaPt, openWithPdfLib, salvarPdf } from '../nucleo';
import { semGiro, type PdfDoc } from './grafica';
import { loadPdfLib } from '../lazy';
import { pareceSerImagem } from '../guards';
import type { LoadedFile, RunContext, RunResult } from '../tipos';
import { suffixName, yieldToBrowser } from '../../utils';

type Pagina = import('@cantoo/pdf-lib').PDFPage;

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

/** Teto de folhas geradas. Um cartaz mal configurado vira mil páginas. */
const MAX_FOLHAS = 400;

function limitar(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

function ligado(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === true || valor === 'true';
}

function folhaEmPontos(opcoes: Record<string, string | number | boolean>) {
  const nome = String(opcoes.papel ?? 'a4');
  const medida = FORMATOS_MM[nome as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4;
  const largura = mmParaPt(medida.largura);
  const altura = mmParaPt(medida.altura);
  return ligado(opcoes.deitado, false) ? { largura: altura, altura: largura } : { largura, altura };
}

/**
 * Desenha só dentro do retângulo, e nada fora dele.
 *
 * É o `W n` do PostScript: o retângulo vira a janela, e o que estiver fora
 * simplesmente não é pintado. Tudo o que a função `dentro` desenhar fica
 * limitado a essa janela; o estado gráfico é empilhado antes e devolvido
 * depois, então o recorte não vaza para o resto da página.
 */
async function recortando(
  pagina: Pagina,
  janela: { x: number; y: number; largura: number; altura: number },
  dentro: () => void,
): Promise<void> {
  const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await loadPdfLib();
  pagina.pushOperators(
    pushGraphicsState(),
    rectangle(janela.x, janela.y, janela.largura, janela.altura),
    clip(),
    endPath(),
  );
  dentro();
  pagina.pushOperators(popGraphicsState());
}

/** O primeiro arquivo da fila, aberto e endireitado. */
async function abrirPrimeiro(ctx: RunContext): Promise<{ fonte: LoadedFile; doc: PdfDoc }> {
  const fonte = ctx.files[0];
  if (!fonte) throw new Error('Escolha um PDF.');
  return { fonte, doc: await semGiro(await openWithPdfLib(fonte.bytes, fonte.senha)) };
}

// ------------------------------------------------------ cartaz em partes ---

/**
 * Quantas folhas o cartaz precisa, na largura e na altura.
 *
 * A sobreposição é a aba de cola: cada folha repete uma faixa da vizinha, e
 * é ela que permite emendar sem que apareça uma linha branca. Por isso a
 * conta não é "área total dividida pela folha": cada folha depois da
 * primeira só acrescenta `útil menos sobreposição`.
 */
export function folhasDoCartaz(
  medidaDaArte: number,
  util: number,
  sobreposicao: number,
): number {
  const avanco = util - sobreposicao;
  if (avanco <= 0) return Number.POSITIVE_INFINITY;
  if (medidaDaArte <= util) return 1;
  return Math.ceil((medidaDaArte - sobreposicao) / avanco);
}

/**
 * Divide uma página grande em várias folhas, para colar depois.
 *
 * É o cartaz de A4 em A4 que a loja vende quando o cliente quer um banner e
 * não quer pagar plotter. A arte é ampliada até a largura pedida e depois
 * fatiada; cada folha leva a aba de cola e a marca de onde dobrar.
 */
export async function posterTiles(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const { fonte, doc } = await abrirPrimeiro(ctx);

  const folha = folhaEmPontos(ctx.options);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 0, 40, 10));
  const sobreposicao = mmParaPt(limitar(ctx.options.sobreposicaoMm, 0, 40, 10));
  const colunas = Math.round(limitar(ctx.options.colunas, 1, 12, 2));
  const marcas = ligado(ctx.options.marcas, true);

  const utilL = folha.largura - margem * 2;
  const utilA = folha.altura - margem * 2;
  if (utilL <= sobreposicao || utilA <= sobreposicao) {
    throw new Error('A sobreposição ficou maior que a área útil da folha. Diminua a sobreposição ou a margem.');
  }

  const original = doc.getPages()[0];
  if (!original) throw new Error('O documento não tem páginas.');
  const { width: arteL, height: arteA } = original.getSize();

  // A escala sai da largura pedida em folhas: é assim que a pessoa pensa —
  // "quero um cartaz de duas folhas de largura".
  const larguraTotal = colunas * utilL - (colunas - 1) * sobreposicao;
  const escala = larguraTotal / arteL;
  const alturaTotal = arteA * escala;
  const linhas = folhasDoCartaz(alturaTotal, utilA, sobreposicao);

  if (colunas * linhas > MAX_FOLHAS) {
    throw new Error(
      `Esse tamanho daria ${colunas * linhas} folhas. Reduza a largura em folhas, ou use um papel maior.`,
    );
  }

  const out = await PDFDocument.create();
  const [embutida] = await out.embedPages([original]);
  const cinza = rgb(0.6, 0.6, 0.6);

  for (let linha = 0; linha < linhas; linha += 1) {
    for (let coluna = 0; coluna < colunas; coluna += 1) {
      ctx.onProgress((linha * colunas + coluna) / (linhas * colunas), `Folha ${linha * colunas + coluna + 1}`);
      const pagina = out.addPage([folha.largura, folha.altura]);

      // Onde a arte inteira teria que ficar para que este pedaço dela caia
      // no canto de cima à esquerda da área útil.
      const x = margem - coluna * (utilL - sobreposicao);
      const y = folha.altura - margem - (alturaTotal - linha * (utilA - sobreposicao));

      await recortando(pagina, { x: margem, y: margem, largura: utilL, altura: utilA }, () => {
        pagina.drawPage(embutida, { x, y, xScale: escala, yScale: escala });
      });

      if (marcas) {
        // A faixa de sobreposição fica marcada: é onde passa a cola, e é o
        // pedaço que a folha vizinha repete. Sem a marca, quem monta não
        // sabe qual das duas cortar.
        const traco = { thickness: 0.4, color: cinza, dashArray: [3, 3] };
        if (coluna < colunas - 1) {
          pagina.drawLine({
            start: { x: margem + utilL - sobreposicao, y: margem },
            end: { x: margem + utilL - sobreposicao, y: margem + utilA },
            ...traco,
          });
        }
        if (linha < linhas - 1) {
          pagina.drawLine({
            start: { x: margem, y: margem + sobreposicao },
            end: { x: margem + utilL, y: margem + sobreposicao },
            ...traco,
          });
        }
        // A moldura da área útil é a linha de corte da margem branca.
        pagina.drawRectangle({
          x: margem,
          y: margem,
          width: utilL,
          height: utilA,
          borderWidth: 0.3,
          borderColor: cinza,
        });
      }

      await yieldToBrowser();
    }
  }

  const blob = await salvarPdf(out, fonte.senha);
  ctx.onProgress(1);

  return {
    files: [{ name: suffixName(fonte.name, 'cartaz'), blob, pages: out.getPageCount() }],
    inputBytes: fonte.size,
    outputBytes: blob.size,
    notes: [
      `${colunas} x ${linhas} folhas, montando ${emMm(larguraTotal)} x ${emMm(alturaTotal)} mm ` +
        `(${(escala * 100).toFixed(0)}% do original).`,
      `Cada folha repete ${emMm(sobreposicao)} mm da vizinha: é a aba de cola, marcada com o tracejado.`,
      'Monte da esquerda para a direita e de cima para baixo, cortando a margem branca de dois lados de ' +
        'cada folha — a de cima e a da esquerda ficam por baixo.',
      'Ampliar não cria detalhe. Se a arte for foto, confira a resolução antes: no tamanho final ela ' +
        'precisa continuar tendo pelo menos 100 DPI para cartaz visto de longe.',
    ],
  };
}

// -------------------------------------------------------------- sangria ---

/**
 * Acrescenta sangria a uma arte que não tem.
 *
 * Sangria é o desenho que passa da linha de corte, para a guilhotina poder
 * errar um fio de milímetro sem deixar uma tira branca na beirada. Arte
 * fechada sem sangria é o motivo número um de trabalho recusado na gráfica.
 *
 * O espelho é o remendo que funciona: a faixa junto à borda é copiada
 * invertida para fora dela. Em fundo liso, em textura e em degradê ninguém
 * distingue. Em arte com desenho reconhecível encostando na borda — um rosto,
 * um texto — o espelho aparece, e aí o certo é reabrir o arquivo original.
 */
export async function addBleed(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const { fonte, doc } = await abrirPrimeiro(ctx);

  const sangria = mmParaPt(limitar(ctx.options.sangriaMm, 1, 20, 3));
  const modo = String(ctx.options.modo ?? 'espelho');
  const corDeFundo = String(ctx.options.cor ?? '#ffffff');

  const out = await PDFDocument.create();
  const paginas = doc.getPages();
  const embutidas = await out.embedPages(paginas);

  const canal = (inicio: number) => {
    const limpo = corDeFundo.replace('#', '');
    return /^[0-9a-f]{6}$/i.test(limpo) ? parseInt(limpo.slice(inicio, inicio + 2), 16) / 255 : 1;
  };
  const fundo = rgb(canal(0), canal(2), canal(4));

  for (let i = 0; i < embutidas.length; i += 1) {
    ctx.onProgress(i / embutidas.length, `Página ${i + 1}/${embutidas.length}`);
    const item = embutidas[i];
    const largura = item.width + sangria * 2;
    const altura = item.height + sangria * 2;
    const pagina = out.addPage([largura, altura]);

    if (modo === 'cor') {
      pagina.drawRectangle({ x: 0, y: 0, width: largura, height: altura, color: fundo });
    } else if (modo === 'esticar') {
      // A arte cresce até cobrir a sangria. É simples, mas o desenho inteiro
      // sai um pouco maior e a beirada é perdida dos quatro lados.
      const escala = Math.max(largura / item.width, altura / item.height);
      pagina.drawPage(item, {
        x: (largura - item.width * escala) / 2,
        y: (altura - item.height * escala) / 2,
        xScale: escala,
        yScale: escala,
      });
      continue;
    } else {
      /*
       * Espelho: oito cópias em volta, cada uma invertida no eixo que
       * atravessa a borda. Escala negativa espelha e, como o desenho vai
       * para o outro lado da origem, o deslocamento devolve ele ao lugar.
       *
       * Cada cópia é desenhada dentro do seu próprio recorte, senão a cópia
       * inteira cobriria a arte original.
       */
      for (const espelho of [
        { ex: 1, ey: -1, janela: { x: sangria, y: 0, largura: item.width, altura: sangria } },
        { ex: 1, ey: -1, janela: { x: sangria, y: altura - sangria, largura: item.width, altura: sangria } },
        { ex: -1, ey: 1, janela: { x: 0, y: sangria, largura: sangria, altura: item.height } },
        { ex: -1, ey: 1, janela: { x: largura - sangria, y: sangria, largura: sangria, altura: item.height } },
        { ex: -1, ey: -1, janela: { x: 0, y: 0, largura: sangria, altura: sangria } },
        { ex: -1, ey: -1, janela: { x: largura - sangria, y: 0, largura: sangria, altura: sangria } },
        { ex: -1, ey: -1, janela: { x: 0, y: altura - sangria, largura: sangria, altura: sangria } },
        {
          ex: -1,
          ey: -1,
          janela: { x: largura - sangria, y: altura - sangria, largura: sangria, altura: sangria },
        },
      ]) {
        const centroX = espelho.janela.x + espelho.janela.largura / 2;
        const centroY = espelho.janela.y + espelho.janela.altura / 2;
        // O espelho é em torno da borda da arte, que é a linha de corte.
        const eixoX = centroX < largura / 2 ? sangria : largura - sangria;
        const eixoY = centroY < altura / 2 ? sangria : altura - sangria;

        const x = espelho.ex === -1 ? 2 * eixoX - sangria : sangria;
        const y = espelho.ey === -1 ? 2 * eixoY - sangria : sangria;

        await recortando(pagina, espelho.janela, () => {
          pagina.drawPage(item, { x, y, xScale: espelho.ex, yScale: espelho.ey });
        });
      }
    }

    pagina.drawPage(item, { x: sangria, y: sangria });
    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, fonte.senha);
  ctx.onProgress(1);

  const comoFoi =
    modo === 'cor'
      ? `A sangria foi preenchida com a cor ${corDeFundo}.`
      : modo === 'esticar'
        ? 'A arte foi ampliada até cobrir a sangria. O desenho inteiro ficou um pouco maior.'
        : 'A faixa junto à borda foi copiada invertida para fora dela.';

  return {
    files: [{ name: suffixName(fonte.name, 'com-sangria'), blob, pages: out.getPageCount() }],
    inputBytes: fonte.size,
    outputBytes: blob.size,
    notes: [
      `${emMm(sangria)} mm de sangria em cada lado. A página cresceu ${emMm(sangria * 2)} mm em cada medida.`,
      comoFoi,
      'A linha de corte continua sendo a medida original. Para marcar onde ela está no papel, passe o ' +
        'resultado por "Marcas de corte" — informando que a sangria já existe.',
      modo === 'espelho'
        ? 'O espelho engana bem em fundo liso, textura e degradê. Se houver rosto ou texto encostando na ' +
          'borda, ele aparece: nesse caso o certo é reabrir o arquivo original e estender a arte de verdade.'
        : 'Sangria inventada é remendo. O ideal continua sendo fechar a arte já com ela.',
    ],
  };
}

// --------------------------------------------------------------- dobra ---

/** Onde ficam as dobras de cada tipo, em fração da medida. */
export const DOBRAS: Record<string, { nome: string; posicoes: number[]; sobre: string }> = {
  meio: { nome: 'Ao meio', posicoes: [1 / 2], sobre: 'Uma dobra no centro: o folheto de quatro páginas.' },
  triptico: {
    nome: 'Tríptico (carta)',
    posicoes: [1 / 3, 2 / 3],
    sobre: 'Duas dobras para dentro, uma aba por cima da outra. É a dobra de folheto de balcão.',
  },
  sanfona: {
    nome: 'Sanfona (zigue-zague)',
    posicoes: [1 / 3, 2 / 3],
    sobre: 'Duas dobras alternadas, que abre esticando. Mesmas posições do tríptico, sentido contrário.',
  },
  janela: {
    nome: 'Janela',
    posicoes: [1 / 4, 1 / 2, 3 / 4],
    sobre: 'As duas pontas dobram para o centro e depois o conjunto fecha ao meio.',
  },
  quatro: { nome: 'Em quatro', posicoes: [1 / 4, 1 / 2, 3 / 4], sobre: 'Três dobras iguais, como um mapa.' },
};

/**
 * Marca onde dobrar, na margem, sem sujar a arte.
 *
 * A marca de dobra é tracejada de propósito: é assim que a máquina de dobra e
 * o operador distinguem dela a marca de corte, que é linha cheia. Confundir
 * as duas custa a tiragem inteira.
 */
export async function foldMarks(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const { fonte, doc } = await abrirPrimeiro(ctx);

  const tipo = String(ctx.options.tipo ?? 'meio');
  const dobra = DOBRAS[tipo] ?? DOBRAS.meio;
  const naLargura = String(ctx.options.sentido ?? 'largura') === 'largura';
  const margem = mmParaPt(limitar(ctx.options.margemMm, 3, 30, 8));
  const comprimento = mmParaPt(limitar(ctx.options.marcaMm, 2, 15, 5));

  const out = await PDFDocument.create();
  const paginas = doc.getPages();
  const embutidas = await out.embedPages(paginas);
  const cinza = rgb(0.45, 0.45, 0.45);

  for (let i = 0; i < embutidas.length; i += 1) {
    const item = embutidas[i];
    const largura = item.width + margem * 2;
    const altura = item.height + margem * 2;
    const pagina = out.addPage([largura, altura]);
    pagina.drawPage(item, { x: margem, y: margem });

    for (const fracao of dobra.posicoes) {
      const traco = { thickness: 0.4, color: cinza, dashArray: [2, 2] };
      if (naLargura) {
        const x = margem + item.width * fracao;
        pagina.drawLine({ start: { x, y: margem - 1 }, end: { x, y: margem - comprimento }, ...traco });
        pagina.drawLine({
          start: { x, y: altura - margem + 1 },
          end: { x, y: altura - margem + comprimento },
          ...traco,
        });
      } else {
        const y = margem + item.height * fracao;
        pagina.drawLine({ start: { x: margem - 1, y }, end: { x: margem - comprimento, y }, ...traco });
        pagina.drawLine({
          start: { x: largura - margem + 1, y },
          end: { x: largura - margem + comprimento, y },
          ...traco,
        });
      }
    }
    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, fonte.senha);
  ctx.onProgress(1);

  return {
    files: [{ name: suffixName(fonte.name, 'marcas-de-dobra'), blob, pages: out.getPageCount() }],
    inputBytes: fonte.size,
    outputBytes: blob.size,
    notes: [
      `${dobra.nome}: ${dobra.sobre}`,
      `${dobra.posicoes.length} dobra(s) na ${naLargura ? 'largura' : 'altura'}, marcadas nas duas margens.`,
      'A marca é tracejada porque marca de dobra tracejada e marca de corte cheia é a convenção que o ' +
        'operador da dobradeira lê sem perguntar.',
      tipo === 'triptico'
        ? 'No tríptico a aba que entra por dentro precisa ser 2 a 3 mm mais estreita, senão ela amassa ao ' +
          'fechar. As marcas aqui saem em terços exatos: se a arte já previu a diferença, confira antes.'
        : 'A arte não foi tocada: as marcas ficam na margem que foi acrescentada em volta.',
    ],
  };
}

// ------------------------------------------------------- frente e verso ---

/**
 * Junta duas digitalizações — as frentes e os versos — num documento só.
 *
 * O caso é o do alimentador que só digitaliza um lado: passa-se a pilha, ela
 * sai com as frentes; vira-se a pilha inteira e passa de novo, e as costas
 * saem **de trás para frente**. É por isso que a opção de inverter existe, e
 * é por isso que ela vem ligada: é o que acontece na prática.
 */
export async function frenteEVerso(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  if (ctx.files.length !== 2) {
    throw new Error(
      'São dois arquivos: primeiro o das frentes, depois o dos versos. ' +
        `Vieram ${ctx.files.length}. Arraste os dois e confira a ordem na fila.`,
    );
  }

  const inverter = ligado(ctx.options.inverter, true);
  const [arquivoFrente, arquivoVerso] = ctx.files;

  const frentes = await openWithPdfLib(arquivoFrente.bytes, arquivoFrente.senha);
  const versos = await openWithPdfLib(arquivoVerso.bytes, arquivoVerso.senha);

  const out = await PDFDocument.create();
  const daFrente = await out.copyPages(frentes, frentes.getPageIndices());
  const ordemDoVerso = versos.getPageIndices();
  const doVerso = await out.copyPages(versos, inverter ? [...ordemDoVerso].reverse() : ordemDoVerso);

  const total = Math.max(daFrente.length, doVerso.length);
  for (let i = 0; i < total; i += 1) {
    if (daFrente[i]) out.addPage(daFrente[i]);
    if (doVerso[i]) out.addPage(doVerso[i]);
    ctx.onProgress(i / total);
  }

  const blob = await salvarPdf(out, arquivoFrente.senha);
  ctx.onProgress(1);

  const notas = [
    `${daFrente.length} frentes e ${doVerso.length} versos, intercalados em ${out.getPageCount()} páginas.`,
    inverter
      ? 'Os versos foram usados de trás para frente, que é a ordem em que saem quando a pilha inteira é virada.'
      : 'Os versos foram usados na mesma ordem das frentes — o caso de quem virou folha por folha.',
  ];
  if (daFrente.length !== doVerso.length) {
    notas.push(
      `Os dois arquivos têm quantidades diferentes (${daFrente.length} e ${doVerso.length}). ` +
        'As páginas que sobraram foram para o fim; confira se alguma folha não passou no alimentador.',
    );
  }
  if (doVerso.length && !inverter) {
    notas.push('Se o verso saiu trocado, rode de novo com "inverter a ordem dos versos" ligado.');
  }

  return {
    files: [{ name: suffixName(arquivoFrente.name, 'frente-e-verso'), blob, pages: out.getPageCount() }],
    inputBytes: arquivoFrente.size + arquivoVerso.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

// ------------------------------------------------------- carimbo de logo ---

/** Onde o carimbo encosta na página. */
const CANTOS_DO_CARIMBO: Record<string, { x: (l: number, c: number, m: number) => number; y: (a: number, c: number, m: number) => number }> = {
  'topo-esquerda': { x: (_l, _c, m) => m, y: (a, c, m) => a - c - m },
  'topo-direita': { x: (l, c, m) => l - c - m, y: (a, c, m) => a - c - m },
  'base-esquerda': { x: (_l, _c, m) => m, y: (_a, _c, m) => m },
  'base-direita': { x: (l, c, m) => l - c - m, y: (_a, _c, m) => m },
  centro: { x: (l, c) => (l - c) / 2, y: (a, c) => (a - c) / 2 },
};

/**
 * Carimba uma imagem — logo, assinatura, "PAGO" — nas páginas do PDF.
 *
 * A marca d'água de texto já existia; esta é a de imagem, que é o que a loja
 * usa para pôr o próprio logo no orçamento e o carimbo digitalizado no
 * comprovante. A fila leva o PDF e a imagem juntos, em qualquer ordem: quem
 * decide o papel de cada um é o tipo do arquivo, não a posição.
 */
export async function stampImage(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();

  const pdf = ctx.files.find((arquivo) => !pareceSerImagem(arquivo.name, arquivo.type));
  const imagem = ctx.files.find((arquivo) => pareceSerImagem(arquivo.name, arquivo.type));
  if (!pdf || !imagem) {
    throw new Error(
      'A fila precisa de dois arquivos: o PDF e a imagem do carimbo (PNG ou JPG). ' +
        'PNG com fundo transparente é o que fica bom por cima do texto.',
    );
  }

  const doc = await openWithPdfLib(pdf.bytes, pdf.senha);
  const ehPng = /\.png$/i.test(imagem.name) || imagem.type === 'image/png';
  const bytes = imagem.bytes.slice(0);
  const desenho = ehPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

  const larguraPorcento = limitar(ctx.options.tamanho, 2, 100, 25) / 100;
  const margem = mmParaPt(limitar(ctx.options.margemMm, 0, 60, 10));
  const opacidade = limitar(ctx.options.opacidade, 5, 100, 100) / 100;
  const canto = String(ctx.options.posicao ?? 'base-direita');
  const soPrimeira = ligado(ctx.options.soPrimeira, false);
  const lugar = CANTOS_DO_CARIMBO[canto] ?? CANTOS_DO_CARIMBO['base-direita'];

  const paginas = doc.getPages();
  const alvos = soPrimeira ? paginas.slice(0, 1) : paginas;

  for (let i = 0; i < alvos.length; i += 1) {
    ctx.onProgress(i / alvos.length, `Página ${i + 1}/${alvos.length}`);
    const pagina = alvos[i];
    const { width, height } = pagina.getSize();

    // A largura sai em porcentagem da página, e a altura acompanha a
    // proporção da imagem: carimbo esticado é o que denuncia montagem.
    const larguraFinal = width * larguraPorcento;
    const alturaFinal = (desenho.height / desenho.width) * larguraFinal;

    pagina.drawImage(desenho, {
      x: lugar.x(width, larguraFinal, margem),
      y: lugar.y(height, alturaFinal, margem),
      width: larguraFinal,
      height: alturaFinal,
      opacity: opacidade,
    });
    await yieldToBrowser();
  }

  const blob = await salvarPdf(doc, pdf.senha);
  ctx.onProgress(1);

  const notas = [
    `Carimbo em ${alvos.length} página(s), ocupando ${Math.round(larguraPorcento * 100)}% da largura.`,
    'A altura acompanhou a proporção da imagem, então o carimbo não saiu esticado.',
  ];
  if (!ehPng) {
    notas.push(
      'A imagem é JPG, que não tem transparência: o carimbo saiu com o retângulo de fundo por cima do ' +
        'texto. Para carimbo vazado, use PNG com fundo transparente — o "Remover fundo" faz esse arquivo.',
    );
  }

  return {
    files: [{ name: suffixName(pdf.name, 'carimbado'), blob, pages: doc.getPageCount() }],
    inputBytes: pdf.size + imagem.size,
    outputBytes: blob.size,
    notes: notas,
  };
}
