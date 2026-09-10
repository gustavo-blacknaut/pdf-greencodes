'use client';

/**
 * Gerar QR Code e código de barras.
 *
 * As duas ferramentas não recebem arquivo: a entrada é o que a pessoa
 * escreve. Uma linha por código, o que transforma a tela num gerador em lote
 * sem nenhum campo a mais — colar uma coluna do Excel ali dentro é o caso de
 * uso mais comum no balcão.
 *
 * A saída pode ser PNG ou PDF, e a diferença importa:
 *
 *  - **PNG** é para mandar por WhatsApp, pôr no site, colar num slide.
 *  - **PDF** desenha o código como retângulo vetorial. Numa impressora de
 *    1200 DPI cada barra sai exatamente na largura calculada, sem pixel pelo
 *    caminho — e é a largura da barra que decide se o leitor do caixa bipa.
 *
 * Esticar um PNG de 300 px para 5 cm de largura é o erro que faz um código
 * "que funcionava na tela" falhar impresso: a borda vira escadinha e o leitor
 * mede errado a barra mais fina.
 */

import { BORDA_EM_MODULOS, correcaoValida, matrizQr, type MatrizQr } from '../../codigos/qr';
import { montarConteudo, TIPOS, type TipoDeConteudo } from '../../codigos/conteudo';
import {
  barrasCompridas,
  faixasEscuras,
  gerarCodigo,
  simbologiaValida,
  SIMBOLOGIAS,
  type CodigoDeBarras,
} from '../../codigos/barras';
import { canvasToBlob, FORMATOS_MM, mmParaPt, salvarPdf, sanitizeText, zipFiles } from '../nucleo';
import { loadPdfLib } from '../lazy';
import type { OutputFile, RunContext, RunResult } from '../tipos';
import { yieldToBrowser } from '../../utils';

/** Teto de códigos por vez. Colar a planilha inteira por engano é fácil. */
const MAX_CODIGOS = 500;

function limitar(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

function ligado(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === true || valor === 'true';
}

/**
 * Uma linha, um código.
 *
 * Linha vazia é descartada em silêncio: colar de planilha traz linha em
 * branco no fim, e recusar por causa disso seria implicância.
 */
export function linhasDeConteudo(texto: unknown): string[] {
  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  if (!linhas.length) throw new Error('Escreva o que vai dentro do código. Uma linha para cada código.');
  if (linhas.length > MAX_CODIGOS) {
    throw new Error(`São ${linhas.length} códigos de uma vez, e o limite é ${MAX_CODIGOS}. Divida em partes.`);
  }
  return linhas;
}

/**
 * Nome de arquivo a partir do conteúdo, sem o que o sistema recusa.
 *
 * Só serve para o modo texto, onde o conteúdo é curto e reconhecível — é o
 * que faz uma pasta com trinta códigos gerados de uma planilha ser
 * navegável. Para os outros tipos o conteúdo é um formato interno: um PIX
 * viraria `00020126470014br.gov.bcb.pix0125contato@.png`, que não ajuda
 * ninguém a achar o arquivo depois.
 */
function nomeDoCodigo(conteudo: string, indice: number, extensao: string): string {
  const limpo = conteudo
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return `${limpo || `codigo-${indice + 1}`}.${extensao}`;
}

/** O nome que cada tipo merece: o conteúdo só quando ele diz alguma coisa. */
function nomeDoQr(tipo: TipoDeConteudo, conteudo: string, indice: number, extensao: string): string {
  if (tipo === 'texto') return nomeDoCodigo(conteudo, indice, extensao);
  return `qrcode-${tipo}.${extensao}`;
}

// ---------------------------------------------------------------- folha ---

/** O papel escolhido, em pontos. */
function folhaEmPontos(opcoes: Record<string, string | number | boolean>) {
  const nome = String(opcoes.papel ?? 'a4');
  const medida = FORMATOS_MM[nome as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4;
  const largura = mmParaPt(medida.largura);
  const altura = mmParaPt(medida.altura);
  return ligado(opcoes.deitado, false) ? { largura: altura, altura: largura } : { largura, altura };
}

type Quadro = { x: number; y: number; largura: number; altura: number };

/**
 * Onde cada etiqueta cai na folha, da esquerda para a direita e de cima para
 * baixo — a ordem em que se lê, que é a ordem em que se corta.
 */
export function vagasNaFolha(
  folha: { largura: number; altura: number },
  item: { largura: number; altura: number },
  margem: number,
  espaco: number,
): Quadro[] {
  const colunas = Math.floor((folha.largura - margem * 2 + espaco) / (item.largura + espaco));
  const linhas = Math.floor((folha.altura - margem * 2 + espaco) / (item.altura + espaco));
  if (colunas < 1 || linhas < 1) return [];

  const usadoL = colunas * item.largura + (colunas - 1) * espaco;
  const usadoA = linhas * item.altura + (linhas - 1) * espaco;
  const sobraX = (folha.largura - usadoL) / 2;
  const sobraY = (folha.altura - usadoA) / 2;

  const vagas: Quadro[] = [];
  for (let linha = 0; linha < linhas; linha += 1) {
    for (let coluna = 0; coluna < colunas; coluna += 1) {
      vagas.push({
        x: sobraX + coluna * (item.largura + espaco),
        y: folha.altura - sobraY - (linha + 1) * item.altura - linha * espaco,
        largura: item.largura,
        altura: item.altura,
      });
    }
  }
  return vagas;
}

// ------------------------------------------------------------------- qr ---

/**
 * Junta os módulos escuros de uma linha num retângulo só.
 *
 * Um QR de versão 10 tem 57x57 = 3249 módulos, e metade deles é escura. Um
 * retângulo por módulo dá mais de mil objetos por código; numa folha de trinta
 * etiquetas são dezenas de milhares, e o PDF que deveria ter 20 kB passa de um
 * megabyte. Emendar a sequência horizontal corta isso para um quinto, e o
 * desenho sai idêntico.
 */
export function emendarLinha(linha: boolean[]): { inicio: number; largura: number }[] {
  const faixas: { inicio: number; largura: number }[] = [];
  let coluna = 0;
  while (coluna < linha.length) {
    if (!linha[coluna]) {
      coluna += 1;
      continue;
    }
    const inicio = coluna;
    while (coluna < linha.length && linha[coluna]) coluna += 1;
    faixas.push({ inicio, largura: coluna - inicio });
  }
  return faixas;
}

type Pagina = import('@cantoo/pdf-lib').PDFPage;
type Documento = import('@cantoo/pdf-lib').PDFDocument;
type Cor = import('@cantoo/pdf-lib').RGB;
type Fonte = import('@cantoo/pdf-lib').PDFFont;

/** Desenha o QR dentro do quadro, já com a borda branca da norma. */
function desenharQr(pagina: Pagina, matriz: MatrizQr, quadro: Quadro, preto: Cor): void {
  const comBorda = matriz.tamanho + BORDA_EM_MODULOS * 2;
  const lado = Math.min(quadro.largura, quadro.altura);
  const modulo = lado / comBorda;
  const esquerda = quadro.x + (quadro.largura - lado) / 2 + BORDA_EM_MODULOS * modulo;
  const topo = quadro.y + (quadro.altura - lado) / 2 + lado - BORDA_EM_MODULOS * modulo;

  for (let linha = 0; linha < matriz.tamanho; linha += 1) {
    for (const faixa of emendarLinha(matriz.escuro[linha])) {
      pagina.drawRectangle({
        x: esquerda + faixa.inicio * modulo,
        y: topo - (linha + 1) * modulo,
        width: faixa.largura * modulo,
        height: modulo,
        color: preto,
      });
    }
  }
}

/** O mesmo QR num canvas, para sair em PNG. */
function qrEmCanvas(matriz: MatrizQr, ladoEmPixels: number): HTMLCanvasElement {
  const comBorda = matriz.tamanho + BORDA_EM_MODULOS * 2;
  // Módulo inteiro: meio pixel de módulo é o que faz um QR nítido virar um
  // QR com módulos de larguras diferentes, e o leitor perde a referência.
  const modulo = Math.max(1, Math.floor(ladoEmPixels / comBorda));
  const lado = modulo * comBorda;

  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar o código.');

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, lado, lado);
  pincel.fillStyle = '#000000';

  const borda = BORDA_EM_MODULOS * modulo;
  for (let linha = 0; linha < matriz.tamanho; linha += 1) {
    for (const faixa of emendarLinha(matriz.escuro[linha])) {
      pincel.fillRect(borda + faixa.inicio * modulo, borda + linha * modulo, faixa.largura * modulo, modulo);
    }
  }

  return canvas;
}

// --------------------------------------------------------------- barras ---

const ALTURA_DA_LEGENDA = 3.2; // mm

/**
 * Desenha o código de barras dentro do quadro.
 *
 * A zona de silêncio entra na conta da largura: ela é parte do código, não
 * margem de enfeite. Descontá-la depois — desenhar as barras ocupando o
 * quadro inteiro e torcer para haver branco em volta — é o que produz a
 * etiqueta que só lê quando está isolada na folha.
 */
function desenharBarras(
  pagina: Pagina,
  codigo: CodigoDeBarras,
  quadro: Quadro,
  legenda: boolean,
  fonte: Fonte,
  preto: Cor,
): void {
  const total = codigo.modulos.length + codigo.silencio * 2;
  const modulo = quadro.largura / total;
  const alturaDaLegenda = legenda ? mmParaPt(ALTURA_DA_LEGENDA) : 0;
  const alturaDasBarras = Math.max(mmParaPt(4), quadro.altura - alturaDaLegenda);
  const esquerda = quadro.x + codigo.silencio * modulo;
  const base = quadro.y + alturaDaLegenda;

  // Nas guardas do EAN a barra desce por baixo da legenda, que é o que dá ao
  // leitor a referência de onde os grupos de dígitos começam.
  const comprida = barrasCompridas(codigo.simbologia, codigo.modulos.length);
  const desce = legenda ? alturaDaLegenda * 0.7 : 0;

  for (const faixa of faixasEscuras(codigo.modulos)) {
    const estende = comprida(faixa.inicio) ? desce : 0;
    pagina.drawRectangle({
      x: esquerda + faixa.inicio * modulo,
      y: base - estende,
      width: faixa.largura * modulo,
      height: alturaDasBarras + estende,
      color: preto,
    });
  }

  if (!legenda) return;

  const texto = sanitizeText(codigo.legenda);
  const tamanho = Math.min(mmParaPt(ALTURA_DA_LEGENDA) * 0.85, quadro.largura / Math.max(6, texto.length * 0.62));
  const largura = fonte.widthOfTextAtSize(texto, tamanho);
  pagina.drawText(texto, {
    x: quadro.x + (quadro.largura - largura) / 2,
    y: quadro.y + mmParaPt(0.4),
    size: tamanho,
    font: fonte,
    color: preto,
  });
}

/** O mesmo código num canvas, com módulo inteiro para a barra não borrar. */
function barrasEmCanvas(codigo: CodigoDeBarras, larguraDesejada: number, alturaEmMm: number, legenda: boolean) {
  const total = codigo.modulos.length + codigo.silencio * 2;
  const modulo = Math.max(1, Math.round(larguraDesejada / total));
  const largura = modulo * total;
  // A proporção entre altura e largura vem dos milímetros pedidos, para o PNG
  // sair com a mesma cara do PDF.
  const alturaDasBarras = Math.max(20, Math.round((alturaEmMm / 25.4) * 96));
  const rodape = legenda ? Math.round(alturaDasBarras * 0.22) : 0;

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = alturaDasBarras + rodape;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar o código.');

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, canvas.width, canvas.height);
  pincel.fillStyle = '#000000';

  const comprida = barrasCompridas(codigo.simbologia, codigo.modulos.length);
  const esquerda = codigo.silencio * modulo;
  for (const faixa of faixasEscuras(codigo.modulos)) {
    const altura = alturaDasBarras + (comprida(faixa.inicio) ? rodape * 0.7 : 0);
    pincel.fillRect(esquerda + faixa.inicio * modulo, 0, faixa.largura * modulo, altura);
  }

  if (legenda && rodape) {
    pincel.font = `${Math.round(rodape * 0.9)}px monospace`;
    pincel.textAlign = 'center';
    pincel.textBaseline = 'bottom';
    pincel.fillText(codigo.legenda, largura / 2, canvas.height);
  }

  return canvas;
}

// ------------------------------------------------------------ entregar ---

async function entregar(saidas: OutputFile[], nomeDoZip: string, notas: string[]): Promise<RunResult> {
  const outputBytes = saidas.reduce((total, arquivo) => total + arquivo.blob.size, 0);
  if (saidas.length === 1) {
    return { files: saidas, inputBytes: 0, outputBytes, notes: notas };
  }

  const zip = await zipFiles(saidas.map((arquivo) => ({ name: arquivo.name, blob: arquivo.blob })));
  return {
    files: [{ name: `${nomeDoZip}.zip`, blob: zip, pages: saidas.length }],
    inputBytes: 0,
    outputBytes: zip.size,
    notes: [`${saidas.length} códigos, entregues num .zip.`, ...notas],
  };
}

/**
 * Monta a folha de etiquetas.
 *
 * A montagem é idêntica para QR e para barras — o que muda é só o que vai
 * dentro de cada quadro. Por isso quem chama entrega uma função que, a partir
 * do documento recém-criado, devolve o desenhista: é ali que a fonte é
 * embutida, no documento certo. Fonte pertence ao documento em que foi
 * embutida, e usar a de outro entrega um PDF que abre com a legenda em branco.
 */
async function montarFolha(
  ctx: RunContext,
  conteudos: string[],
  medidaDoItem: { largura: number; altura: number },
  prepararDesenho: (doc: Documento) => Promise<(pagina: Pagina, conteudo: string, quadro: Quadro) => void>,
  nome: string,
): Promise<{ arquivo: OutputFile; porFolha: number }> {
  const { PDFDocument } = await loadPdfLib();
  const folha = folhaEmPontos(ctx.options);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 0, 40, 8));
  const espaco = mmParaPt(limitar(ctx.options.espacoMm, 0, 30, 3));
  const repetir = Math.round(limitar(ctx.options.repetir, 1, 500, 1));

  const vagas = vagasNaFolha(folha, medidaDoItem, margem, espaco);
  if (!vagas.length) {
    throw new Error(
      'O código não cabe no papel escolhido com essa margem. Diminua o tamanho do código, ' +
        'reduza a margem, ou escolha um papel maior.',
    );
  }

  // Cada conteúdo repetido N vezes, na ordem — é como se corta a folha
  // depois: um bloco de cada, e não intercalado.
  const fila: string[] = [];
  for (const conteudo of conteudos) {
    for (let i = 0; i < repetir; i += 1) fila.push(conteudo);
  }

  const doc = await PDFDocument.create();
  const desenhar = await prepararDesenho(doc);
  const folhas = Math.ceil(fila.length / vagas.length);
  for (let f = 0; f < folhas; f += 1) {
    ctx.onProgress(f / folhas, `Folha ${f + 1} de ${folhas}`);
    const pagina = doc.addPage([folha.largura, folha.altura]);
    for (let i = 0; i < vagas.length; i += 1) {
      const conteudo = fila[f * vagas.length + i];
      if (conteudo === undefined) break;
      desenhar(pagina, conteudo, vagas[i]);
    }
    await yieldToBrowser();
  }

  return {
    arquivo: { name: `${nome}.pdf`, blob: await salvarPdf(doc), pages: doc.getPageCount() },
    porFolha: vagas.length,
  };
}

// ------------------------------------------------------------- QR Code ---

/**
 * O que a tela pediu, virado no texto que o celular entende.
 *
 * O tipo "texto" é o caminho antigo: uma linha por código, para gerar em
 * lote. Os outros montam um formato só — não faz sentido colar uma coluna de
 * planilha num campo de chave PIX.
 */
function conteudosDoPedido(opcoes: RunContext['options']): string[] {
  const tipo = String(opcoes.tipo ?? 'texto') as TipoDeConteudo;
  if (tipo === 'texto') return linhasDeConteudo(opcoes.conteudo);

  const campos: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(opcoes)) campos[chave] = String(valor ?? '');
  return [montarConteudo(tipo, campos)];
}

export async function gerarQrCode(ctx: RunContext): Promise<RunResult> {
  const conteudos = conteudosDoPedido(ctx.options);
  const tipo = String(ctx.options.tipo ?? 'texto') as TipoDeConteudo;
  const correcao = correcaoValida(ctx.options.correcao);
  const saida = String(ctx.options.saida ?? 'png');
  const ladoMm = limitar(ctx.options.ladoMm, 5, 200, 30);

  const matrizes = conteudos.map((conteudo) => matrizQr(conteudo, correcao));
  const maiorVersao = Math.max(...matrizes.map((matriz) => matriz.versao));

  const notas = [
    tipo === 'texto'
      ? `Correção de erro ${correcao}: o código continua legível com parte dele danificada.`
      : `${TIPOS[tipo].nome}: ${TIPOS[tipo].sobre}`,
    'A borda branca em volta faz parte do código. Cortar rente é o motivo mais comum de um QR impresso não ler.',
  ];
  if (tipo === 'pix') {
    notas.push(
      'O código segue o padrão do Banco Central, com o verificador calculado no fim. ' +
        'O mesmo texto serve como PIX copia e cola.',
    );
    notas.push('Confira com um pagamento de teste antes de imprimir em quantidade: chave errada não dá erro nenhum.');
  }
  if (maiorVersao >= 10) {
    notas.push(
      `O conteúdo mais longo gerou um código de versão ${maiorVersao}, com muitos módulos. ` +
        'Impresso pequeno ele fica difícil de ler: aumente o tamanho, ou encurte o texto.',
    );
  }

  if (saida === 'folha') {
    const lado = mmParaPt(ladoMm);
    const { rgb } = await loadPdfLib();
    const preto = rgb(0, 0, 0);
    // As matrizes já foram calculadas: o desenho na folha só as consulta pelo
    // conteúdo, em vez de refazer a conta uma vez por etiqueta repetida.
    const porConteudo = new Map(conteudos.map((conteudo, i) => [conteudo, matrizes[i]]));

    const { arquivo, porFolha } = await montarFolha(
      ctx,
      conteudos,
      { largura: lado, altura: lado },
      async () => (pagina, conteudo, quadro) =>
        desenharQr(pagina, porConteudo.get(conteudo) ?? matrizQr(conteudo, correcao), quadro, preto),
      'etiquetas-qrcode',
    );
    ctx.onProgress(1);
    return {
      files: [arquivo],
      inputBytes: 0,
      outputBytes: arquivo.blob.size,
      notes: [`${porFolha} códigos por folha, de ${ladoMm} mm cada.`, ...notas],
    };
  }

  if (saida === 'pdf') {
    const { PDFDocument, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const lado = mmParaPt(ladoMm);
    const preto = rgb(0, 0, 0);

    matrizes.forEach((matriz) => {
      const pagina = doc.addPage([lado, lado]);
      desenharQr(pagina, matriz, { x: 0, y: 0, largura: lado, altura: lado }, preto);
    });

    const blob = await salvarPdf(doc);
    ctx.onProgress(1);
    return {
      files: [{ name: tipo === 'texto' ? 'qrcode.pdf' : `qrcode-${tipo}.pdf`, blob, pages: doc.getPageCount() }],
      inputBytes: 0,
      outputBytes: blob.size,
      notes: [`Cada página tem ${ladoMm}x${ladoMm} mm, do tamanho exato do código.`, ...notas],
    };
  }

  const pixels = Math.round(limitar(ctx.options.pixels, 64, 4000, 600));
  const saidas: OutputFile[] = [];
  for (let i = 0; i < matrizes.length; i += 1) {
    ctx.onProgress(i / matrizes.length, `${i + 1} de ${matrizes.length}`);
    const canvas = qrEmCanvas(matrizes[i], pixels);
    saidas.push({
      name: nomeDoQr(tipo, conteudos[i], i, 'png'),
      blob: await canvasToBlob(canvas, 'image/png'),
    });
    await yieldToBrowser();
  }

  ctx.onProgress(1);
  return entregar(saidas, 'qrcodes', [
    'PNG, para tela e para WhatsApp. Para imprimir grande, gere em PDF: lá o código é vetor e não perde a borda.',
    ...notas,
  ]);
}

// ---------------------------------------------------- código de barras ---

export async function gerarCodigoBarras(ctx: RunContext): Promise<RunResult> {
  const conteudos = linhasDeConteudo(ctx.options.conteudo);
  const simbologia = simbologiaValida(ctx.options.simbologia);
  const saida = String(ctx.options.saida ?? 'png');
  const legenda = ligado(ctx.options.legenda, true);
  const larguraMm = limitar(ctx.options.larguraMm, 15, 300, 50);
  const alturaMm = limitar(ctx.options.alturaMm, 6, 100, 20);

  // Gerar tudo antes de desenhar: um dígito errado na décima linha tem que
  // impedir a folha inteira, e não sair como dez etiquetas boas e vinte em
  // branco depois de já ter ido para a impressora.
  const codigos = conteudos.map((conteudo, i) => {
    try {
      return gerarCodigo(simbologia, conteudo);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new Error(`Linha ${i + 1} ("${conteudo}"): ${motivo}`);
    }
  });

  const notas = [`${SIMBOLOGIAS[simbologia].nome}: ${SIMBOLOGIAS[simbologia].sobre}`];
  const menorModulo = (larguraMm / (codigos[0].modulos.length + codigos[0].silencio * 2)) * 1000;
  if (menorModulo < 250) {
    notas.push(
      `A barra mais fina ficou com ${Math.round(menorModulo)} micrômetros. Abaixo de 250 a tinta espalha ` +
        'e fecha o espaço entre barras: aumente a largura, ou imprima em laser, que espalha menos que jato de tinta.',
    );
  }
  notas.push('O branco em volta do código é parte dele. Não encoste texto nem moldura na lateral das barras.');

  if (saida === 'folha') {
    const { rgb, StandardFonts } = await loadPdfLib();
    const preto = rgb(0, 0, 0);
    const porConteudo = new Map(conteudos.map((conteudo, i) => [conteudo, codigos[i]]));

    const { arquivo, porFolha } = await montarFolha(
      ctx,
      conteudos,
      { largura: mmParaPt(larguraMm), altura: mmParaPt(alturaMm) },
      async (doc) => {
        const fonte = await doc.embedFont(StandardFonts.Helvetica);
        return (pagina, conteudo, quadro) => {
          const codigo = porConteudo.get(conteudo) ?? gerarCodigo(simbologia, conteudo);
          desenharBarras(pagina, codigo, quadro, legenda, fonte, preto);
        };
      },
      'etiquetas-codigo-de-barras',
    );

    ctx.onProgress(1);
    return {
      files: [arquivo],
      inputBytes: 0,
      outputBytes: arquivo.blob.size,
      notes: [`${porFolha} etiquetas por folha, de ${larguraMm}x${alturaMm} mm.`, ...notas],
    };
  }

  if (saida === 'pdf') {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const preto = rgb(0, 0, 0);
    const largura = mmParaPt(larguraMm);
    const altura = mmParaPt(alturaMm);

    for (const codigo of codigos) {
      const pagina = doc.addPage([largura, altura]);
      desenharBarras(pagina, codigo, { x: 0, y: 0, largura, altura }, legenda, fonte, preto);
    }

    const blob = await salvarPdf(doc);
    ctx.onProgress(1);
    return {
      files: [{ name: 'codigo-de-barras.pdf', blob, pages: doc.getPageCount() }],
      inputBytes: 0,
      outputBytes: blob.size,
      notes: [`Cada página tem ${larguraMm}x${alturaMm} mm, do tamanho da etiqueta.`, ...notas],
    };
  }

  const pixels = Math.round(limitar(ctx.options.pixels, 200, 4000, 900));
  const saidas: OutputFile[] = [];
  for (let i = 0; i < codigos.length; i += 1) {
    ctx.onProgress(i / codigos.length, `${i + 1} de ${codigos.length}`);
    const canvas = barrasEmCanvas(codigos[i], pixels, alturaMm, legenda);
    saidas.push({
      name: nomeDoCodigo(codigos[i].legenda, i, 'png'),
      blob: await canvasToBlob(canvas, 'image/png'),
    });
    await yieldToBrowser();
  }

  ctx.onProgress(1);
  return entregar(saidas, 'codigos-de-barras', [
    'PNG, para tela. Para etiqueta impressa, gere em PDF: lá a largura da barra sai exata, e é ela que o leitor mede.',
    ...notas,
  ]);
}
