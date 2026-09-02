'use client';

/**
 * Os tipos que atravessam o motor de PDF.
 *
 * Ficam separados de propósito: componente que só precisa da forma de um
 * arquivo não deveria arrastar junto o pdf.js e o pdf-lib.
 */


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

export type PagePlanItem = { i: number; r: number };

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

export type PaginaParaEditor = {
  dataUrl: string;
  larguraPt: number;
  alturaPt: number;
  /** Página girada aparece deitada no editor; avisamos em vez de errar a conta. */
  rotacao: number;
  totalPaginas: number;
};

export type Ajuste = 'proporcao' | 'esticar' | 'preencher';
