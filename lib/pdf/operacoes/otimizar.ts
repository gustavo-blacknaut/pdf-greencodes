'use client';

/** Deixar o arquivo menor, mais leve ou legível de novo. */

import {
  canvasToBlob,
  copy,
  openWithPdfJs,
  openWithPdfLib,
  renderPageToCanvas,
  respirar,
  salvarPdf,
  senhaDaFila,
} from '../nucleo';
import { type OutputFile, type RunContext, type RunResult } from '../tipos';
import { suffixName } from '../../utils';
import { loadPdfLib } from '../lazy';

/**
 * Níveis de compressão.
 *
 * `dpi: 0` significa não rasterizar: o documento é só reescrito com estrutura
 * compacta, e nem um pixel muda. Esse é o padrão de propósito.
 *
 * Rasterizar reduz muito mais, mas mexe na cor, e isso não é ajuste fino: o
 * canvas entrega tudo em sRGB e o JPEG ainda faz subamostragem de croma. Um PDF
 * em CMYK ou com perfil ICC embutido sai visivelmente diferente do original.
 * Quem pede "só comprimir" não espera a cor mudar, então isso virou escolha
 * explícita, com aviso na tela.
 */
export const COMPRESSION_PRESETS = {
  'sem-perda': { dpi: 0, quality: 0 },
  equilibrada: { dpi: 150, quality: 0.82 },
  maxima: { dpi: 110, quality: 0.62 },
} as const;

export type CompressionLevel = keyof typeof COMPRESSION_PRESETS;

export async function compress(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const level = (ctx.options.level as CompressionLevel) ?? 'sem-perda';
  const preset = COMPRESSION_PRESETS[level] ?? COMPRESSION_PRESETS['sem-perda'];
  const notes: string[] = [];
  const outputs: OutputFile[] = [];
  const canvas = document.createElement('canvas');

  let inputBytes = 0;
  let outputBytes = 0;

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    const fileWeight = 1 / ctx.files.length;
    const fileBase = f * fileWeight;

    let rasterized: Blob | null = null;

    if (preset.dpi > 0) {
      const doc = await openWithPdfJs(source.bytes, source.senha);
      const out = await PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i += 1) {
        ctx.onProgress(
          fileBase + (fileWeight * (i - 1)) / doc.numPages,
          `${source.name}: página ${i} de ${doc.numPages}`,
        );
        const page = await doc.getPage(i);
        const { widthPt, heightPt } = await renderPageToCanvas(page, preset.dpi, canvas);
        const jpeg = await canvasToBlob(canvas, 'image/jpeg', preset.quality);
        const embedded = await out.embedJpg(await jpeg.arrayBuffer());
        const target = out.addPage([widthPt, heightPt]);
        target.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
        page.cleanup();
        await respirar(ctx);
      }
      await doc.destroy();
      rasterized = await salvarPdf(out, source.senha);
    }

    // Rasterizar destrói o texto vetorial: num PDF que já é só texto o arquivo
    // costuma crescer. Por isso comparamos com a reescrita sem perda e ficamos
    // com o menor dos dois.
    ctx.onProgress(fileBase + fileWeight * 0.9, `${source.name}: otimizando a estrutura`);
    const lossless = await openWithPdfLib(source.bytes, source.senha);
    const losslessBlob = await salvarPdf(lossless, source.senha);

    let chosen = rasterized && rasterized.size < losslessBlob.size ? rasterized : losslessBlob;
    if (chosen.size >= source.size) {
      // Nenhum dos dois caminhos ganhou do arquivo que entrou.
      chosen = new Blob([copy(source.bytes)], { type: 'application/pdf' });
      notes.push(
        `${source.name}: neste nível a compressão deixaria o arquivo maior, então mantivemos o original. Tente um nível mais forte.`,
      );
    } else if (chosen === losslessBlob && rasterized) {
      notes.push(`${source.name}: converter em imagem deixaria maior, então preservamos o conteúdo original.`);
    } else if (chosen === rasterized) {
      notes.push(`${source.name}: as páginas viraram imagem, então a cor pode sair um pouco diferente do original.`);
    }

    outputBytes += chosen.size;
    outputs.push({ name: suffixName(source.name, 'comprimido'), blob: chosen, pages: source.pageCount ?? undefined });
  }

  ctx.onProgress(1);
  // Comprimir vários e receber vários arquivos separados obriga a juntar
  // depois, numa segunda passada. Com a opção ligada sai um documento só, na
  // ordem da fila.
  const juntar = ctx.options.juntar === true || ctx.options.juntar === 'true';
  if (juntar && outputs.length > 1) {
    ctx.onProgress(0.95, 'Juntando num arquivo só');
    const unido = await PDFDocument.create();
    let paginas = 0;

    for (const arquivo of outputs) {
      const parte = await PDFDocument.load(await arquivo.blob.arrayBuffer());
      const indices = parte.getPageIndices();
      for (const pagina of await unido.copyPages(parte, indices)) unido.addPage(pagina);
      paginas += indices.length;
      await respirar(ctx);
    }

    const blob = await salvarPdf(unido, senhaDaFila(ctx.files));
    ctx.onProgress(1);
    return {
      files: [{ name: suffixName(ctx.files[0].name, 'comprimido-unido'), blob, pages: paginas }],
      inputBytes,
      outputBytes: blob.size,
      notes: [...notes, `${outputs.length} arquivos comprimidos e unidos em ${paginas} páginas.`],
      highlightSavings: true,
    };
  }

  return { files: outputs, inputBytes, outputBytes, notes, highlightSavings: true };
}

/**
 * Não conserta um PDF corrompido de verdade: só reconstrói a estrutura
 * interna (tabela de referências, objetos) do zero a partir do que consegue
 * ler. É o mesmo caminho que a compressão "sem perda" usa, exposto como
 * ferramenta própria porque resolve boa parte dos "meu PDF não abre".
 */
export async function repair(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  ctx.onProgress(0.15, 'Lendo a estrutura do arquivo...');
  const doc = await openWithPdfLib(source.bytes, source.senha);
  ctx.onProgress(0.7, 'Reescrevendo o PDF do zero...');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'reparado'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Reescrevemos toda a estrutura interna do arquivo. Isso resolve boa parte dos PDFs corrompidos ou gerados por programas com falhas, mas não recupera conteúdo que já estava perdido no original.',
    ],
  };
}

/**
 * Roda a mesma máquina em todas as ferramentas que mexem na cor: desenha a
 * página, transforma os pixels e devolve um PDF de imagens.
 *
 * Rasterizar descarta o texto vetorial, então o resultado deixa de ser
 * pesquisável. É o preço de garantir que a cor no papel seja a que aparece
 * na tela: mexer nas cores sem redesenhar exigiria reinterpretar cada objeto
 * do PDF, um por um, e ainda assim não pegaria o que está dentro de imagem.
 */
async function redesenharComFiltro(
  ctx: RunContext,
  filtro: (dados: Uint8ClampedArray) => void,
  sufixo: string,
  notas: string[],
): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const dpi = Math.max(72, Math.min(300, Number(ctx.options.dpi ?? 150)));
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);

    const pincel = canvas.getContext('2d');
    if (pincel) {
      const imagem = pincel.getImageData(0, 0, canvas.width, canvas.height);
      filtro(imagem.data);
      pincel.putImageData(imagem, 0, 0);
    }

    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

    page.cleanup();
    await respirar(ctx);
  }
  const paginas = doc.numPages;
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, sufixo), blob, pages: paginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

/** Luminância perceptual: verde pesa mais que vermelho, que pesa mais que azul. */
function luz(dados: Uint8ClampedArray, p: number): number {
  return 0.2126 * dados[p] + 0.7152 * dados[p + 1] + 0.0722 * dados[p + 2];
}

/**
 * Inverte para preto e branco: escuro fica claro, claro fica escuro.
 *
 * Não é inverter cada canal de cor — isso devolve as complementares, que é
 * outra coisa e quase nunca é o que se quer. O uso real é ler um documento
 * de fundo escuro, ou economizar toner num que veio todo preto.
 *
 * Separada da operação para poder ser verificada sem montar um PDF inteiro.
 */
export function filtroInverter(dados: Uint8ClampedArray): void {
  for (let p = 0; p < dados.length; p += 4) {
    const cinza = Math.round(255 - luz(dados, p));
    dados[p] = cinza;
    dados[p + 1] = cinza;
    dados[p + 2] = cinza;
  }
}

/**
 * Tudo acima do limite vira branco; o resto vira preto puro.
 *
 * Sem meio-termo de propósito: cinza claro imprime falhado, e texto
 * digitalizado costuma sair cinza. Assim ele sai cheio.
 */
export function filtroTonsDePreto(dados: Uint8ClampedArray, limite: number): void {
  for (let p = 0; p < dados.length; p += 4) {
    const valor = luz(dados, p) > limite ? 255 : 0;
    dados[p] = valor;
    dados[p + 1] = valor;
    dados[p + 2] = valor;
  }
}

/**
 * Inverte: o que era preto vira branco e o que era branco vira preto.
 *
 * Só em preto e branco, e não invertendo cada canal de cor. Inverter os
 * canais de um documento colorido devolve as cores complementares, que é
 * outra coisa e quase nunca é o que se quer — o uso real é ler um documento
 * de fundo escuro, ou economizar toner num que veio todo preto.
 */
export async function invertColors(ctx: RunContext): Promise<RunResult> {
  return redesenharComFiltro(
    ctx,
    filtroInverter,
    'invertido',
    [
      'O documento vira preto e branco invertido: o que era escuro fica claro e o que era claro fica escuro.',
      'As páginas viraram imagem, então o texto deixa de ser selecionável e pesquisável.',
    ],
  );
}

/**
 * Tons de preto: o que é cinza vira preto.
 *
 * Cinza claro imprime falhado, e texto digitalizado costuma sair cinza. Aqui
 * tudo que passa do limite vira branco e o resto vira preto puro, sem meio
 * termo — o texto sai cheio, e não chapiscado.
 */
export async function blackTones(ctx: RunContext): Promise<RunResult> {
  // Acima disto é fundo; abaixo é conteúdo. 180 de 255 deixa o cinza claro
  // do papel digitalizado virar branco e o cinza do texto virar preto.
  const limite = Math.max(60, Math.min(240, Number(ctx.options.limite ?? 180)));

  return redesenharComFiltro(
    ctx,
    (dados) => filtroTonsDePreto(dados, limite),
    'preto',
    [
      'Cinza virou preto puro e o fundo virou branco. Texto claro de digitalização sai cheio em vez de falhado.',
      'Não há meio-tom: foto neste modo vira mancha. Para foto, use tons de cinza.',
    ],
  );
}

/**
 * Converte para tons de cinza rasterizando cada página. Isso descarta o texto
 * vetorial, então o resultado deixa de ser pesquisável — é o preço de garantir
 * que nada saia colorido na impressão.
 */
export async function grayscale(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const dpi = Math.max(72, Math.min(300, Number(ctx.options.dpi ?? 150)));
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);

    const pincel = canvas.getContext('2d');
    if (pincel) {
      const imagem = pincel.getImageData(0, 0, canvas.width, canvas.height);
      const dados = imagem.data;
      for (let p = 0; p < dados.length; p += 4) {
        // Luminância perceptual: verde pesa mais que vermelho, que pesa mais
        // que azul. A média simples achata contraste e suja o texto.
        const cinza = Math.round(0.2126 * dados[p] + 0.7152 * dados[p + 1] + 0.0722 * dados[p + 2]);
        dados[p] = cinza;
        dados[p + 1] = cinza;
        dados[p + 2] = cinza;
      }
      pincel.putImageData(imagem, 0, 0);
    }

    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

    page.cleanup();
    await respirar(ctx);
  }
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'cinza'), blob, pages: doc.numPages }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['As páginas viraram imagem em tons de cinza, então o texto deixa de ser selecionável e pesquisável.'],
  };
}
