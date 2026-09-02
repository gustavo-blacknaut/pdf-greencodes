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
