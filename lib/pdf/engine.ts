'use client';

import { loadPdfJs, loadPdfLib } from './lazy';
import { abortarSePreciso, LIMITES, pareceMesmoDocx, pareceMesmoImagem, pareceMesmoPdf } from './guards';
import { hexParaRgb, paraCoordenadasPdf } from './layout';
import { createOcrWorker, type OcrLanguage } from './ocr';
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
  /** Comparativo de tamanho: só faz sentido onde encolher é o objetivo. */
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
/**
 * Formas da mesma senha que valem tentar antes de dizer que está errada.
 *
 * Duas armadilhas reais, nenhuma delas adivinhação:
 *
 * - Espaço sobrando. Senha copiada de e-mail ou de PDF quase sempre traz um.
 * - Acento em forma diferente. "coração" pode estar composto (NFC, o padrão
 *   no Windows) ou decomposto (NFD, o padrão no macOS). São bytes distintos,
 *   e o PDF guarda o hash de um só. Quem criou o arquivo num Mac e digita a
 *   senha no Windows erra sem ter errado nada.
 *
 * São variações da senha que a pessoa informou, não tentativas de descobrir
 * senha nenhuma.
 */
function variantesDeSenha(senha: string): string[] {
  if (!senha) return [''];
  const bases = [senha, senha.trim()];
  const todas = bases.flatMap((base) => [base, base.normalize('NFC'), base.normalize('NFD')]);
  return [...new Set(todas)];
}

async function openWithPdfLib(bytes: ArrayBuffer, password = '') {
  const { PDFDocument } = await loadPdfLib();
  let ultimoErro: unknown = null;
  for (const tentativa of variantesDeSenha(password)) {
    try {
      return await PDFDocument.load(copy(bytes), { password: tentativa, updateMetadata: false });
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

async function openWithPdfJs(bytes: ArrayBuffer, password?: string) {
  const pdfjs = await loadPdfJs();
  const abrir = (senha: string) =>
    pdfjs.getDocument({
      data: copy(bytes),
      useSystemFonts: true,
      isEvalSupported: false,
      ...(senha ? { password: senha } : {}),
    }).promise;

  let ultimoErro: unknown = null;
  for (const tentativa of variantesDeSenha(password ?? '')) {
    try {
      return await abrir(tentativa);
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

/**
 * Grava o documento reaplicando a senha de abertura do original.
 *
 * Abrir um PDF protegido e salvar devolve um arquivo sem proteção nenhuma.
 * Quem pôs senha num contrato não espera que comprimir ou girar as páginas
 * publique o conteúdo, então a senha volta no resultado. Para tirar a senha de
 * propósito existe a ferramenta de desbloqueio.
 *
 * `encrypt` não convive com object streams, então esse caminho grava sem eles.
 */
async function salvarPdf(doc: PdfDoc, senha?: string): Promise<Blob> {
  if (!senha) return toPdfBlob(await doc.save({ useObjectStreams: true }));
  doc.encrypt({ userPassword: senha, ownerPassword: senha });
  return toPdfBlob(await doc.save({ useObjectStreams: false }));
}

/** Numa operação de vários arquivos, um protegido já protege o resultado. */
function senhaDaFila(files: LoadedFile[]): string | undefined {
  return files.find((file) => file.senha)?.senha;
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

  const nomeMinusculo = base.name.toLowerCase();
  // .docx, .xlsx e .pptx sao o mesmo pacote zip de XML por dentro.
  const ehOfficePeloNome = /\.(docx|xlsx|pptx)$/.test(nomeMinusculo);
  const ehTxtPeloNome = nomeMinusculo.endsWith('.txt');

  if (!base.type.startsWith('image/') && !nomeMinusculo.endsWith('.pdf') && !ehOfficePeloNome && !ehTxtPeloNome) {
    return { ...base, error: 'Formato não suportado.' };
  }

  // Texto puro não tem assinatura para conferir nem estrutura para inspecionar.
  if (ehTxtPeloNome) return { ...base, pageCount: null };

  // O conteúdo manda, não a extensão nem o MIME informado pelo sistema: os dois
  // são só rótulos e podem estar mentindo. Quem não passa daqui não chega ao parser.
  if (base.type.startsWith('image/')) {
    if (!pareceMesmoImagem(bytes)) {
      return { ...base, error: 'O conteúdo não corresponde a uma imagem JPG, PNG ou WebP.' };
    }
    return { ...base, pageCount: 1, thumbnail: await imageThumbnail(file) };
  }

  if (ehOfficePeloNome) {
    if (!pareceMesmoDocx(bytes)) {
      return { ...base, error: `Este arquivo tem extensão ${base.name.split('.').pop()} mas o conteúdo não é um documento do Office válido.` };
    }
    return { ...base, pageCount: null };
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

/**
 * Pinta um retângulo branco atrás de tudo que já existe na página.
 *
 * Muitos PDFs não desenham fundo nenhum: contam com o leitor mostrando papel
 * branco por baixo. Quando a página tem grupo de transparência, esse "papel"
 * some ao juntar, e o resultado aparece cinza, quadriculado ou preto, dependendo
 * do leitor e da impressora.
 *
 * A pintura entra por `wrapContentStreams`, que coloca o retângulo ANTES do
 * conteúdo original em vez de por cima. Isso importa: `drawRectangle` desenharia
 * em cima e apagaria a página. E, diferente de reembrulhar a página num
 * XObject, este caminho preserva links, anotações e campos de formulário.
 */
function pintarFundoBranco(destino: PdfDoc, pagina: ReturnType<PdfDoc['addPage']>): void {
  // A caixa nem sempre começa em zero: há PDFs com MediaBox deslocado.
  const caixa = pagina.getMediaBox();
  const fundo = destino.context.register(
    destino.context.flateStream(`q 1 1 1 rg ${caixa.x} ${caixa.y} ${caixa.width} ${caixa.height} re f Q\n`),
  );
  const vazio = destino.context.register(destino.context.flateStream(''));
  pagina.node.wrapContentStreams(fundo, vazio);
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
  return { files: outputs, inputBytes, outputBytes, notes, highlightSavings: true };
}

async function merge(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  let inputBytes = 0;

  const canvas = document.createElement('canvas');
  const formatoImagem = String(ctx.options.formatoImagem ?? 'a4');
  const fundoBranco = ctx.options.fundoBranco !== false && ctx.options.fundoBranco !== 'false';
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
      pages.forEach((page) => {
        out.addPage(page);
        if (fundoBranco) pintarFundoBranco(out, page);
      });
    }

    await respirar(ctx);
  }

  const name = String(ctx.options.filename || 'documento-unido').replace(/[\\/:*?"<>|]/g, '') || 'documento-unido';
  const blob = await salvarPdf(out, senhaDaFila(ctx.files));
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
    const blob = await salvarPdf(out, source.senha);
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

  const blob = await salvarPdf(out, source.senha);
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

  const blob = await salvarPdf(doc, source.senha);
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
  const blob = await salvarPdf(doc, source.senha);
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

/**
 * Remove a proteção de um PDF.
 *
 * Não existe um caminho que sirva para todo arquivo, então são três, do que
 * preserva mais para o que preserva menos:
 *
 * 1. Copiar as páginas para um documento novo. Sai limpo, sem sobra nenhuma da
 *    estrutura de criptografia.
 * 2. Reserializar o documento como o pdf-lib o entendeu. `copyPages` precisa
 *    percorrer e clonar o grafo inteiro de objetos e quebra quando algum ramo
 *    não decifrou; salvar direto só reescreve o que já foi lido, e é o que
 *    resolve boa parte dos arquivos que morriam com erro de tipo do pdf-lib.
 * 3. Redesenhar as páginas como imagem, usando o pdf.js. É o único caminho
 *    quando o pdf-lib entende a criptografia pela metade, e custa o texto:
 *    o resultado vira imagem e deixa de ser pesquisável.
 */
async function unlock(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const senha = String(ctx.options.password ?? '') || source.senha || '';

  const finalizar = (blob: Blob, paginas: number, notes: string[]): RunResult => ({
    files: [{ name: suffixName(source.name, 'desbloqueado'), blob, pages: paginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  });

  const semSenha = senha.length === 0;
  const comoAbriu = semSenha
    ? 'Não foi preciso digitar senha: o arquivo só tinha restrições de permissão.'
    : 'Senha removida. O arquivo gerado abre sem pedir nada.';

  let doc: PdfDoc | null = null;
  let erroAoAbrir: unknown = null;
  try {
    doc = await openWithPdfLib(source.bytes, senha);
  } catch (error) {
    erroAoAbrir = error;
  }

  if (doc) {
    const { PDFDocument } = await loadPdfLib();
    const paginas = doc.getPageCount();

    // 1. Documento novo, só com as páginas.
    try {
      ctx.onProgress(0.4, 'Removendo a proteção');
      const limpo = await PDFDocument.create();
      const copiadas = await limpo.copyPages(doc, doc.getPageIndices());
      copiadas.forEach((pagina) => limpo.addPage(pagina));
      const blob = toPdfBlob(await limpo.save({ useObjectStreams: true }));
      ctx.onProgress(1);
      return finalizar(blob, limpo.getPageCount(), [comoAbriu]);
    } catch {
      /* grafo incompleto: tenta reescrever sem clonar */
    }

    // 2. Reserializar o que o pdf-lib leu.
    try {
      ctx.onProgress(0.6, 'Reescrevendo o arquivo');
      const blob = toPdfBlob(await doc.save({ useObjectStreams: false }));
      ctx.onProgress(1);
      return finalizar(blob, paginas, [
        comoAbriu,
        'Este arquivo não aceitou a reconstrução página a página, então foi reescrito inteiro. Confira se abriu como esperado.',
      ]);
    } catch {
      /* nem reescrever deu: sobra o caminho pelo pdf.js */
    }
  }

  // 3. Redesenhar pelo pdf.js, que decifra formatos que o pdf-lib não cobre.
  let docJs;
  try {
    docJs = await openWithPdfJs(source.bytes, senha || undefined);
  } catch (error) {
    if (isPasswordError(error) || (erroAoAbrir && isPasswordError(erroAoAbrir))) {
      throw new Error(
        semSenha
          ? 'Este PDF exige a senha de abertura. Digite-a no campo acima para continuar.'
          : 'Senha incorreta para este arquivo.',
      );
    }
    throw new Error('Não foi possível ler este PDF: a criptografia dele não é reconhecida.');
  }

  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= docJs.numPages; i += 1) {
    ctx.onProgress((i - 1) / docJs.numPages, `Redesenhando a página ${i} de ${docJs.numPages}`);
    const page = await docJs.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, 150, canvas);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });
    page.cleanup();
    await respirar(ctx);
  }
  await docJs.destroy();

  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return finalizar(blob, out.getPageCount(), [
    comoAbriu,
    'A estrutura interna deste PDF não sobreviveu à remoção da proteção, então as páginas foram redesenhadas como imagem. O documento abre e imprime normalmente, mas o texto deixou de ser selecionável e pesquisável.',
  ]);
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
  const blob = await salvarPdf(doc, source.senha);
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

  const blob = await salvarPdf(out, source.senha);
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

  const blob = await salvarPdf(out, source.senha);
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
      : ['Nenhum texto encontrado. Este PDF provavelmente é digitalizado: rode a ferramenta de OCR antes.'],
  };
}

/**
 * OCR: reconhece o texto de um PDF digitalizado e devolve um PDF pesquisável.
 *
 * Cada página vira imagem (o visual não muda) e o texto reconhecido é
 * desenhado por cima na mesma posição, com renderMode invisível. O resultado
 * parece igual ao original, mas dá para selecionar, copiar e pesquisar.
 */
async function ocr(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const lang = String(ctx.options.language ?? 'por+eng') as OcrLanguage;
  const { PDFDocument, StandardFonts, TextRenderingMode } = await loadPdfLib();
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const totalPaginas = doc.numPages;
  const out = await PDFDocument.create();
  const fonte = await out.embedFont(StandardFonts.Helvetica);
  const canvas = document.createElement('canvas');
  const dpi = 200;

  ctx.onProgress(0, 'Preparando o motor de OCR (a primeira vez baixa alguns megabytes)...');
  const worker = await createOcrWorker(lang);

  let somaConfianca = 0;
  let paginasComBaixaConfianca = 0;

  try {
    for (let i = 1; i <= totalPaginas; i += 1) {
      abortarSePreciso(ctx.signal);
      ctx.onProgress((i - 1) / totalPaginas, `Reconhecendo texto da página ${i}/${totalPaginas}`);

      const page = await doc.getPage(i);
      const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);
      page.cleanup();

      const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.85);
      const embutida = await out.embedJpg(await jpeg.arrayBuffer());
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: false, tsv: false });

      const novaPagina = out.addPage([widthPt, heightPt]);
      novaPagina.drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

      const escala = 72 / dpi;
      for (const word of data.words) {
        const texto = sanitizeText(word.text ?? '');
        if (!texto.trim()) continue;
        const alturaPx = word.bbox.y1 - word.bbox.y0;
        const tamanho = Math.max(4, alturaPx * escala);
        novaPagina.drawText(texto, {
          x: word.bbox.x0 * escala,
          y: heightPt - word.bbox.y1 * escala,
          size: tamanho,
          font: fonte,
          renderMode: TextRenderingMode.Invisible,
        });
      }

      if (typeof data.confidence === 'number') {
        somaConfianca += data.confidence;
        if (data.confidence < 60) paginasComBaixaConfianca += 1;
      }

      await respirar(ctx);
    }
  } finally {
    await worker.terminate();
  }
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const confianca = totalPaginas ? Math.round(somaConfianca / totalPaginas) : 0;
  return {
    files: [{ name: suffixName(source.name, 'pesquisavel'), blob, pages: totalPaginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `Confiança média do reconhecimento: ${confianca}%.`,
      ...(paginasComBaixaConfianca > 0
        ? [`${paginasComBaixaConfianca} página(s) com baixa confiança — confira o texto selecionável.`]
        : []),
      'O texto reconhecido fica invisível sobre a imagem da página original: a aparência não muda, mas dá para selecionar, copiar e pesquisar.',
    ],
  };
}

const PAGE_NUMBER_MARGIN_PT = 24;

async function pageNumbers(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();
  const posicao = String(ctx.options.position ?? 'rodape-centro');
  const formato = String(ctx.options.format ?? 'numero');
  const inicioEm = Math.max(1, Math.round(Number(ctx.options.startAt ?? 1)));
  const tamanho = Math.max(6, Number(ctx.options.size ?? 11));
  const ultimoNumero = inicioEm + paginas.length - 1;

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Numerando página ${i + 1}/${paginas.length}`);
    const pagina = paginas[i];
    const { width, height } = pagina.getSize();
    const numero = inicioEm + i;
    const texto = formato === 'de-total' ? `Página ${numero} de ${ultimoNumero}` : String(numero);
    const largura = fonte.widthOfTextAtSize(texto, tamanho);

    const y = posicao.startsWith('rodape') ? PAGE_NUMBER_MARGIN_PT : height - PAGE_NUMBER_MARGIN_PT - tamanho;
    const x = posicao.endsWith('esquerda')
      ? PAGE_NUMBER_MARGIN_PT
      : posicao.endsWith('direita')
        ? width - PAGE_NUMBER_MARGIN_PT - largura
        : (width - largura) / 2;

    pagina.drawText(texto, { x, y, size: tamanho, font: fonte, color: rgb(0.4, 0.45, 0.42) });
    await respirar(ctx);
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'numerado'), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/**
 * Não conserta um PDF corrompido de verdade: só reconstrói a estrutura
 * interna (tabela de referências, objetos) do zero a partir do que consegue
 * ler. É o mesmo caminho que a compressão "sem perda" usa, exposto como
 * ferramenta própria porque resolve boa parte dos "meu PDF não abre".
 */
async function repair(ctx: RunContext): Promise<RunResult> {
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converte o texto embutido do PDF (o mesmo que "PDF para texto" extrai) num
 * .docx mínimo, montado à mão como zip de XML porque é isso que o formato é.
 * Só o texto atravessa: layout, colunas, imagens e tabelas do PDF original
 * não são preservados.
 */
async function pdfToWord(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const totalPaginas = doc.numPages;
  const paginasXml: string[] = [];
  let foundText = false;

  for (let i = 1; i <= totalPaginas; i += 1) {
    ctx.onProgress((i - 1) / totalPaginas, `Extraindo texto da página ${i}/${totalPaginas}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let texto = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      texto += item.str;
      if (item.hasEOL) texto += '\n';
      else if (!item.str.endsWith(' ')) texto += ' ';
    }
    const linhas = texto
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .split('\n');
    if (linhas.some((linha) => linha.trim())) foundText = true;

    const paragrafos = linhas.length
      ? linhas.map((linha) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(linha)}</w:t></w:r></w:p>`).join('')
      : '<w:p/>';
    const quebraDePagina = i < totalPaginas ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
    paginasXml.push(paragrafos + quebraDePagina);

    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paginasXml.join('')}<w:sectPr/></w:body></w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'docx'), blob, pages: totalPaginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Só o texto sai no .docx: layout, colunas, imagens e tabelas do PDF original não são preservados.',
      ...(foundText
        ? []
        : ['Nenhum texto encontrado. Este PDF provavelmente é digitalizado: rode a ferramenta de OCR antes.']),
    ],
  };
}

type ParagrafoDocx = { runs: { texto: string; negrito: boolean }[] };

function decodificarEntidadesXml(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Lê os parágrafos de um .docx com um parser XML mínimo, na unha, em vez de
 * DOMParser: essa API não existe fora do navegador, e este mesmo motor roda
 * em teste (Node). Cada <w:p> vira um item, cada <w:r> um run com o texto dos
 * <w:t>, os <w:tab/> e as quebras manuais de <w:br/>.
 */
function lerParagrafosDoXml(documentXml: string): ParagrafoDocx[] {
  const paragrafos: ParagrafoDocx[] = [];
  const reParagrafo = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let matchParagrafo: RegExpExecArray | null;
  while ((matchParagrafo = reParagrafo.exec(documentXml))) {
    // w:pPr guarda as propriedades do parágrafo (inclui a marca de fim de
    // parágrafo, que pode ter seu próprio rPr): tirar isso fora evita
    // confundir formatação do marcador com um run de texto de verdade.
    const corpo = matchParagrafo[1].replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g, '');
    const runs: { texto: string; negrito: boolean }[] = [];
    const reRun = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let matchRun: RegExpExecArray | null;
    while ((matchRun = reRun.exec(corpo))) {
      const runXml = matchRun[1];
      const rPr = runXml.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
      const tagNegrito = rPr.match(/<w:b\b[^>]*\/?>/)?.[0];
      const negrito = Boolean(tagNegrito) && !/w:val="(0|false)"/.test(tagNegrito!);

      let texto = '';
      const reConteudo = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
      let matchConteudo: RegExpExecArray | null;
      while ((matchConteudo = reConteudo.exec(runXml))) {
        if (matchConteudo[0].startsWith('<w:tab')) texto += '\t';
        else if (matchConteudo[0].startsWith('<w:br')) texto += '\n';
        else texto += decodificarEntidadesXml(matchConteudo[1] ?? '');
      }
      if (texto) runs.push({ texto, negrito });
    }
    paragrafos.push({ runs });
  }
  return paragrafos;
}

async function lerParagrafosDocx(bytes: ArrayBuffer): Promise<ParagrafoDocx[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Não encontramos word/document.xml dentro do arquivo: não parece ser um .docx válido.');
  }
  return lerParagrafosDoXml(documentXml);
}

/**
 * Desenha parágrafos de texto num PDF novo em A4, quebrando linha por largura
 * e abrindo página quando a margem de baixo é alcançada.
 *
 * A fonte é Helvetica, que só cobre Latin-1. Caractere fora disso quebraria o
 * `drawText`, então é trocado por "?" antes de entrar.
 */
async function pdfDeParagrafos(
  paragrafos: ParagrafoDocx[],
  tamanhoFonte: number,
): Promise<{ doc: PdfDoc; algumTexto: boolean }> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const [largura, altura] = PAGE_SIZES.a4;
  const margem = 56.7; // 20 mm
  const alturaLinha = tamanhoFonte * 1.4;
  const larguraUtil = largura - margem * 2;

  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

  let pagina = doc.addPage([largura, altura]);
  let y = altura - margem;
  let algumTexto = false;

  const novaPagina = () => {
    pagina = doc.addPage([largura, altura]);
    y = altura - margem;
  };

  for (const paragrafo of paragrafos) {
    if (!paragrafo.runs.length) {
      y -= alturaLinha;
      if (y < margem) novaPagina();
      continue;
    }

    let x = margem;
    for (const run of paragrafo.runs) {
      const fonteRun = run.negrito ? fonteNegrito : fonte;
      const linhas = sanitizeText(run.texto).replace(/\t/g, '    ').split('\n');
      for (let li = 0; li < linhas.length; li += 1) {
        for (const palavra of linhas[li].split(/\s+/).filter(Boolean)) {
          const larguraPalavra = fonteRun.widthOfTextAtSize(palavra, tamanhoFonte);
          const espaco = x > margem ? fonteRun.widthOfTextAtSize(' ', tamanhoFonte) : 0;
          if (x + espaco + larguraPalavra > margem + larguraUtil && x > margem) {
            x = margem;
            y -= alturaLinha;
            if (y < margem) novaPagina();
          } else {
            x += espaco;
          }
          pagina.drawText(palavra, { x, y, size: tamanhoFonte, font: fonteRun, color: rgb(0.06, 0.06, 0.06) });
          algumTexto = true;
          x += larguraPalavra;
        }
        if (li < linhas.length - 1) {
          x = margem;
          y -= alturaLinha;
          if (y < margem) novaPagina();
        }
      }
    }
    y -= alturaLinha;
    if (y < margem) novaPagina();
  }

  return { doc, algumTexto };
}

/**
 * Converte um .docx num PDF a partir do texto dos parágrafos. Só o texto
 * atravessa: layout, colunas, imagens e tabelas do original não são preservados.
 */
async function wordToPdf(ctx: RunContext): Promise<RunResult> {
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Só o texto entra no PDF: layout, colunas, imagens e tabelas do documento original não são preservados.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const paragrafos = await lerParagrafosDocx(source.bytes);
    const { doc, algumTexto } = await pdfDeParagrafos(paragrafos, 11);

    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    if (!algumTexto) notes.push(`${source.name}: não encontramos texto dentro do documento.`);
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}


/**
 * Lê uma planilha .xlsx.
 *
 * O texto das células não fica na planilha: os valores de texto vão todos para
 * sharedStrings.xml e a célula guarda só o índice (t="s"). Número, data e
 * fórmula ficam no próprio <v>, já calculados pelo Excel.
 */
async function lerPlanilha(bytes: ArrayBuffer): Promise<{ nome: string; linhas: string[][] }[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);

  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbook) {
    throw new Error('Não encontramos xl/workbook.xml: o arquivo não parece ser um .xlsx válido.');
  }

  const compartilhadas: string[] = [];
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (sharedXml) {
    for (const item of sharedXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? []) {
      // Uma célula com formatação vira vários <t>; juntamos todos.
      const pedacos = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificarEntidadesXml(m[1]));
      compartilhadas.push(pedacos.join(''));
    }
  }

  const nomes = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/g)].map((m) =>
    decodificarEntidadesXml(m[1]),
  );

  const planilhas: { nome: string; linhas: string[][] }[] = [];
  for (let i = 0; i < nomes.length; i += 1) {
    const folha = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)?.async('string');
    if (!folha) continue;

    const linhas: string[][] = [];
    for (const linhaXml of folha.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const celulas: string[] = [];
      for (const celula of linhaXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        // A referência (A1, B1...) diz a coluna: sem isso, uma célula vazia no
        // meio da linha desloca todo o resto para a esquerda.
        const coluna = celula.match(/r="([A-Z]+)\d+"/)?.[1];
        const indice = coluna
          ? [...coluna].reduce((soma, letra) => soma * 26 + (letra.charCodeAt(0) - 64), 0) - 1
          : celulas.length;

        const tipo = celula.match(/\bt="([^"]*)"/)?.[1];
        let valor = '';
        if (tipo === 'inlineStr') {
          valor = [...celula.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((m) => decodificarEntidadesXml(m[1]))
            .join('');
        } else {
          const bruto = celula.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
          if (bruto !== undefined) {
            valor = tipo === 's' ? (compartilhadas[Number(bruto)] ?? '') : decodificarEntidadesXml(bruto);
          }
        }

        while (celulas.length < indice) celulas.push('');
        celulas[indice] = valor;
      }
      linhas.push(celulas);
    }
    planilhas.push({ nome: nomes[i], linhas });
  }
  return planilhas;
}

/**
 * Planilha para PDF: cada aba vira uma seção, com as colunas em largura fixa.
 * Fórmula entra com o resultado que o Excel gravou; gráfico, imagem, cor e
 * célula mesclada não atravessam.
 */
async function excelToPdf(ctx: RunContext): Promise<RunResult> {
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Só o conteúdo das células atravessa. Gráficos, imagens, cores e células mescladas não são preservados.',
    'Fórmula entra com o último resultado que o Excel gravou no arquivo, porque nada é recalculado aqui.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const planilhas = await lerPlanilha(source.bytes);
    const paragrafos: ParagrafoDocx[] = [];
    let algumaCelula = false;

    for (const planilha of planilhas) {
      if (planilhas.length > 1) {
        paragrafos.push({ runs: [{ texto: planilha.nome, negrito: true }] });
        paragrafos.push({ runs: [] });
      }
      for (const linha of planilha.linhas) {
        if (linha.some((celula) => celula.trim())) algumaCelula = true;
        // Largura fixa por coluna mantém a leitura em tabela sem desenhar
        // grade; o corte evita que uma célula longa empurre o resto da linha.
        paragrafos.push({
          runs: [{ texto: linha.map((celula) => celula.slice(0, 28).padEnd(18)).join(' '), negrito: false }],
        });
      }
      paragrafos.push({ runs: [] });
    }

    const { doc } = await pdfDeParagrafos(paragrafos, 8);
    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    if (!algumaCelula) notes.push(`${source.name}: não encontramos células preenchidas.`);
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}

/**
 * Apresentação para PDF: uma seção por slide, com o texto na ordem em que
 * aparece no XML. Cada <a:p> é um parágrafo dentro de uma caixa de texto.
 */
async function powerpointToPdf(ctx: RunContext): Promise<RunResult> {
  const JSZip = (await import('jszip')).default;
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Sai o texto dos slides. Layout, imagens, cores, animações e notas do apresentador ficam de fora.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const zip = await JSZip.loadAsync(source.bytes);
    // slide2 antes de slide10: ordenação numérica, não alfabética.
    const arquivos = Object.keys(zip.files)
      .filter((nome) => /^ppt\/slides\/slide\d+\.xml$/.test(nome))
      .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));

    if (!arquivos.length) {
      throw new Error('Não encontramos slides dentro do arquivo: ele não parece ser um .pptx válido.');
    }

    const paragrafos: ParagrafoDocx[] = [];
    let algumTexto = false;

    for (let s = 0; s < arquivos.length; s += 1) {
      const xml = await zip.file(arquivos[s])!.async('string');
      paragrafos.push({ runs: [{ texto: `Slide ${s + 1}`, negrito: true }] });

      for (const bloco of xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? []) {
        const texto = [...bloco.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
          .map((m) => decodificarEntidadesXml(m[1]))
          .join('');
        if (!texto.trim()) continue;
        algumTexto = true;
        paragrafos.push({ runs: [{ texto, negrito: false }] });
      }

      paragrafos.push({ runs: [] });
      await respirar(ctx);
    }

    const { doc } = await pdfDeParagrafos(paragrafos, 11);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    notes.push(
      algumTexto
        ? `${source.name}: ${arquivos.length} slide(s) lidos.`
        : `${source.name}: os slides não têm texto, só imagens.`,
    );
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}

/** Cada linha do .txt vira um parágrafo; o resto é o mesmo do .docx. */
async function textToPdf(ctx: RunContext): Promise<RunResult> {
  const tamanhoFonte = Math.max(7, Math.min(18, Number(ctx.options.size ?? 11)));
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const texto = new TextDecoder('utf-8').decode(source.bytes).replace(/\r\n?/g, '\n');
    const paragrafos: ParagrafoDocx[] = texto
      .split('\n')
      .map((linha) => ({ runs: linha.trim() ? [{ texto: linha, negrito: false }] : [] }));

    const { doc } = await pdfDeParagrafos(paragrafos, tamanhoFonte);
    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });
  }

  ctx.onProgress(1);
  return {
    files: outputs,
    inputBytes,
    outputBytes,
    notes: ['O texto entra em Helvetica, com quebra de linha automática. Acentuação é preservada.'],
  };
}

/** Inverte a ordem das páginas. Útil em digitalização feita de trás para frente. */
async function reverse(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  const out = await PDFDocument.create();
  const indices = Array.from({ length: total }, (_, i) => total - 1 - i);
  const copiadas = await out.copyPages(origem, indices);
  for (const pagina of copiadas) {
    out.addPage(pagina);
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'invertido'), blob, pages: total }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/**
 * Intercala dois PDFs: página 1 do primeiro, página 1 do segundo, e assim por
 * diante. É o caso do escâner sem duplex, que gera um arquivo com as frentes e
 * outro com os versos — e os versos costumam sair na ordem contrária.
 */
async function interleave(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const [primeiro, segundo] = ctx.files;
  if (!segundo) throw new Error('Escolha dois arquivos: um com as frentes e outro com os versos.');

  const docA = await openWithPdfLib(primeiro.bytes, primeiro.senha);
  const docB = await openWithPdfLib(segundo.bytes, segundo.senha);
  const inverterSegundo = ctx.options.reverseSecond !== false;

  const out = await PDFDocument.create();
  const totalA = docA.getPageCount();
  const totalB = docB.getPageCount();

  const paginasA = await out.copyPages(docA, Array.from({ length: totalA }, (_, i) => i));
  const ordemB = Array.from({ length: totalB }, (_, i) => (inverterSegundo ? totalB - 1 - i : i));
  const paginasB = await out.copyPages(docB, ordemB);

  const maior = Math.max(totalA, totalB);
  for (let i = 0; i < maior; i += 1) {
    if (i < totalA) out.addPage(paginasA[i]);
    if (i < totalB) out.addPage(paginasB[i]);
    ctx.onProgress(i / maior, `Intercalando ${i + 1}/${maior}`);
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, senhaDaFila(ctx.files));
  const notes: string[] = [];
  if (totalA !== totalB) {
    notes.push(
      `Os arquivos têm ${totalA} e ${totalB} páginas. As que sobraram foram para o fim, na ordem em que estavam.`,
    );
  }

  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(primeiro.name, 'intercalado'), blob, pages: totalA + totalB }],
    inputBytes: primeiro.size + segundo.size,
    outputBytes: blob.size,
    notes,
  };
}

/**
 * Converte para tons de cinza rasterizando cada página. Isso descarta o texto
 * vetorial, então o resultado deixa de ser pesquisável — é o preço de garantir
 * que nada saia colorido na impressão.
 */
async function grayscale(ctx: RunContext): Promise<RunResult> {
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

/**
 * Achata formulários: o que estava preenchido vira conteúdo fixo da página e
 * deixa de ser editável. Serve para enviar um formulário sem que a outra ponta
 * mude os campos.
 */
async function flatten(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const notes: string[] = [];

  ctx.onProgress(0.3, 'Procurando campos de formulário...');
  try {
    const formulario = doc.getForm();
    const campos = formulario.getFields().length;
    if (campos > 0) {
      formulario.flatten();
      notes.push(`${campos} campo(s) de formulário viraram conteúdo fixo e não podem mais ser editados.`);
    } else {
      notes.push('Este PDF não tem campos de formulário. O arquivo foi só reescrito, sem outras mudanças.');
    }
  } catch {
    notes.push('Não foi possível achatar os campos deste formulário. O arquivo saiu reescrito, sem alteração.');
  }

  ctx.onProgress(0.8, 'Salvando...');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'achatado'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  };
}

/** Carimba um texto fixo no topo e/ou no pé de cada página. */
async function headerFooter(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();

  const cabecalho = sanitizeText(String(ctx.options.header ?? '')).trim();
  const rodape = sanitizeText(String(ctx.options.footer ?? '')).trim();
  const alinhamento = String(ctx.options.align ?? 'centro');
  const tamanho = Math.max(6, Math.min(24, Number(ctx.options.size ?? 10)));
  const margem = PAGE_NUMBER_MARGIN_PT;

  if (!cabecalho && !rodape) throw new Error('Escreva pelo menos o cabeçalho ou o rodapé.');

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Página ${i + 1}/${paginas.length}`);
    const pagina = paginas[i];
    const { width, height } = pagina.getSize();

    for (const [texto, y] of [
      [cabecalho, height - margem - tamanho],
      [rodape, margem],
    ] as const) {
      if (!texto) continue;
      const larguraTexto = fonte.widthOfTextAtSize(texto, tamanho);
      const x =
        alinhamento === 'esquerda'
          ? margem
          : alinhamento === 'direita'
            ? width - margem - larguraTexto
            : (width - larguraTexto) / 2;
      pagina.drawText(texto, { x, y, size: tamanho, font: fonte, color: rgb(0.4, 0.45, 0.42) });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'carimbado'), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/**
 * Escreve título, autor, assunto e palavras-chave. O contrário de "Limpar
 * metadados", para quem precisa que o documento se identifique direito num
 * acervo ou num sistema de busca.
 */
async function setMetadata(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);

  const titulo = sanitizeText(String(ctx.options.title ?? '')).trim();
  const autor = sanitizeText(String(ctx.options.author ?? '')).trim();
  const assunto = sanitizeText(String(ctx.options.subject ?? '')).trim();
  const palavras = sanitizeText(String(ctx.options.keywords ?? '')).trim();

  ctx.onProgress(0.4, 'Gravando os campos...');
  doc.setTitle(titulo);
  doc.setAuthor(autor);
  doc.setSubject(assunto);
  doc.setKeywords(palavras ? palavras.split(',').map((p) => p.trim()).filter(Boolean) : []);
  doc.setModificationDate(new Date());

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'com-dados'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Campo deixado em branco é gravado vazio, apagando o que estava lá antes.'],
  };
}

/**
 * Corta cada página em duas ou quatro partes, cada uma virando página própria.
 *
 * É o contrário de "Várias por folha", e o caso comum é livro digitalizado:
 * o escâner pega as duas páginas abertas numa imagem só e aqui elas se separam.
 */
async function splitPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const modo = String(ctx.options.mode ?? 'vertical');
  const paginas = origem.getPages();

  const out = await PDFDocument.create();

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Página ${i + 1}/${paginas.length}`);
    const { width, height } = paginas[i].getSize();

    // Cada recorte é uma fatia da página original, de baixo para cima e da
    // esquerda para a direita — mas a leitura começa em cima, então as linhas
    // saem na ordem inversa.
    const recortes =
      modo === 'horizontal'
        ? [
            { left: 0, bottom: height / 2, right: width, top: height },
            { left: 0, bottom: 0, right: width, top: height / 2 },
          ]
        : modo === 'quatro'
          ? [
              { left: 0, bottom: height / 2, right: width / 2, top: height },
              { left: width / 2, bottom: height / 2, right: width, top: height },
              { left: 0, bottom: 0, right: width / 2, top: height / 2 },
              { left: width / 2, bottom: 0, right: width, top: height / 2 },
            ]
          : [
              { left: 0, bottom: 0, right: width / 2, top: height },
              { left: width / 2, bottom: 0, right: width, top: height },
            ];

    for (const recorte of recortes) {
      const embutida = await out.embedPage(paginas[i], recorte);
      const larguraParte = recorte.right - recorte.left;
      const alturaParte = recorte.top - recorte.bottom;
      out
        .addPage([larguraParte, alturaParte])
        .drawPage(embutida, { x: 0, y: 0, width: larguraParte, height: alturaParte });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'dividido'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`Cada página virou ${modo === 'quatro' ? 'quatro' : 'duas'}: ${paginas.length} entraram, ${out.getPageCount()} saíram.`],
  };
}

/**
 * Monta o documento para virar livreto: imprima frente e verso na borda curta,
 * dobre a pilha ao meio e as páginas caem na ordem certa.
 *
 * Cada folha A4 deitada recebe duas páginas. Numa brochura grampeada no vinco,
 * a primeira folha carrega a última página e a primeira juntas, a segunda
 * carrega a penúltima e a segunda, e assim por diante.
 */
async function booklet(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  // A dobra só fecha em múltiplo de 4; o que falta entra como página em branco.
  const comBrancos = Math.ceil(total / 4) * 4;
  const primeira = origem.getPage(0).getSize();
  const larguraFolha = primeira.width * 2;
  const alturaFolha = primeira.height;

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(origem.getPages());

  const ordem: (number | null)[] = [];
  for (let i = 0; i < comBrancos / 2; i += 2) {
    ordem.push(comBrancos - 1 - i, i); // frente da folha
    ordem.push(i + 1, comBrancos - 2 - i); // verso
  }

  for (let i = 0; i < ordem.length; i += 2) {
    ctx.onProgress(i / ordem.length, `Montando folha ${Math.floor(i / 2) + 1}`);
    const folha = out.addPage([larguraFolha, alturaFolha]);
    for (const [posicao, indice] of [ordem[i], ordem[i + 1]].entries()) {
      if (indice === null || indice >= total) continue;
      folha.drawPage(embutidas[indice], {
        x: posicao * primeira.width,
        y: 0,
        width: primeira.width,
        height: alturaFolha,
      });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'livreto'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Imprima frente e verso virando na borda curta, dobre a pilha ao meio e grampeie no vinco.',
      ...(comBrancos !== total ? [`Foram somadas ${comBrancos - total} página(s) em branco para fechar a dobra.`] : []),
    ],
  };
}

/** Separa o documento em dois: um com as páginas ímpares, outro com as pares. */
async function oddEven(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  const impares = Array.from({ length: total }, (_, i) => i).filter((i) => i % 2 === 0);
  const pares = Array.from({ length: total }, (_, i) => i).filter((i) => i % 2 === 1);

  const saidas: OutputFile[] = [];
  let outputBytes = 0;

  for (const [rotulo, indices] of [
    ['impares', impares],
    ['pares', pares],
  ] as const) {
    if (!indices.length) continue;
    ctx.onProgress(rotulo === 'impares' ? 0.2 : 0.6, `Separando as ${rotulo}`);
    const out = await PDFDocument.create();
    for (const pagina of await out.copyPages(origem, indices)) out.addPage(pagina);
    const blob = await salvarPdf(out, source.senha);
    outputBytes += blob.size;
    saidas.push({ name: suffixName(source.name, rotulo), blob, pages: indices.length });
    await respirar(ctx);
  }

  ctx.onProgress(1);
  return {
    files: saidas,
    inputBytes: source.size,
    outputBytes,
    notes: [`${impares.length} página(s) ímpar(es) e ${pares.length} par(es), contando a partir de 1.`],
  };
}

/** Insere folhas em branco, para imprimir frente e verso ou tomar nota. */
async function blankPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const onde = String(ctx.options.where ?? 'depois-de-cada');
  const quantas = Math.max(1, Math.min(10, Math.round(Number(ctx.options.count ?? 1))));
  const total = origem.getPageCount();

  const out = await PDFDocument.create();
  const copiadas = await out.copyPages(origem, Array.from({ length: total }, (_, i) => i));

  const branco = (referencia: { width: number; height: number }) =>
    out.addPage([referencia.width, referencia.height]);

  if (onde === 'no-inicio') {
    const tamanho = origem.getPage(0).getSize();
    for (let n = 0; n < quantas; n += 1) branco(tamanho);
  }

  for (let i = 0; i < copiadas.length; i += 1) {
    ctx.onProgress(i / copiadas.length, `Página ${i + 1}/${total}`);
    const tamanho = copiadas[i].getSize();
    out.addPage(copiadas[i]);
    if (onde === 'depois-de-cada' && i < copiadas.length - 1) {
      for (let n = 0; n < quantas; n += 1) branco(tamanho);
    }
    await respirar(ctx);
  }

  if (onde === 'no-fim') {
    const tamanho = origem.getPage(total - 1).getSize();
    for (let n = 0; n < quantas; n += 1) branco(tamanho);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'com-brancos'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`O documento saiu com ${out.getPageCount()} páginas; entrou com ${total}.`],
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

  const blob = await salvarPdf(doc, source.senha);
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
  ocr,
  'page-numbers': pageNumbers,
  repair,
  'pdf-to-word': pdfToWord,
  'word-to-pdf': wordToPdf,
  'text-to-pdf': textToPdf,
  reverse,
  interleave,
  grayscale,
  flatten,
  'header-footer': headerFooter,
  'set-metadata': setMetadata,
  'split-pages': splitPages,
  booklet,
  'odd-even': oddEven,
  'blank-pages': blankPages,
  'excel-to-pdf': excelToPdf,
  'powerpoint-to-pdf': powerpointToPdf,
} satisfies Record<string, (ctx: RunContext) => Promise<RunResult>>;

export type OperationId = keyof typeof OPERATIONS;

export async function runOperation(id: OperationId, ctx: RunContext): Promise<RunResult> {
  const operation = OPERATIONS[id];
  if (!operation) throw new Error(`Ferramenta desconhecida: ${id}`);
  const resultado = await operation(ctx);

  // `salvarPdf` devolve a senha ao resultado. O aviso fica aqui, num lugar só,
  // em vez de repetido em cada operação. Proteger e desbloquear ficam de fora:
  // mexer na senha é justamente o trabalho delas.
  const protegeu =
    id !== 'protect' &&
    id !== 'unlock' &&
    ctx.files.some((file) => file.senha) &&
    resultado.files.some((file) => file.name.toLowerCase().endsWith('.pdf'));

  if (protegeu) {
    return {
      ...resultado,
      notes: [...resultado.notes, 'O resultado continua protegido com a mesma senha do original.'],
    };
  }
  return resultado;
}

export { zipFiles };
