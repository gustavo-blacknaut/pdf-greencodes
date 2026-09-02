'use client';

/**
 * Peças compartilhadas por todas as operações.
 *
 * Abrir e gravar PDF, desenhar página em canvas, medir papel, escapar XML.
 * Nada aqui é uma ferramenta: são as ferramentas que usam isto.
 */

import { yieldToBrowser } from '../utils';
import { abortarSePreciso } from './guards';
import { type Ajuste, type LoadedFile, type RunContext } from './tipos';
import { loadPdfJs, loadPdfLib } from './lazy';

/**
 * Ponto de respiro dos laços: devolve a thread para a interface e é onde o
 * cancelamento efetivamente acontece. Sem isso uma operação longa só terminaria
 * quando quisesse.
 */
export async function respirar(ctx: RunContext): Promise<void> {
  abortarSePreciso(ctx.signal);
  await yieldToBrowser();
}

export const MAX_RASTER_EDGE = 4200;

/* -------------------------------------------------------------------------- */
/* Primitivas compartilhadas                                                   */
/* -------------------------------------------------------------------------- */

/** pdf.js e pdf-lib consomem (e às vezes destacam) o buffer, então sempre copiamos. */
export function copy(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

/**
 * pdf-lib devolve `Uint8Array<ArrayBufferLike>`, que o TS 5.7 recusa como
 * BlobPart (o buffer poderia, em tese, ser um SharedArrayBuffer). Em runtime é
 * sempre um ArrayBuffer comum.
 */
export function toPdfBlob(bytes: Uint8Array): Blob {
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
export function variantesDeSenha(senha: string): string[] {
  if (!senha) return [''];
  const bases = [senha, senha.trim()];
  const todas = bases.flatMap((base) => [base, base.normalize('NFC'), base.normalize('NFD')]);
  return [...new Set(todas)];
}

export async function openWithPdfLib(bytes: ArrayBuffer, password = '') {
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

export async function openWithPdfJs(bytes: ArrayBuffer, password?: string) {
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

/** Documento aberto pelo pdf-lib. */
export type PdfDoc = Awaited<ReturnType<typeof openWithPdfLib>>;

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
export async function salvarPdf(doc: PdfDoc, senha?: string): Promise<Blob> {
  if (!senha) return toPdfBlob(await doc.save({ useObjectStreams: true }));
  doc.encrypt({ userPassword: senha, ownerPassword: senha });
  return toPdfBlob(await doc.save({ useObjectStreams: false }));
}

/** Numa operação de vários arquivos, um protegido já protege o resultado. */
export function senhaDaFila(files: LoadedFile[]): string | undefined {
  return files.find((file) => file.senha)?.senha;
}

/** PDFs com senha de abertura só podem ser lidos com ela, então tratamos à parte. */
export function isPasswordError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return name === 'PasswordException' || /password|encrypt/i.test(message);
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem da página.'))),
      mime,
      quality,
    );
  });
}

/** Fontes standard usam WinAnsi; caracteres fora dela quebram o pdf-lib. */
export function sanitizeText(text: string): string {
  return text.replace(/[^\x20-\xFF]/g, '');
}

export async function renderPageToCanvas(
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
export function pintarFundoBranco(destino: PdfDoc, pagina: ReturnType<PdfDoc['addPage']>): void {
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

export type TamanhoPagina = { largura: number; altura: number; seguirImagem: boolean };

export function tamanhoDaPagina(
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
export async function desenharPaginaDeImagem(
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

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3: [841.89, 1190.55],
} as const;

export const PAGE_NUMBER_MARGIN_PT = 24;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function decodificarEntidadesXml(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Converte o formato bruto de imagem do pdf.js para um canvas. */
export function drawPdfImage(
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

export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.blob);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/* -------------------------------------------------------------------------- */
