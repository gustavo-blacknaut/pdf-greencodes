'use client';

/**
 * O registro das ferramentas, e a porta de entrada do motor.
 *
 * Cada operação mora no módulo do seu assunto; aqui ficam só o mapa que liga
 * identificador a função e o que a interface precisa importar. Quem escreve
 * uma ferramenta nova mexe em `operacoes/`, e neste arquivo só numa linha.
 */

import { blackTones, compress, grayscale, inkCoverage, invertColors, repair, rgbToCmyk, separatePlates } from './operacoes/otimizar';
import {
  applyPlan,
  blankPages,
  booklet,
  interleave,
  merge,
  nUp,
  oddEven,
  reverse,
  split,
  splitPages,
} from './operacoes/organizar';
import {
  excelToPdf,
  extractImages,
  imagesToPdf,
  pdfToImages,
  photoSheet,
  powerpointToPdf,
  textToPdf,
  wordToPdf,
} from './operacoes/converter';
import { ocr, pdfToText, pdfToWord } from './operacoes/texto';
import { crop, edit, flatten, headerFooter, pageNumbers, resize, watermark } from './operacoes/editar';
import { protect, setMetadata, stripMetadata, unlock } from './operacoes/seguranca';
import { businessCards, cropMarks, labels, mirror, repeatPages, sequentialNumbering } from './operacoes/grafica';
import { preflight } from './operacoes/verificar';
import { boletoParaImpressao, readBoleto } from './operacoes/boleto';
import { compressImage, convertImage, cropImage, enhanceImage, heicToImage, resizeImage } from './operacoes/imagem';
import {
  adjustImage,
  borderImage,
  cleanScan,
  joinImages,
  removeBackground,
  rotateImage,
  watermarkImage,
} from './operacoes/imagem-editar';
import { addBleed, foldMarks, frenteEVerso, posterTiles, stampImage } from './operacoes/grafica-extra';
import { gerarCodigoBarras, gerarQrCode } from './operacoes/codigos';
import { rodarNoPython, temMotorPython } from './motor-python';
import type { RunContext, RunResult } from './tipos';
import { formatBytes } from '../utils';

/* A interface importa tudo daqui, então o que ela usa é reexportado. */
export type {
  Ajuste,
  ElementoEditor,
  LoadedFile,
  OutputFile,
  PagePlanItem,
  PaginaParaEditor,
  ProgressFn,
  RunContext,
  RunResult,
} from './tipos';
export { desbloquearArquivo, inspectFile, renderPageThumbnails, renderPaginaParaEditor } from './arquivos';
export { FORMATOS_MM, mmParaPt, zipFiles } from './nucleo';
export { POR_FOLHA } from './operacoes/organizar';

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
  'invert-colors': invertColors,
  'black-tones': blackTones,
  'rgb-to-cmyk': rgbToCmyk,
  flatten,
  'header-footer': headerFooter,
  'set-metadata': setMetadata,
  'split-pages': splitPages,
  booklet,
  'odd-even': oddEven,
  'blank-pages': blankPages,
  'excel-to-pdf': excelToPdf,
  'powerpoint-to-pdf': powerpointToPdf,
  'crop-marks': cropMarks,
  'business-cards': businessCards,
  labels,
  'sequential-numbering': sequentialNumbering,
  mirror,
  'repeat-pages': repeatPages,
  preflight,
  'photo-sheet': photoSheet,
  'separate-plates': separatePlates,
  'ink-coverage': inkCoverage,
  'convert-image': convertImage,
  'resize-image': resizeImage,
  'compress-image': compressImage,
  'heic-to-image': heicToImage,
  'enhance-image': enhanceImage,
  'crop-image': cropImage,
  'read-boleto': readBoleto,
  'boleto-pdf': boletoParaImpressao,
  'adjust-image': adjustImage,
  'rotate-image': rotateImage,
  'remove-background': removeBackground,
  'clean-scan': cleanScan,
  'border-image': borderImage,
  'watermark-image': watermarkImage,
  'join-images': joinImages,
  'poster-tiles': posterTiles,
  'add-bleed': addBleed,
  'fold-marks': foldMarks,
  'front-back': frenteEVerso,
  'stamp-image': stampImage,
  'qr-code': gerarQrCode,
  barcode: gerarCodigoBarras,
} satisfies Record<string, (ctx: RunContext) => Promise<RunResult>>;

export type OperationId = keyof typeof OPERATIONS;

/**
 * Até aqui, um arquivo que ficou no disco ainda pode ser trazido para a
 * memória, quando a ferramenta não passa pelo motor. Acima disso o pdf-lib
 * pede vários múltiplos do tamanho, e a janela cai antes de terminar.
 */
const TRAZ_PARA_A_MEMORIA_ATE = 1024 * 1024 * 1024;

/**
 * A ferramenta não trabalha pelo caminho: traz o arquivo do disco, se couber.
 *
 * Só quem passa pelo motor Python abre o arquivo pelo caminho. O editor, o
 * OCR, a proteção com permissões e os outros de JavaScript precisam do
 * documento na memória.
 */
async function trazerParaAMemoria(ctx: RunContext): Promise<RunContext> {
  if (!ctx.files.some((arquivo) => arquivo.caminho)) return ctx;
  const grande = ctx.files.find((arquivo) => arquivo.caminho && arquivo.size > TRAZ_PARA_A_MEMORIA_ATE);
  if (grande) {
    throw new Error(
      `"${grande.name}" tem ${formatBytes(grande.size)}, e esta ferramenta precisa abrir o documento inteiro na memória, o que não cabe. Comprimir, juntar, dividir, girar, numerar e as outras que usam o motor trabalham direto no disco, com arquivos de até 2 GB.`,
    );
  }
  const { lerCaminho } = await import('../desktop');
  const files = [];
  for (const arquivo of ctx.files) {
    if (!arquivo.caminho) {
      files.push(arquivo);
      continue;
    }
    ctx.onProgress(0, `Lendo ${arquivo.name}`);
    files.push({ ...arquivo, bytes: await lerCaminho(arquivo.caminho), caminho: undefined });
  }
  return { ...ctx, files };
}

export async function runOperation(id: OperationId, ctx: RunContext): Promise<RunResult> {
  const operation = OPERATIONS[id];
  if (!operation) throw new Error(`Ferramenta desconhecida: ${id}`);

  // No aplicativo, as ferramentas que rasterizam página vão para o motor
  // Python: medido, 277 ms por página contra 1189 do pdf.js. No site
  // `temMotorPython` é sempre falso e nada muda.
  const resultado = temMotorPython(id, ctx)
    ? await rodarNoPython(id, ctx)
    : await operation(await trazerParaAMemoria(ctx));

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
