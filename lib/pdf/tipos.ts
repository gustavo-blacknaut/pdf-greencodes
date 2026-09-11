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
  /**
   * Arquivo grande que ficou no disco, no aplicativo: `bytes` vem vazio, e
   * só o motor Python, que abre pelo caminho, trabalha com ele.
   */
  caminho?: string;
};

export type OutputFile = {
  name: string;
  blob: Blob;
  pages?: number;
  /**
   * Onde o resultado já está gravado, quando ele foi direto do motor para
   * Downloads sem passar pela memória. Aí o `blob` vem vazio, e o tamanho é
   * este.
   */
  caminho?: string;
  tamanho?: number;
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
 * Uma página do documento remontado.
 *
 * `i` é a página na origem e `r` o giro em graus. Os dois campos opcionais
 * vieram depois, quando o organizar deixou de trabalhar com um arquivo só:
 *
 * - `f` diz de qual arquivo da fila a página veio. Ausente significa o
 *   primeiro, que é como todo plano antigo se comporta — e é o que mantém
 *   funcionando quem já tinha um plano salvo.
 * - `branco` é uma folha em branco inserida ali. Ela não vem de lugar nenhum,
 *   então `i` não vale nada nesse caso.
 */
export type PagePlanItem = { i: number; r: number; f?: number; branco?: boolean };

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
