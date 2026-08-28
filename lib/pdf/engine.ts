'use client';

import { loadPdfJs, loadPdfLib } from './lazy';
import { abortarSePreciso, LIMITES, pareceMesmoImagem, pareceMesmoPdf } from './guards';
import { hexParaRgb, paraCoordenadasPdf } from './layout';
import { parsePageRange, replaceExtension, suffixName, yieldToBrowser } from '../utils';

export type LoadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  bytes: ArrayBuffer;
  pageCount: number | null;
  thumbnail: string | null;
  /** PDF que exige senha de abertura e ainda não foi destravado. */
  locked?: boolean;
  /** Senha informada pela pessoa. Vive só nesta aba e nunca é gravada. */
  senha?: string;
  error?: string;
};

export type OutputFile = {
  name: string;
  blob: Blob;
  pages?: number;
};

export type RunResult = {
  files: OutputFile[];
  inputBytes: number;
  outputBytes: number;
  notes: string[];
  /**
   * Só as ferramentas em que encolher é o objetivo mostram o comparativo de
   * tamanho. Num PDF para TXT, "economia de 100%" seria uma métrica sem sentido.
   */
  highlightSavings?: boolean;
};

export type ProgressFn = (fraction: number, label?: string) => void;

export type RunContext = {
  files: LoadedFile[];
  options: Record<string, string | number | boolean>;
  onProgress: ProgressFn;
  /** Cancelamento pelo usuário ou estouro do tempo máximo. */
  signal?: AbortSignal;
};

/**
 * Ponto de respiro dos laços: devolve a thread para a interface e é onde o
 * cancelamento efetivamente acontece. Sem isso uma operação longa só terminaria
 * quando quisesse.
 */
async function respirar(ctx: RunContext): Promise<void> {
  abortarSePreciso(ctx.signal);
  await yieldToBrowser();
}

const MAX_RASTER_EDGE = 4200;

/* -------------------------------------------------------------------------- */
/* Primitivas compartilhadas                                                   */
/* -------------------------------------------------------------------------- */

/** pdf.js e pdf-lib consomem (e às vezes destacam) o buffer, então sempre copiamos. */
function copy(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

/**
 * pdf-lib devolve `Uint8Array<ArrayBufferLike>`, que o TS 5.7 recusa como
 * BlobPart (o buffer poderia, em tese, ser um SharedArrayBuffer). Em runtime é
 * sempre um ArrayBuffer comum.
 */
function toPdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

/**
 * Abre com o pdf-lib sempre descriptografando de verdade.
 *
 * `ignoreEncryption: true` parece resolver e não resolve: o documento abre, as
 * páginas aparecem, e o conteúdo continua cifrado. Copiar essas páginas gera um
 * PDF que abre em branco e imprime nada. Era essa a causa de "juntei e não saiu
 * conteúdo".
 *
 * Senha vazia cobre o caso mais comum de arquivo travado: proteção só com senha
 * de dono, usada em prova, boleto e extrato. Esse arquivo abre normalmente em
 * qualquer leitor e nunca pede nada, mas continua cifrado por dentro. Quando
 * existe senha de abertura de verdade, o pdf-lib lança e a interface pede a
 * senha para a pessoa.
 *
 * Como nunca chamamos `encrypt()` ao salvar, o arquivo entregue sai sem senha.
 */
async function openWithPdfLib(bytes: ArrayBuffer, password = '') {
  const { PDFDocument } = await loadPdfLib();
  return PDFDocument.load(copy(bytes), { password, updateMetadata: false });
}

async function openWithPdfJs(bytes: ArrayBuffer, password?: string) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data: copy(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    ...(password ? { password } : {}),
  }).promise;
}

/** PDFs com senha de abertura só podem ser lidos com ela, então tratamos à parte. */
function isPasswordError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return name === 'PasswordException' || /password|encrypt/i.test(message);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem da página.'))),
      mime,
      quality,
    );
  });
}

/** Fontes standard usam WinAnsi; caracteres fora dela quebram o pdf-lib. */
function sanitizeText(text: string): string {
  return text.replace(/[^\x20-\xFF]/g, '');
}

async function renderPageToCanvas(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof openWithPdfJs>>['getPage']>>,
  dpi: number,
  canvas: HTMLCanvasElement,
) {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  const longestEdge = Math.max(base.width, base.height) * scale;
  if (longestEdge > MAX_RASTER_EDGE) scale *= MAX_RASTER_EDGE / longestEdge;

  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Seu navegador bloqueou o canvas 2D, necessário para esta ferramenta.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

  return { widthPt: base.width, heightPt: base.height };
}

/* -------------------------------------------------------------------------- */
/* Ingestão: metadados + miniatura (roda assim que o arquivo entra na tela)     */
/* -------------------------------------------------------------------------- */

export async function inspectFile(file: File, id: string): Promise<LoadedFile> {
  const bytes = await file.arrayBuffer();
  const base: LoadedFile = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''),
    bytes,
    pageCount: null,
    thumbnail: null,
  };

  if (!base.type.startsWith('image/') && !base.name.toLowerCase().endsWith('.pdf')) {
    return { ...base, error: 'Formato não suportado.' };
  }

  // O conteúdo manda, não a extensão nem o MIME informado pelo sistema: os dois
  // são só rótulos e podem estar mentindo. Quem não passa daqui não chega ao parser.
  if (base.type.startsWith('image/')) {
    if (!pareceMesmoImagem(bytes)) {
      return { ...base, error: 'O conteúdo não corresponde a uma imagem JPG, PNG ou WebP.' };
    }
    return { ...base, pageCount: 1, thumbnail: await imageThumbnail(file) };
  }

  if (!pareceMesmoPdf(bytes)) {
    return { ...base, error: 'Este arquivo tem extensão .pdf mas o conteúdo não é um PDF.' };
  }

  try {
    const doc = await openWithPdfJs(bytes);
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, 48, canvas);
    const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
    const pageCount = doc.numPages;
    await doc.destroy();
    return { ...base, pageCount, thumbnail };
  } catch (error) {
    if (isPasswordError(error)) {
      return { ...base, locked: true, error: 'Protegido por senha' };
    }
    // Ainda pode ser utilizável, só não conseguimos gerar a miniatura.
    try {
      const doc = await openWithPdfLib(bytes);
      return { ...base, pageCount: doc.getPageCount() };
    } catch {
      return { ...base, error: 'Não foi possível ler este PDF (pode estar corrompido).' };
    }
  }
}

/**
 * Tenta abrir um PDF travado com a senha que a pessoa digitou.
 *
 * Devolve o arquivo já com miniatura e contagem de páginas, para dar retorno na
 * hora: se a miniatura apareceu, a senha valeu. A senha fica só neste objeto,
 * em memória, e some quando a aba fecha.
 */
export async function desbloquearArquivo(arquivo: LoadedFile, senha: string): Promise<LoadedFile> {
  let doc;
  try {
    doc = await openWithPdfJs(arquivo.bytes, senha);
  } catch (error) {
    throw new Error(
      isPasswordError(error) ? 'Senha incorreta para este arquivo.' : 'Não foi possível abrir este PDF.',
    );
  }

  try {
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, 48, canvas);
    page.cleanup();
    return {
      ...arquivo,
      senha,
      locked: false,
      error: undefined,
      pageCount: doc.numPages,
      thumbnail: canvas.toDataURL('image/jpeg', 0.7),
    };
  } finally {
    await doc.destroy();
  }
}

async function imageThumbnail(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

/**
 * Miniaturas de todas as páginas, entregues uma a uma conforme ficam prontas.
 * Assim a grade vai se preenchendo, em vez de piscar tudo de uma vez no fim.
 */
export async function renderPageThumbnails(
  bytes: ArrayBuffer,
  onPage: (index: number, dataUrl: string, total: number) => void,
  cancelToken: { cancelled: boolean },
): Promise<void> {
  const doc = await openWithPdfJs(bytes);
  const canvas = document.createElement('canvas');
  // Documentos enormes não podem virar milhares de imagens em memória; acima do
  // teto as páginas continuam na grade, só que identificadas pelo número.
  const ate = Math.min(doc.numPages, LIMITES.miniaturas);
  try {
    for (let i = 1; i <= ate; i += 1) {
      if (cancelToken.cancelled) return;
      const page = await doc.getPage(i);
      await renderPageToCanvas(page, 36, canvas);
      onPage(i - 1, canvas.toDataURL('image/jpeg', 0.72), doc.numPages);
      page.cleanup();
      await yieldToBrowser();
    }
  } finally {
    await doc.destroy();
  }
}

export type PaginaParaEditor = {
  dataUrl: string;
  larguraPt: number;
  alturaPt: number;
  /** Página girada aparece deitada no editor; avisamos em vez de errar a conta. */
  rotacao: number;
  totalPaginas: number;
};

/**
 * Desenha uma página para o editor visual.
 *
 * O viewport é forçado em `rotation: 0` de propósito: assim o que aparece na
 * tela é exatamente o espaço de coordenadas em que o pdf-lib vai desenhar, e a
 * conversão de posição vira uma regra de três. Com rotação embutida, cada uma
 * das quatro orientações precisaria de uma matriz diferente, e um erro ali
 * colocaria a assinatura no lugar errado sem ninguém perceber.
 */
export async function renderPaginaParaEditor(
  bytes: ArrayBuffer,
  indice: number,
  larguraAlvo = 1000,
): Promise<PaginaParaEditor> {
  const doc = await openWithPdfJs(bytes);
  try {
    const page = await doc.getPage(indice + 1);
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const escala = Math.min(2, larguraAlvo / base.width);
    const viewport = page.getViewport({ scale: escala, rotation: 0 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Seu navegador bloqueou o canvas 2D, necessário para o editor.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

    const resultado: PaginaParaEditor = {
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      larguraPt: base.width,
      alturaPt: base.height,
      rotacao: ((page.rotate % 360) + 360) % 360,
      totalPaginas: doc.numPages,
    };
    page.cleanup();
    return resultado;
  } finally {
    await doc.destroy();
  }
}

/* -------------------------------------------------------------------------- */
/* Imagem virando página                                                       */
/* -------------------------------------------------------------------------- */

/** Documento aberto pelo pdf-lib. */
type PdfDoc = Awaited<ReturnType<typeof openWithPdfLib>>;

/** Milímetro para ponto tipográfico, a unidade em que o PDF mede tudo. */
export function mmParaPt(mm: number): number {
  return (mm * 72) / 25.4;
}

export const FORMATOS_MM = {
  a3: { largura: 297, altura: 420 },
  a4: { largura: 210, altura: 297 },
  a5: { largura: 148, altura: 210 },
  carta: { largura: 215.9, altura: 279.4 },
  oficio: { largura: 215.9, altura: 355.6 },
  '10x15': { largura: 100, altura: 150 },
  '13x18': { largura: 130, altura: 180 },
  '20x25': { largura: 200, altura: 250 },
} as const;

export type Ajuste = 'proporcao' | 'esticar' | 'preencher';

type TamanhoPagina = { largura: number; altura: number; seguirImagem: boolean };

function tamanhoDaPagina(
  opcoes: Record<string, string | number | boolean>,
  larguraImagem: number,
  alturaImagem: number,
): TamanhoPagina {
  const formato = String(opcoes.formato ?? 'imagem');

  if (formato === 'imagem') {
    return { largura: larguraImagem, altura: alturaImagem, seguirImagem: true };
  }

  if (formato === 'personalizado') {
    const largura = mmParaPt(Math.min(Math.max(Number(opcoes.larguraMm) || 100, 10), 2000));
    const altura = mmParaPt(Math.min(Math.max(Number(opcoes.alturaMm) || 150, 10), 2000));
    return { largura, altura, seguirImagem: false };
  }

  const medida = FORMATOS_MM[formato as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4;
  const deitado = opcoes.deitado === true || opcoes.deitado === 'true';
  // "Automático" só existe aqui: a folha acompanha a orientação da foto.
  const auto = opcoes.orientacao === 'auto' && larguraImagem > alturaImagem;
  const girar = deitado || auto;

  return {
    largura: mmParaPt(girar ? medida.altura : medida.largura),
    altura: mmParaPt(girar ? medida.largura : medida.altura),
    seguirImagem: false,
  };
}

/**
 * Desenha a imagem numa página nova, respeitando o modo de ajuste.
 *
 * O recorte do modo "preencher" acontece no canvas, e não no PDF: o pdf-lib
 * desenha a imagem inteira ou nada, então cortar depois de embutir não é
 * possível. Renderizar já na proporção final resolve isso e ainda evita
 * carregar pixel que ia ser jogado fora.
 */
async function desenharPaginaDeImagem(
  out: PdfDoc,
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  pagina: TamanhoPagina,
  margem: number,
  ajuste: Ajuste,
): Promise<void> {
  const page = out.addPage([pagina.largura, pagina.altura]);
  const caixa = {
    largura: Math.max(1, pagina.largura - margem * 2),
    altura: Math.max(1, pagina.altura - margem * 2),
  };

  const c2d = canvas.getContext('2d', { alpha: false });
  if (!c2d) throw new Error('Canvas 2D indisponível neste navegador.');

  // Renderiza na resolução da caixa, com teto para não estourar a memória.
  const escala = Math.min(150 / 72, MAX_RASTER_EDGE / Math.max(caixa.largura, caixa.altura));
  canvas.width = Math.max(1, Math.round(caixa.largura * escala));
  canvas.height = Math.max(1, Math.round(caixa.altura * escala));

  c2d.fillStyle = '#ffffff';
  c2d.fillRect(0, 0, canvas.width, canvas.height);

  if (pagina.seguirImagem || ajuste === 'esticar') {
    c2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } else if (ajuste === 'preencher') {
    // Recorta o miolo da imagem na proporção da caixa e amplia até preencher.
    const proporcaoCaixa = canvas.width / canvas.height;
    const proporcaoImagem = bitmap.width / bitmap.height;
    const larguraFonte = proporcaoImagem > proporcaoCaixa ? bitmap.height * proporcaoCaixa : bitmap.width;
    const alturaFonte = proporcaoImagem > proporcaoCaixa ? bitmap.height : bitmap.width / proporcaoCaixa;
    c2d.drawImage(
      bitmap,
      (bitmap.width - larguraFonte) / 2,
      (bitmap.height - alturaFonte) / 2,
      larguraFonte,
      alturaFonte,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    const razao = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const largura = bitmap.width * razao;
    const altura = bitmap.height * razao;
    c2d.drawImage(bitmap, (canvas.width - largura) / 2, (canvas.height - altura) / 2, largura, altura);
  }

  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const embutida = await out.embedJpg(await jpeg.arrayBuffer());
  page.drawImage(embutida, { x: margem, y: margem, width: caixa.largura, height: caixa.altura });
}

/* -------------------------------------------------------------------------- */
/* Operações                                                                   */
/* -------------------------------------------------------------------------- */

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
const COMPRESSION_PRESETS = {
  'sem-perda': { dpi: 0, quality: 0 },
  equilibrada: { dpi: 150, quality: 0.82 },
  maxima: { dpi: 110, quality: 0.62 },
} as const;

type CompressionLevel = keyof typeof COMPRESSION_PRESETS;

async function compress(ctx: RunContext): Promise<RunResult> {
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
      rasterized = toPdfBlob(await out.save({ useObjectStreams: true }));
    }

    // Rasterizar destrói o texto vetorial: num PDF que já é só texto o arquivo
    // costuma crescer. Por isso comparamos com a reescrita sem perda e ficamos
    // com o menor dos dois.
    ctx.onProgress(fileBase + fileWeight * 0.9, `${source.name}: otimizando a estrutura`);
    const lossless = await openWithPdfLib(source.bytes, source.senha);
    const losslessBlob = toPdfBlob(await lossless.save({ useObjectStreams: true }));

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
  return { files: outputs, inputBytes, outputBytes, notes, highlightSavings: true };
}

async function merge(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  let inputBytes = 0;

  const canvas = document.createElement('canvas');
  const formatoImagem = String(ctx.options.formatoImagem ?? 'a4');
  let imagens = 0;

  for (let i = 0; i < ctx.files.length; i += 1) {
    const source = ctx.files[i];
    inputBytes += source.size;
    ctx.onProgress(i / ctx.files.length, `Juntando ${source.name}`);

    if (source.type.startsWith('image/')) {
      // Foto entra como página inteira, na mesma ordem em que foi solta.
      const bitmap = await createImageBitmap(new Blob([copy(source.bytes)], { type: source.type }));
      const pagina =
        formatoImagem === 'imagem'
          ? { largura: bitmap.width, altura: bitmap.height, seguirImagem: true }
          : tamanhoDaPagina({ formato: 'a4', orientacao: 'auto' }, bitmap.width, bitmap.height);
      await desenharPaginaDeImagem(out, canvas, bitmap, pagina, 0, 'proporcao');
      bitmap.close();
      imagens += 1;
    } else {
      const doc = await openWithPdfLib(source.bytes, source.senha);
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => out.addPage(page));
    }

    await respirar(ctx);
  }

  const name = String(ctx.options.filename || 'documento-unido').replace(/[\\/:*?"<>|]/g, '') || 'documento-unido';
  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);

  const notes: string[] = [];
  if (imagens > 0) notes.push(`${imagens} ${imagens === 1 ? 'imagem virou página' : 'imagens viraram páginas'}.`);
  if (ctx.files.some((f) => f.senha)) notes.push('O arquivo unido saiu sem senha.');

  return {
    files: [{ name: `${name}.pdf`, blob, pages: out.getPageCount() }],
    inputBytes,
    outputBytes: blob.size,
    notes,
  };
}

async function split(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pageCount = doc.getPageCount();
  const mode = String(ctx.options.mode ?? 'every');

  const groups: { label: string; indices: number[] }[] = [];
  const notes: string[] = [];

  if (mode === 'every') {
    const size = Math.max(1, Number(ctx.options.every) || 1);
    for (let start = 0; start < pageCount; start += size) {
      const indices = Array.from({ length: Math.min(size, pageCount - start) }, (_, k) => start + k);
      groups.push({ label: `${start + 1}-${start + indices.length}`, indices });
    }
  } else if (mode === 'size') {
    const maxMb = Math.max(0.001, Number(ctx.options.maxSize) || 10);
    const maxBytes = maxMb * 1024 * 1024;

    let currentIndices: number[] = [];
    let currentDoc = await PDFDocument.create();

    for (let i = 0; i < pageCount; i += 1) {
      const [copiedPage] = await currentDoc.copyPages(doc, [i]);
      currentDoc.addPage(copiedPage);
      const testBytes = await currentDoc.save({ useObjectStreams: true });

      if (testBytes.length > maxBytes && currentIndices.length > 0) {
        const label = `${currentIndices[0] + 1}-${currentIndices[currentIndices.length - 1] + 1}`;
        groups.push({ label, indices: currentIndices });

        currentIndices = [i];
        currentDoc = await PDFDocument.create();
        const [newPage] = await currentDoc.copyPages(doc, [i]);
        currentDoc.addPage(newPage);
      } else {
        currentIndices.push(i);
      }
      await respirar(ctx);
    }

    if (currentIndices.length > 0) {
      const label = `${currentIndices[0] + 1}-${currentIndices[currentIndices.length - 1] + 1}`;
      groups.push({ label, indices: currentIndices });
    }
    notes.push(`Dividido por tamanho limite de ${maxMb} MB por parte.`);
  } else if (mode === 'extract') {
    const rawInput = String(ctx.options.extractRanges || ctx.options.ranges || '').trim();
    if (!rawInput) throw new Error('Informe pelo menos uma página ou intervalo, ex: 1, 3, 5-8.');
    const chunks = rawInput.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const indicesSet = new Set<number>();
    for (const chunk of chunks) {
      const rangeIndices = parsePageRange(chunk, pageCount);
      rangeIndices.forEach((idx) => indicesSet.add(idx));
    }
    const indices = Array.from(indicesSet).sort((a, b) => a - b);
    if (!indices.length) throw new Error('Nenhuma página válida foi selecionada para extração.');
    groups.push({ label: 'selecionadas', indices });
    notes.push(`${indices.length} página(s) extraída(s) para o novo PDF.`);
  } else {
    const chunks = String(ctx.options.ranges ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!chunks.length) throw new Error('Informe pelo menos um intervalo, ex: 1-3, 4-8.');
    for (const chunk of chunks) {
      groups.push({ label: chunk.replace(/\s+/g, ''), indices: parsePageRange(chunk, pageCount) });
    }
  }

  const outputs: OutputFile[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    ctx.onProgress(i / groups.length, `Gerando parte ${i + 1}/${groups.length}`);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(doc, groups[i].indices);
    pages.forEach((page) => out.addPage(page));
    const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
    outputs.push({
      name: suffixName(source.name, `paginas-${groups[i].label}`),
      blob,
      pages: groups[i].indices.length,
    });
    await yieldToBrowser();
  }

  ctx.onProgress(1);
  return {
    files: outputs,
    inputBytes: source.size,
    outputBytes: outputs.reduce((sum, o) => sum + o.blob.size, 0),
    notes,
  };
}

export type PagePlanItem = { i: number; r: number };

const PLAN_SUFFIX: Record<string, string> = {
  organize: 'organizado',
  remove: 'sem-paginas',
  keep: 'extraido',
  rotate: 'girado',
};

/**
 * Motor das quatro ferramentas que usam a grade de miniaturas. A grade publica
 * um plano com as páginas que ficam, em que ordem e com qual rotação. Aqui só
 * remontamos o documento seguindo esse plano.
 */
async function applyPlan(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pageCount = doc.getPageCount();
  const board = String(ctx.options.board ?? 'organize');

  let plan: PagePlanItem[];
  try {
    plan = JSON.parse(String(ctx.options.plan ?? '[]'));
  } catch {
    throw new Error('Não foi possível ler a seleção de páginas.');
  }
  plan = plan.filter((item) => Number.isInteger(item.i) && item.i >= 0 && item.i < pageCount);

  if (!plan.length) {
    throw new Error(
      board === 'keep'
        ? 'Clique nas páginas que você quer guardar.'
        : 'O documento ficaria sem nenhuma página.',
    );
  }
  if (board === 'remove' && plan.length === pageCount) {
    throw new Error('Clique nas páginas que devem sair.');
  }
  if (board === 'rotate' && plan.every((item) => !item.r)) {
    throw new Error('Clique numa página para girá-la.');
  }

  ctx.onProgress(0.4, 'Remontando o documento');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    doc,
    plan.map((item) => item.i),
  );
  pages.forEach((page, index) => {
    const total = page.getRotation().angle + (plan[index].r ?? 0);
    page.setRotation(degrees(((total % 360) + 360) % 360));
    out.addPage(page);
  });

  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);

  const removed = pageCount - plan.length;
  const rotated = plan.filter((item) => item.r).length;
  const notes: string[] = [];
  if (board === 'keep') {
    notes.push(`${plan.length} de ${pageCount} páginas no arquivo novo.`);
  } else if (removed > 0) {
    notes.push(`${removed} página${removed > 1 ? 's' : ''} removida${removed > 1 ? 's' : ''}.`);
  }
  if (rotated > 0) notes.push(`${rotated} página${rotated > 1 ? 's' : ''} girada${rotated > 1 ? 's' : ''}.`);

  return {
    files: [
      { name: suffixName(source.name, PLAN_SUFFIX[board] ?? 'editado'), blob, pages: plan.length },
    ],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  };
}

async function watermark(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, degrees, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const text = sanitizeText(String(ctx.options.text ?? '').trim());
  if (!text) throw new Error('Escreva o texto da marca d’água.');

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = Number(ctx.options.size ?? 48);
  const opacity = Math.min(1, Math.max(0.02, Number(ctx.options.opacity ?? 0.18)));
  const angle = Number(ctx.options.angle ?? 45);
  const tile = ctx.options.tile === true || ctx.options.tile === 'true';
  const shade = Number(ctx.options.shade ?? 0.4);
  const color = rgb(shade, shade, shade);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    ctx.onProgress(i / pages.length, `Aplicando na página ${i + 1}/${pages.length}`);
    const page = pages[i];
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);

    if (tile) {
      const stepX = textWidth + size * 2;
      const stepY = size * 4;
      for (let y = -height; y < height * 2; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) {
          page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(angle) });
        }
      }
    } else {
      const radians = (angle * Math.PI) / 180;
      page.drawText(text, {
        x: width / 2 - (Math.cos(radians) * textWidth) / 2,
        y: height / 2 - (Math.sin(radians) * textWidth) / 2 - size / 2,
        size,
        font,
        color,
        opacity,
        rotate: degrees(angle),
      });
    }
    if (i % 12 === 11) await yieldToBrowser();
  }

  const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'marca-dagua'), blob, pages: pages.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

async function pdfToImages(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const dpi = Number(ctx.options.dpi ?? 150);
  const format = String(ctx.options.format ?? 'jpeg');
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const quality = format === 'png' ? undefined : Number(ctx.options.quality ?? 0.85);
  const canvas = document.createElement('canvas');
  const padWidth = String(doc.numPages).length;

  const images: { name: string; blob: Blob }[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Renderizando página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    await renderPageToCanvas(page, dpi, canvas);
    images.push({
      name: `${source.name.replace(/\.[^.]+$/, '')}-${String(i).padStart(padWidth, '0')}.${ext}`,
      blob: await canvasToBlob(canvas, mime, quality),
    });
    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  if (images.length === 1) {
    ctx.onProgress(1);
    return { files: images, inputBytes: source.size, outputBytes: images[0].blob.size, notes: [] };
  }

  ctx.onProgress(0.95, 'Compactando em .zip');
  const zip = await zipFiles(images);
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'zip'), blob: zip, pages: images.length }],
    inputBytes: source.size,
    outputBytes: zip.size,
    notes: [`${images.length} imagens a ${dpi} DPI.`],
  };
}

async function imagesToPdf(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  const margem = mmParaPt(Number(ctx.options.margemMm ?? 0));
  const ajuste = String(ctx.options.ajuste ?? 'proporcao') as Ajuste;
  let inputBytes = 0;

  for (let i = 0; i < ctx.files.length; i += 1) {
    const source = ctx.files[i];
    inputBytes += source.size;
    ctx.onProgress(i / ctx.files.length, `Convertendo ${source.name}`);

    const bitmap = await createImageBitmap(new Blob([copy(source.bytes)], { type: source.type }));
    const pagina = tamanhoDaPagina(ctx.options, bitmap.width, bitmap.height);

    await desenharPaginaDeImagem(out, canvas, bitmap, pagina, margem, ajuste);
    bitmap.close();
    await respirar(ctx);
  }

  const name = String(ctx.options.filename || 'imagens').replace(/[\\/:*?"<>|]/g, '') || 'imagens';
  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: `${name}.pdf`, blob, pages: out.getPageCount() }],
    inputBytes,
    outputBytes: blob.size,
    notes: [],
  };
}

async function stripMetadata(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const epoch = new Date(0);

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('');
  doc.setCreator('');
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);

  ctx.onProgress(0.6, 'Reescrevendo o documento');
  const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'limpo'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Autor, título, produtor e datas de criação foram zerados.'],
  };
}

async function protect(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const password = String(ctx.options.password ?? '');
  if (password.length < 4) throw new Error('Use uma senha de pelo menos 4 caracteres.');

  const doc = await openWithPdfLib(source.bytes, source.senha);
  ctx.onProgress(0.4, 'Criptografando');

  const allow = (key: string) => ctx.options[key] === true || ctx.options[key] === 'true';
  doc.encrypt({
    userPassword: password,
    // Senha de dono distinta e aleatória: sem ela, quem abre com a senha de
    // usuário teria acesso total e as permissões não valeriam nada.
    ownerPassword: `dono-${crypto.randomUUID()}`,
    permissions: {
      printing: allow('printing') ? 'highResolution' : false,
      copying: allow('copying'),
      modifying: allow('modifying'),
      annotating: allow('modifying'),
      fillingForms: allow('modifying'),
      documentAssembly: allow('modifying'),
      contentAccessibility: true,
    },
  });

  // Object streams não convivem bem com criptografia, então gravamos sem eles.
  const blob = toPdfBlob(await doc.save({ useObjectStreams: false }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'protegido'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Guarde a senha: sem ela nem nós conseguimos reabrir o arquivo.'],
  };
}

async function unlock(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const password = String(ctx.options.password ?? '');

  let doc;
  let unlockedWithoutPassword = false;

  if (!password) {
    try {
      doc = await openWithPdfLib(source.bytes, source.senha);
      unlockedWithoutPassword = true;
    } catch (error) {
      if (isPasswordError(error)) {
        throw new Error('Este PDF exige senha de abertura para ser lido. Digite a senha no campo para continuar.');
      }
      throw error;
    }
  } else {
    try {
      doc = await openWithPdfLib(source.bytes, password);
    } catch (error) {
      if (isPasswordError(error)) throw new Error('Senha incorreta para este arquivo.');
      throw error;
    }
  }

  ctx.onProgress(0.5, 'Removendo a proteção');
  const { PDFDocument } = await loadPdfLib();
  const cleanDoc = await PDFDocument.create();
  const pages = await cleanDoc.copyPages(doc, doc.getPageIndices());
  pages.forEach((page) => cleanDoc.addPage(page));

  const blob = toPdfBlob(await cleanDoc.save({ useObjectStreams: true }));
  ctx.onProgress(1);

  const noteMessage = unlockedWithoutPassword
    ? 'Proteção de permissões/impressão removida com sucesso (sem necessidade de digitar senha).'
    : 'Senha removida com sucesso. O arquivo gerado abre sem senha.';

  return {
    files: [{ name: suffixName(source.name, 'desbloqueado'), blob, pages: cleanDoc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [noteMessage],
  };
}

async function crop(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pct = (key: string) => Math.min(45, Math.max(0, Number(ctx.options[key] ?? 0))) / 100;
  const [top, right, bottom, left] = [pct('top'), pct('right'), pct('bottom'), pct('left')];
  if (top + bottom === 0 && left + right === 0) throw new Error('Defina ao menos uma margem para cortar.');

  const pages = doc.getPages();
  pages.forEach((page) => {
    const box = page.getCropBox();
    page.setCropBox(
      box.x + box.width * left,
      box.y + box.height * bottom,
      box.width * (1 - left - right),
      box.height * (1 - top - bottom),
    );
  });

  ctx.onProgress(0.8, 'Aplicando o corte');
  const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'cortado'), blob, pages: pages.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['O corte ajusta a área visível (CropBox); o conteúdo original continua no arquivo.'],
  };
}

const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3: [841.89, 1190.55],
} as const;

async function resize(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const target = String(ctx.options.target ?? 'a4');
  const factor = Math.max(0.1, Number(ctx.options.scale ?? 100) / 100);

  const out = await PDFDocument.create();
  const sourcePages = doc.getPages();
  const embedded = await out.embedPages(sourcePages);

  for (let i = 0; i < embedded.length; i += 1) {
    ctx.onProgress(i / embedded.length, `Página ${i + 1}/${embedded.length}`);
    const item = embedded[i];

    if (target === 'scale') {
      const page = out.addPage([item.width * factor, item.height * factor]);
      page.drawPage(item, { x: 0, y: 0, xScale: factor, yScale: factor });
      continue;
    }

    const medida =
      target === 'personalizado'
        ? {
            largura: Math.min(Math.max(Number(ctx.options.larguraMm) || 210, 10), 2000),
            altura: Math.min(Math.max(Number(ctx.options.alturaMm) || 297, 10), 2000),
          }
        : (FORMATOS_MM[target as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4);
    const w = mmParaPt(medida.largura);
    const h = mmParaPt(medida.altura);

    // Mantemos a orientação de cada página original.
    const landscape = item.width > item.height;
    const pageW = landscape ? h : w;
    const pageH = landscape ? w : h;
    const page = out.addPage([pageW, pageH]);
    const ratio = Math.min(pageW / item.width, pageH / item.height);
    page.drawPage(item, {
      x: (pageW - item.width * ratio) / 2,
      y: (pageH - item.height * ratio) / 2,
      xScale: ratio,
      yScale: ratio,
    });
    if (i % 20 === 19) await yieldToBrowser();
  }

  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'redimensionado'), blob, pages: embedded.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

async function nUp(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const perSheet = Number(ctx.options.perSheet ?? 2) === 4 ? 4 : 2;
  // Espaçamento é o vão ENTRE as páginas. Margem é a sobra na beirada da folha.
  // Antes os dois eram a mesma coisa, e o resultado comia alguns milímetros de
  // cada lado sem ninguém pedir. O PDF não precisa de margem de segurança: quem
  // cuida disso é a impressora, na opção de ajustar a área impressa.
  const gap = mmParaPt(Math.min(Math.max(Number(ctx.options.espacamentoMm ?? 0), 0), 30));
  const margem = mmParaPt(Math.min(Math.max(Number(ctx.options.margemMm ?? 0), 0), 30));
  const border = ctx.options.border === true || ctx.options.border === 'true';

  const out = await PDFDocument.create();
  const embedded = await out.embedPages(doc.getPages());
  const [a4w, a4h] = PAGE_SIZES.a4;
  // 2 por folha = A4 deitada com 2 colunas; 4 por folha = A4 em pé, grade 2x2.
  const sheetW = perSheet === 2 ? a4h : a4w;
  const sheetH = perSheet === 2 ? a4w : a4h;
  const cols = 2;
  const rows = perSheet === 2 ? 1 : 2;
  const cellW = (sheetW - margem * 2 - gap * (cols - 1)) / cols;
  const cellH = (sheetH - margem * 2 - gap * (rows - 1)) / rows;

  for (let start = 0; start < embedded.length; start += perSheet) {
    ctx.onProgress(start / embedded.length, `Folha ${Math.floor(start / perSheet) + 1}`);
    const sheet = out.addPage([sheetW, sheetH]);
    for (let slot = 0; slot < perSheet && start + slot < embedded.length; slot += 1) {
      const item = embedded[start + slot];
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const cellX = margem + col * (cellW + gap);
      const cellY = sheetH - margem - (row + 1) * cellH - row * gap;
      const ratio = Math.min(cellW / item.width, cellH / item.height);
      const w = item.width * ratio;
      const h = item.height * ratio;
      sheet.drawPage(item, {
        x: cellX + (cellW - w) / 2,
        y: cellY + (cellH - h) / 2,
        xScale: ratio,
        yScale: ratio,
      });
      if (border) {
        sheet.drawRectangle({
          x: cellX,
          y: cellY,
          width: cellW,
          height: cellH,
          borderColor: rgb(0.8, 0.8, 0.85),
          borderWidth: 0.7,
        });
      }
    }
    await yieldToBrowser();
  }

  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, `${perSheet}-por-folha`), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`${embedded.length} páginas em ${out.getPageCount()} folhas.`],
  };
}

async function pdfToText(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const separators = ctx.options.separators !== false && ctx.options.separators !== 'false';
  const chunks: string[] = [];
  let foundText = false;

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Extraindo texto da página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
      else if (!item.str.endsWith(' ')) text += ' ';
    }
    const clean = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (clean) foundText = true;
    chunks.push(separators ? `--- Página ${i} ---\n${clean}` : clean);
    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  const body = chunks.join('\n\n');
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'txt'), blob, pages: doc.numPages }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: foundText
      ? []
      : ['Nenhum texto encontrado. Este PDF provavelmente é digitalizado e precisaria de OCR, que não fazemos.'],
  };
}

/** Converte o formato bruto de imagem do pdf.js para um canvas. */
function drawPdfImage(
  image: { width: number; height: number; kind?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: CanvasImageSource },
  canvas: HTMLCanvasElement,
): boolean {
  const { width, height } = image;
  if (!width || !height) return false;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  if (image.bitmap) {
    ctx.drawImage(image.bitmap, 0, 0);
    return true;
  }
  if (!image.data) return false;

  const target = ctx.createImageData(width, height);
  const out = target.data;
  const data = image.data;

  if (image.kind === 3) {
    out.set(data.subarray(0, out.length));
  } else if (image.kind === 2) {
    for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
      out[q] = data[p];
      out[q + 1] = data[p + 1];
      out[q + 2] = data[p + 2];
      out[q + 3] = 255;
    }
  } else if (image.kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const q = (y * width + x) * 4;
        out[q] = value;
        out[q + 1] = value;
        out[q + 2] = value;
        out[q + 3] = 255;
      }
    }
  } else {
    return false;
  }

  ctx.putImageData(target, 0, 0);
  return true;
}

async function extractImages(ctx: RunContext): Promise<RunResult> {
  const pdfjs = await loadPdfJs();
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const minSize = Number(ctx.options.minSize ?? 64);
  const format = String(ctx.options.format ?? 'png');
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  const canvas = document.createElement('canvas');
  const scratch = document.createElement('canvas');
  const seen = new Set<string>();
  const images: { name: string; blob: Blob }[] = [];
  let skipped = 0;

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Vasculhando a página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    // O pdf.js só materializa os XObjects de imagem quando a página é
    // rasterizada. Sem esta renderização descartável em miniatura, o
    // objs.get() abaixo espera por um objeto que nunca chega.
    await renderPageToCanvas(page, 12, scratch);
    const ops = await page.getOperatorList();

    for (let op = 0; op < ops.fnArray.length; op += 1) {
      const isXObject = ops.fnArray[op] === pdfjs.OPS.paintImageXObject;
      const isInline = ops.fnArray[op] === pdfjs.OPS.paintInlineImageXObject;
      if (!isXObject && !isInline) continue;

      try {
        const arg = ops.argsArray[op][0];
        let image;
        if (isInline) {
          image = arg;
        } else {
          // Imagens repetidas em várias páginas vivem em commonObjs; as
          // exclusivas da página, em objs. Pedir na loja errada trava.
          const id = String(arg);
          const store = page.commonObjs.has(id) ? page.commonObjs : page.objs;
          // Rede de segurança: um objeto que nunca resolve não pode travar a ferramenta.
          image = await Promise.race([
            new Promise((resolve) => store.get(id, resolve)),
            new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
        }
        if (!image || image.width < minSize || image.height < minSize) {
          skipped += 1;
          continue;
        }
        if (!drawPdfImage(image, canvas)) {
          skipped += 1;
          continue;
        }

        const blob = await canvasToBlob(canvas, mime, format === 'jpeg' ? 0.9 : undefined);
        // A mesma imagem costuma ser referenciada por várias páginas com ids
        // diferentes; dimensões + tamanho do arquivo separam as repetições.
        const fingerprint = `${image.width}x${image.height}:${blob.size}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        images.push({
          name: `${source.name.replace(/\.[^.]+$/, '')}-img-${String(images.length + 1).padStart(3, '0')}.${ext}`,
          blob,
        });
      } catch {
        skipped += 1;
      }
      await respirar(ctx);
    }
    page.cleanup();
  }
  await doc.destroy();

  if (!images.length) {
    throw new Error(
      skipped > 0
        ? 'As imagens deste PDF estão em formatos que não conseguimos extrair.'
        : 'Nenhuma imagem encontrada neste PDF.',
    );
  }

  const notes = skipped > 0 ? [`${skipped} imagem(ns) ignorada(s) por serem pequenas ou ilegíveis.`] : [];
  if (images.length === 1) {
    ctx.onProgress(1);
    return { files: images, inputBytes: source.size, outputBytes: images[0].blob.size, notes };
  }

  ctx.onProgress(0.95, 'Compactando em .zip');
  const zip = await zipFiles(images);
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'zip'), blob: zip, pages: images.length }],
    inputBytes: source.size,
    outputBytes: zip.size,
    notes: [`${images.length} imagens extraídas.`, ...notes],
  };
}

export type ElementoEditor = {
  id: string;
  tipo: 'texto' | 'imagem' | 'retangulo';
  pagina: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  texto?: string;
  tamanho?: number;
  cor?: string;
  dataUrl?: string;
  /** Marca-texto precisa deixar ler o que está embaixo. */
  opacidade?: number;
};

async function edit(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);

  let elementos: ElementoEditor[];
  try {
    elementos = JSON.parse(String(ctx.options.elementos ?? '[]'));
  } catch {
    throw new Error('Não foi possível ler as edições.');
  }
  if (!elementos.length) throw new Error('Adicione ao menos um item ao documento antes de salvar.');

  const paginas = doc.getPages();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < elementos.length; i += 1) {
    const elemento = elementos[i];
    ctx.onProgress(i / elementos.length, `Aplicando ${i + 1} de ${elementos.length}`);

    const pagina = paginas[elemento.pagina];
    if (!pagina) continue;

    const { width: larguraPagina, height: alturaPagina } = pagina.getSize();
    const caixa = paraCoordenadasPdf(elemento, larguraPagina, alturaPagina);
    const cor = hexParaRgb(elemento.cor ?? '#000000');

    if (elemento.tipo === 'retangulo') {
      pagina.drawRectangle({
        x: caixa.x,
        y: caixa.y,
        width: caixa.largura,
        height: caixa.altura,
        color: rgb(cor.r, cor.g, cor.b),
        opacity: elemento.opacidade ?? 1,
      });
      continue;
    }

    if (elemento.tipo === 'imagem' && elemento.dataUrl) {
      const png = await (await fetch(elemento.dataUrl)).arrayBuffer();
      const imagem = await doc.embedPng(png);
      pagina.drawImage(imagem, {
        x: caixa.x,
        y: caixa.y,
        width: caixa.largura,
        height: caixa.altura,
      });
      continue;
    }

    if (elemento.tipo === 'texto') {
      const texto = sanitizeText(String(elemento.texto ?? ''));
      if (!texto.trim()) continue;
      const tamanho = Math.max(4, Number(elemento.tamanho ?? 14));
      const usada = elemento.cor === 'negrito' ? fonteNegrito : fonte;
      pagina.drawText(texto, {
        x: caixa.x,
        // drawText ancora na linha de base da primeira linha, não no topo da caixa.
        y: caixa.y + caixa.altura - tamanho,
        size: tamanho,
        font: usada,
        color: rgb(cor.r, cor.g, cor.b),
        lineHeight: tamanho * 1.2,
        maxWidth: caixa.largura,
      });
    }

    await respirar(ctx);
  }

  const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  const sufixo = ctx.options.editor === 'assinatura' ? 'assinado' : 'editado';
  return {
    files: [{ name: suffixName(source.name, sufixo), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`${elementos.length} ${elementos.length === 1 ? 'item aplicado' : 'itens aplicados'}.`],
  };
}

async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.blob);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/* -------------------------------------------------------------------------- */

export const OPERATIONS = {
  compress,
  merge,
  split,
  watermark,
  'apply-plan': applyPlan,
  'pdf-to-images': pdfToImages,
  'images-to-pdf': imagesToPdf,
  'strip-metadata': stripMetadata,
  protect,
  unlock,
  crop,
  resize,
  'n-up': nUp,
  'pdf-to-text': pdfToText,
  'extract-images': extractImages,
  edit,
} satisfies Record<string, (ctx: RunContext) => Promise<RunResult>>;

export type OperationId = keyof typeof OPERATIONS;

export async function runOperation(id: OperationId, ctx: RunContext): Promise<RunResult> {
  const operation = OPERATIONS[id];
  if (!operation) throw new Error(`Ferramenta desconhecida: ${id}`);
  return operation(ctx);
}

export { zipFiles };
