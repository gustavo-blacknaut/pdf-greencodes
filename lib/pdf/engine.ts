'use client';

/**
 * O registro das ferramentas, e a porta de entrada do motor.
 *
 * Cada operação mora no módulo do seu assunto; aqui ficam só o mapa que liga
 * identificador a função e o que a interface precisa importar. Quem escreve
 * uma ferramenta nova mexe em `operacoes/`, e neste arquivo só numa linha.
 */

import { blackTones, compress, grayscale, invertColors, repair } from './operacoes/otimizar';
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
  ocr,
  pdfToImages,
  pdfToText,
  pdfToWord,
  powerpointToPdf,
  textToPdf,
  wordToPdf,
} from './operacoes/converter';
import { crop, edit, flatten, headerFooter, pageNumbers, resize, watermark } from './operacoes/editar';
import { protect, setMetadata, stripMetadata, unlock } from './operacoes/seguranca';
import { rodarNoPython, temMotorPython } from './motor-python';
import type { RunContext, RunResult } from './tipos';

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

  // No aplicativo, as ferramentas que rasterizam página vão para o motor
  // Python: medido, 277 ms por página contra 1189 do pdf.js. No site
  // `temMotorPython` é sempre falso e nada muda.
  const resultado = temMotorPython(id, ctx) ? await rodarNoPython(id, ctx) : await operation(ctx);

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
