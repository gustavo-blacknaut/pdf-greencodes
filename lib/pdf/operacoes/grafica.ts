'use client';

/**
 * O que a gráfica faz depois que a arte fica pronta.
 *
 * Nada aqui mexe no desenho: é montagem de folha, marca de corte e numeração
 * — o serviço entre aprovar a arte e mandar para a máquina. Tudo em pdf-lib,
 * sem rasterizar, porque isto também roda no site.
 *
 * Milímetro é a unidade de quem trabalha com papel. A conversão para ponto
 * (1/72 de polegada) acontece só na hora de desenhar.
 */

import { FORMATOS_MM, mmParaPt, openWithPdfLib, salvarPdf, sanitizeText } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { suffixName, yieldToBrowser } from '../../utils';
import { hexParaRgb } from '../layout';
import { loadPdfLib } from '../lazy';

/** Teto de páginas na saída. Numerar é multiplicar, e engano é fácil. */
const MAX_PAGINAS_GERADAS = 5000;

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

function limitar(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

function ligado(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === true || valor === 'true';
}

/** O papel escolhido, em pontos, já deitado se for o caso. */
function folhaEmPontos(opcoes: Record<string, string | number | boolean>): { largura: number; altura: number } {
  const nome = String(opcoes.papel ?? 'a4');
  const medida = FORMATOS_MM[nome as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4;
  const largura = mmParaPt(medida.largura);
  const altura = mmParaPt(medida.altura);
  return ligado(opcoes.deitado, false) ? { largura: altura, altura: largura } : { largura, altura };
}

// ------------------------------------------------------------ rotação ---

type PdfDoc = Awaited<ReturnType<typeof openWithPdfLib>>;

/**
 * Devolve o documento sem `/Rotate`, com o giro já aplicado no desenho.
 *
 * O `/Rotate` não muda o desenho: é um recado para o leitor girar na hora de
 * mostrar. O `embedPages` do pdf-lib ignora esse recado, então uma página de
 * 300x400 que o leitor mostra deitada, como 400x300, voltava em pé — e numa
 * gráfica isso põe a linha de corte no lado errado do papel.
 *
 * Resolver aqui, uma vez, em vez de em cada ferramenta: combinar giro com
 * espelho e com escala na mesma chamada de `drawPage` exige acertar caso a
 * caso, e caso esquecido ali não quebra nada — entrega um PDF bonito com a
 * medida trocada, que só aparece depois de cortado.
 *
 * Documento que já está reto volta como veio, sem custo nenhum.
 */
async function semGiro(doc: PdfDoc): Promise<PdfDoc> {
  const paginas = doc.getPages();
  const giroDe = (i: number) => ((((paginas[i].getRotation().angle % 360) + 360) % 360));
  if (paginas.every((_, i) => giroDe(i) === 0)) return doc;

  const { PDFDocument, degrees } = await loadPdfLib();
  const reto = await PDFDocument.create();
  const embutidas = await reto.embedPages(paginas);

  embutidas.forEach((item, i) => {
    const giro = giroDe(i);
    const trocaEixos = giro === 90 || giro === 270;
    const pagina = reto.addPage([
      trocaEixos ? item.height : item.width,
      trocaEixos ? item.width : item.height,
    ]);

    // Girar no sentido do relogio leva o desenho para fora do primeiro
    // quadrante; o deslocamento devolve ele para dentro da folha.
    const desloca =
      giro === 90
        ? { x: 0, y: item.width }
        : giro === 180
          ? { x: item.width, y: item.height }
          : giro === 270
            ? { x: item.height, y: 0 }
            : { x: 0, y: 0 };

    pagina.drawPage(item, { ...desloca, rotate: degrees(-giro) });
  });

  // Gravar e reabrir não é desperdício: é o que torna o documento real.
  // As páginas embutidas do pdf-lib só viram XObject de verdade quando o
  // documento é serializado. Devolver o `reto` direto entregava um arquivo
  // que o leitor abre com "cannot find object in xref" e mostra em branco —
  // e branco, numa gráfica, é a tiragem inteira perdida.
  return PDFDocument.load(await reto.save());
}

// ------------------------------------------------------- marcas de corte ---

/**
 * Marcas de corte e sangria.
 *
 * A folha de saída é maior que a arte: sobra a sangria e, fora dela, as
 * marcas. O corte acontece na linha da arte; a sangria é o que a guilhotina
 * come quando erra um fio de milímetro — e é por isso que ela precisa ter
 * desenho dentro, não branco.
 */
export async function cropMarks(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const sangria = mmParaPt(limitar(ctx.options.sangriaMm, 0, 20, 3));
  const comprimento = mmParaPt(limitar(ctx.options.marcasMm, 1, 15, 4));
  const espessura = limitar(ctx.options.espessura, 0.1, 2, 0.25);
  // Um respiro entre a ponta da marca e a borda do papel: encostada no limite
  // de impressão, a marca simplesmente não sai.
  const respiro = mmParaPt(2);
  const borda = sangria + comprimento + respiro;

  const ampliar = String(ctx.options.origem ?? 'ja-tem') === 'ampliar';
  const registro = ligado(ctx.options.registro, false);

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());
  if (embutidas.length === 0) throw new Error('O documento não tem páginas.');
  const preto = rgb(0, 0, 0);

  for (let i = 0; i < embutidas.length; i += 1) {
    ctx.onProgress(i / embutidas.length, `Página ${i + 1}/${embutidas.length}`);
    const item = embutidas[i];
    const folha = out.addPage([item.width + borda * 2, item.height + borda * 2]);

    if (ampliar && sangria > 0) {
      // Ampliar empurra o desenho para dentro da sangria. É remendo, e a nota
      // do fim diz isso: sangria de verdade vem feita do arquivo original.
      const escala = Math.max((item.width + sangria * 2) / item.width, (item.height + sangria * 2) / item.height);
      folha.drawPage(item, {
        x: borda - (item.width * escala - item.width) / 2,
        y: borda - (item.height * escala - item.height) / 2,
        xScale: escala,
        yScale: escala,
      });
    } else {
      folha.drawPage(item, { x: borda, y: borda });
    }

    const risco = (x1: number, y1: number, x2: number, y2: number) =>
      folha.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: espessura, color: preto });

    // Oito marcas: duas por canto, na linha do corte, começando depois da
    // sangria para não riscar a arte.
    for (const [x, sentidoX] of [
      [borda, -1],
      [borda + item.width, 1],
    ] as const) {
      for (const [y, sentidoY] of [
        [borda, -1],
        [borda + item.height, 1],
      ] as const) {
        const deX = x + sentidoX * sangria;
        const deY = y + sentidoY * sangria;
        risco(deX, y, deX + sentidoX * comprimento, y);
        risco(x, deY, x, deY + sentidoY * comprimento);
      }
    }

    if (registro) {
      const raio = mmParaPt(2);
      for (const centro of [
        { x: borda + item.width / 2, y: borda / 2 },
        { x: borda + item.width / 2, y: folha.getHeight() - borda / 2 },
        { x: borda / 2, y: borda + item.height / 2 },
        { x: folha.getWidth() - borda / 2, y: borda + item.height / 2 },
      ]) {
        folha.drawCircle({ x: centro.x, y: centro.y, size: raio, borderColor: preto, borderWidth: espessura });
        risco(centro.x - raio * 1.4, centro.y, centro.x + raio * 1.4, centro.y);
        risco(centro.x, centro.y - raio * 1.4, centro.x, centro.y + raio * 1.4);
      }
    }

    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  const primeira = out.getPage(0);
  const notas = [
    `Folha de ${emMm(primeira.getWidth())}x${emMm(primeira.getHeight())} mm para uma arte de ` +
      `${emMm(embutidas[0].width)}x${emMm(embutidas[0].height)} mm. O corte é na linha das marcas.`,
    'Imprima em tamanho real. "Ajustar à página" encolhe tudo e as marcas deixam de valer.',
  ];
  if (ampliar && sangria > 0) {
    notas.push(
      'A arte foi ampliada para preencher a sangria. É um remendo: o desenho cresceu um pouco e a beirada saiu do quadro.',
    );
  } else if (sangria > 0) {
    notas.push(
      `Contamos que a arte já tenha ${emMm(sangria)} mm de sangria. Se não tiver, a beirada pode sair branca no corte.`,
    );
  }

  return {
    files: [{ name: suffixName(source.name, 'marcas-de-corte'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

// ------------------------------------------------------------ imposição ---

type Grade = { colunas: number; linhas: number; margemX: number; margemY: number };

/**
 * Quantos itens cabem, e sobrando quanto.
 *
 * A margem informada é o mínimo; o que sobra é dividido igualmente dos dois
 * lados, para a grade sair centrada. Folha com tudo empurrado para um canto é
 * o erro clássico da montagem feita na mão.
 */
export function calcularGrade(
  folhaL: number,
  folhaA: number,
  itemL: number,
  itemA: number,
  margem: number,
  espaco: number,
): Grade | null {
  const uteisL = folhaL - margem * 2;
  const uteisA = folhaA - margem * 2;
  if (itemL <= 0 || itemA <= 0 || uteisL < itemL || uteisA < itemA) return null;

  const colunas = Math.floor((uteisL + espaco) / (itemL + espaco));
  const linhas = Math.floor((uteisA + espaco) / (itemA + espaco));
  const usadoL = colunas * itemL + (colunas - 1) * espaco;
  const usadoA = linhas * itemA + (linhas - 1) * espaco;

  return { colunas, linhas, margemX: (folhaL - usadoL) / 2, margemY: (folhaA - usadoA) / 2 };
}

/**
 * Repete a arte numa grade, com as marcas de corte nas bordas da folha.
 *
 * Serve cartão de visita, etiqueta e adesivo: muda o tamanho do item e o
 * nome, o serviço é o mesmo. As marcas ficam nas margens, alinhadas com as
 * ruas entre os itens — é assim que se corta na guilhotina, a pilha inteira
 * de uma vez, e não item por item.
 */
async function imporGrade(
  ctx: RunContext,
  config: { itemL: number; itemA: number; sufixo: string; oQueE: string },
): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const folha = folhaEmPontos(ctx.options);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 0, 50, 5));
  const espaco = mmParaPt(limitar(ctx.options.espacoMm, 0, 30, 0));
  const marcas = ligado(ctx.options.marcas, true);
  const sequencia = String(ctx.options.modo ?? 'repetir') === 'sequencia';

  const grade = calcularGrade(folha.largura, folha.altura, config.itemL, config.itemA, margem, espaco);
  if (!grade) {
    throw new Error(
      `Um item de ${emMm(config.itemL)}x${emMm(config.itemA)} mm não cabe em ${emMm(folha.largura)}x` +
        `${emMm(folha.altura)} mm com ${emMm(margem)} mm de margem. Escolha um papel maior, deite a folha, ` +
        'ou diminua a margem.',
    );
  }

  const porFolha = grade.colunas * grade.linhas;
  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());
  if (embutidas.length === 0) throw new Error('O documento não tem páginas.');

  const preto = rgb(0, 0, 0);
  const comprimento = mmParaPt(3);
  const respiro = mmParaPt(1.5);
  // Marca precisa de margem onde caber. Sem espaço, ela sairia fora do papel
  // e sumiria sem avisar — pior que não ter marca, porque a folha parece
  // pronta para cortar.
  const cabemMarcas =
    grade.margemX >= respiro + comprimento && grade.margemY >= respiro + comprimento;
  const desenharMarcas = marcas && cabemMarcas;

  /** Onde fica a vaga, contando de cima para baixo como se lê. */
  const vaga = (indice: number) => {
    const coluna = indice % grade.colunas;
    const linha = Math.floor(indice / grade.colunas);
    return {
      x: grade.margemX + coluna * (config.itemL + espaco),
      y: folha.altura - grade.margemY - (linha + 1) * config.itemA - linha * espaco,
    };
  };

  const totalFolhas = sequencia ? Math.ceil(embutidas.length / porFolha) : embutidas.length;

  for (let f = 0; f < totalFolhas; f += 1) {
    ctx.onProgress(f / totalFolhas, `Folha ${f + 1}/${totalFolhas}`);
    const pagina = out.addPage([folha.largura, folha.altura]);

    for (let i = 0; i < porFolha; i += 1) {
      const item = sequencia ? embutidas[f * porFolha + i] : embutidas[f];
      if (!item) break;
      const onde = vaga(i);
      // A arte é encaixada no quadro sem deformar; o que sobra vira borda.
      const escala = Math.min(config.itemL / item.width, config.itemA / item.height);
      pagina.drawPage(item, {
        x: onde.x + (config.itemL - item.width * escala) / 2,
        y: onde.y + (config.itemA - item.height * escala) / 2,
        xScale: escala,
        yScale: escala,
      });
    }

    if (desenharMarcas) {
      const risco = (x1: number, y1: number, x2: number, y2: number) =>
        pagina.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: preto });

      // Uma marca por rua. Com espaço zero as colunas encostam, e a borda
      // direita de uma é a esquerda da seguinte: o Set tira a repetida.
      const xs = new Set<number>();
      const ys = new Set<number>();
      for (let c = 0; c < grade.colunas; c += 1) {
        const x = grade.margemX + c * (config.itemL + espaco);
        xs.add(Math.round(x * 100) / 100);
        xs.add(Math.round((x + config.itemL) * 100) / 100);
      }
      for (let l = 0; l < grade.linhas; l += 1) {
        const y = folha.altura - grade.margemY - (l + 1) * config.itemA - l * espaco;
        ys.add(Math.round(y * 100) / 100);
        ys.add(Math.round((y + config.itemA) * 100) / 100);
      }

      const baixo = folha.altura - grade.margemY - grade.linhas * config.itemA - (grade.linhas - 1) * espaco;
      const cima = folha.altura - grade.margemY;
      for (const x of xs) {
        risco(x, baixo - respiro, x, Math.max(0, baixo - respiro - comprimento));
        risco(x, cima + respiro, x, Math.min(folha.altura, cima + respiro + comprimento));
      }
      const esquerda = grade.margemX;
      const direita = grade.margemX + grade.colunas * config.itemL + (grade.colunas - 1) * espaco;
      for (const y of ys) {
        risco(esquerda - respiro, y, Math.max(0, esquerda - respiro - comprimento), y);
        risco(direita + respiro, y, Math.min(folha.largura, direita + respiro + comprimento), y);
      }
    }

    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  const cabem = `${grade.colunas} x ${grade.linhas} = ${porFolha} por folha`;
  const notas = [
    `${config.oQueE} de ${emMm(config.itemL)}x${emMm(config.itemA)} mm: ${cabem}, em ${out.getPageCount()} folha` +
      `${out.getPageCount() > 1 ? 's' : ''} de ${emMm(folha.largura)}x${emMm(folha.altura)} mm.`,
    'Imprima em tamanho real, sem ajustar à página — senão o corte sai fora de medida.',
  ];
  if (marcas && !cabemMarcas) {
    notas.push(
      `Sem marcas de corte: a grade ocupa o papel inteiro e não sobra margem para elas. ` +
        `Aumente a margem para ${emMm(respiro + comprimento)} mm ou mais, ou use um papel maior.`,
    );
  }
  if (!sequencia && embutidas.length > 1) {
    notas.push(`O arquivo tem ${embutidas.length} páginas, e saiu uma folha para cada uma.`);
  }

  return {
    files: [{ name: suffixName(source.name, config.sufixo), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

/** Cartão de visita. 90x50 mm é a medida usada no Brasil. */
export async function businessCards(ctx: RunContext): Promise<RunResult> {
  const medida = String(ctx.options.medida ?? '90x50');
  const conhecidas: Record<string, [number, number]> = {
    '90x50': [90, 50],
    '88x48': [88, 48],
    '85x55': [85, 55],
    '89x51': [88.9, 50.8],
  };
  const [largura, altura] =
    medida === 'personalizado'
      ? [limitar(ctx.options.larguraMm, 10, 300, 90), limitar(ctx.options.alturaMm, 10, 300, 50)]
      : (conhecidas[medida] ?? conhecidas['90x50']);

  const deitado = ligado(ctx.options.cartaoDeitado, true);
  return imporGrade(ctx, {
    itemL: mmParaPt(deitado ? largura : altura),
    itemA: mmParaPt(deitado ? altura : largura),
    sufixo: 'cartoes',
    oQueE: 'Cartão',
  });
}

/** Etiqueta e adesivo: mesma montagem, medida livre. */
export async function labels(ctx: RunContext): Promise<RunResult> {
  return imporGrade(ctx, {
    itemL: mmParaPt(limitar(ctx.options.larguraMm, 5, 400, 50)),
    itemA: mmParaPt(limitar(ctx.options.alturaMm, 5, 400, 30)),
    sufixo: 'etiquetas',
    oQueE: 'Etiqueta',
  });
}

// ------------------------------------------------------------ numeração ---

/**
 * Onde assentar o número, já na linha de base.
 *
 * A conta do rodapé não é a mesma do topo: no topo desconta-se a altura da
 * letra da margem de cima, no rodapé a margem já É a linha de base. Somar o
 * tamanho dos dois lados jogava o número para fora da folha com letra grande
 * e margem pequena.
 */
export const CANTOS = {
  'topo-direita': (l: number, a: number, m: number, t: number) => ({ x: l - m, y: a - m - t, direita: true }),
  'topo-esquerda': (_l: number, a: number, m: number, t: number) => ({ x: m, y: a - m - t, direita: false }),
  'rodape-direita': (l: number, _a: number, m: number, _t: number) => ({ x: l - m, y: m, direita: true }),
  'rodape-esquerda': (_l: number, _a: number, m: number, _t: number) => ({ x: m, y: m, direita: false }),
};

/**
 * Numeração sequencial, para talão e ingresso.
 *
 * Cada número gera um jogo completo do documento — as duas vias de um recibo
 * levam o mesmo número, que é o que faz o canhoto bater com a via. Quem quer
 * uma via só manda um PDF de uma página.
 */
export async function sequentialNumbering(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const quantidade = Math.round(limitar(ctx.options.quantidade, 1, MAX_PAGINAS_GERADAS, 100));
  const inicio = Math.round(limitar(ctx.options.inicio, 0, 9_999_999, 1));
  const digitos = Math.round(limitar(ctx.options.digitos, 1, 10, 4));
  const tamanho = limitar(ctx.options.tamanho, 5, 72, 12);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 2, 60, 10));
  const prefixo = sanitizeText(String(ctx.options.prefixo ?? '').trim());
  const canto = CANTOS[String(ctx.options.posicao ?? 'topo-direita') as keyof typeof CANTOS] ?? CANTOS['topo-direita'];
  const { r, g, b } = hexParaRgb(String(ctx.options.cor ?? '#d92d20'));

  const doJogo = doc.getPageCount();
  if (doJogo === 0) throw new Error('O documento não tem páginas.');
  const total = quantidade * doJogo;
  if (total > MAX_PAGINAS_GERADAS) {
    throw new Error(
      `Isso daria ${total} páginas (${quantidade} números x ${doJogo} do jogo), acima do limite de ` +
        `${MAX_PAGINAS_GERADAS}. Reduza a quantidade, ou divida o trabalho em partes.`,
    );
  }

  const out = await PDFDocument.create();
  const fonte = await out.embedFont(StandardFonts.HelveticaBold);
  const cor = rgb(r, g, b);
  const indices = doc.getPageIndices();

  for (let n = 0; n < quantidade; n += 1) {
    if (n % 20 === 0) {
      ctx.onProgress(n / quantidade, `Número ${inicio + n}`);
      await yieldToBrowser();
    }
    const texto = prefixo + String(inicio + n).padStart(digitos, '0');
    const largura = fonte.widthOfTextAtSize(texto, tamanho);

    const copiadas = await out.copyPages(doc, indices);
    for (const pagina of copiadas) {
      out.addPage(pagina);
      const onde = canto(pagina.getWidth(), pagina.getHeight(), margem, tamanho);
      pagina.drawText(texto, {
        x: onde.direita ? onde.x - largura : onde.x,
        y: onde.y,
        size: tamanho,
        font: fonte,
        color: cor,
      });
    }
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const ultimo = prefixo + String(inicio + quantidade - 1).padStart(digitos, '0');

  return {
    files: [{ name: suffixName(source.name, 'numerado'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `${quantidade} números, de ${prefixo}${String(inicio).padStart(digitos, '0')} a ${ultimo}.`,
      doJogo > 1
        ? `Cada número saiu nas ${doJogo} páginas do jogo, com o mesmo valor — é o que faz o canhoto bater com a via.`
        : 'Uma página por número.',
    ],
  };
}

// --------------------------------------------------- espelhar e repetir ---

/**
 * Espelha a página.
 *
 * Serve para sublimação, transfer e serigrafia, onde o desenho é aplicado de
 * cara para baixo e sai invertido se for impresso normal. É transformação de
 * coordenada, não rasterização: o texto continua texto (invertido, que é o
 * que se pediu).
 */
export async function mirror(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));
  const eixo = String(ctx.options.eixo ?? 'horizontal');
  const viraX = eixo === 'horizontal' || eixo === 'ambos';
  const viraY = eixo === 'vertical' || eixo === 'ambos';

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());

  for (let i = 0; i < embutidas.length; i += 1) {
    if (i % 20 === 0) {
      ctx.onProgress(i / embutidas.length, `Página ${i + 1}/${embutidas.length}`);
      await yieldToBrowser();
    }
    const item = embutidas[i];
    const pagina = out.addPage([item.width, item.height]);
    // Escala negativa é o `cm` do PDF com valor negativo: a origem vai para o
    // lado oposto e o desenho volta espelhado.
    pagina.drawPage(item, {
      x: viraX ? item.width : 0,
      y: viraY ? item.height : 0,
      xScale: viraX ? -1 : 1,
      yScale: viraY ? -1 : 1,
    });
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const comoSaiu = { horizontal: 'da esquerda para a direita', vertical: 'de cima para baixo', ambos: 'nos dois eixos' };

  return {
    files: [{ name: suffixName(source.name, 'espelhado'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `Espelhado ${comoSaiu[eixo as keyof typeof comoSaiu] ?? comoSaiu.horizontal}.`,
      'Confira numa impressão de teste antes da tiragem: o lado certo depende de como o papel entra na máquina.',
    ],
  };
}

/**
 * Repete as páginas.
 *
 * "Cada página" serve para tirar N cópias de cada folha numa impressão só;
 * "documento inteiro" monta a tiragem já intercalada, que sai da máquina
 * pronta para grampear.
 */
export async function repeatPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const vezes = Math.round(limitar(ctx.options.vezes, 2, 500, 2));
  const porPagina = String(ctx.options.modo ?? 'cada-pagina') === 'cada-pagina';
  const original = doc.getPageCount();
  if (original === 0) throw new Error('O documento não tem páginas.');

  const total = original * vezes;
  if (total > MAX_PAGINAS_GERADAS) {
    throw new Error(`Isso daria ${total} páginas, acima do limite de ${MAX_PAGINAS_GERADAS}. Reduza as repetições.`);
  }

  const out = await PDFDocument.create();
  const indices = doc.getPageIndices();

  if (porPagina) {
    for (const indice of indices) {
      ctx.onProgress(indice / original, `Página ${indice + 1}/${original}`);
      for (let v = 0; v < vezes; v += 1) {
        const [copia] = await out.copyPages(doc, [indice]);
        out.addPage(copia);
      }
      await yieldToBrowser();
    }
  } else {
    for (let v = 0; v < vezes; v += 1) {
      ctx.onProgress(v / vezes, `Cópia ${v + 1}/${vezes}`);
      const copiadas = await out.copyPages(doc, indices);
      for (const pagina of copiadas) out.addPage(pagina);
      await yieldToBrowser();
    }
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  return {
    files: [{ name: suffixName(source.name, `x${vezes}`), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      porPagina
        ? `Cada página saiu ${vezes} vezes seguidas: ${original} viraram ${total}.`
        : `O documento saiu ${vezes} vezes, um atrás do outro: ${original} páginas viraram ${total}.`,
    ],
  };
}
