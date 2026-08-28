/**
 * Carregamento antecipado ("pré-carregamento") das bibliotecas pesadas.
 *
 * pdf-lib (~350 kB) e pdf.js (~1 MB + worker) só são necessários no momento em
 * que o usuário roda uma ferramenta. Só que, se esperarmos até lá, ele encara um
 * segundo de download parado numa tela de "carregando". Então buscamos os
 * chunks assim que o browser fica ocioso (ou no primeiro hover em um card de
 * ferramenta), guardando as promises para reuso.
 */

// @cantoo/pdf-lib é um fork mantido do pdf-lib com a mesma API, mais
// criptografia AES, o que viabiliza proteger e desbloquear PDFs no navegador.
type PdfLib = typeof import('@cantoo/pdf-lib');
type PdfJs = typeof import('pdfjs-dist');

let pdfLibPromise: Promise<PdfLib> | null = null;
let pdfJsPromise: Promise<PdfJs> | null = null;

export function loadPdfLib(): Promise<PdfLib> {
  pdfLibPromise ??= import('@cantoo/pdf-lib');
  return pdfLibPromise;
}

export function loadPdfJs(): Promise<PdfJs> {
  pdfJsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

export type EngineStatus = 'cold' | 'warming' | 'ready';

let status: EngineStatus = 'cold';
const listeners = new Set<(s: EngineStatus) => void>();

function setStatus(next: EngineStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((fn) => fn(next));
}

export function getEngineStatus(): EngineStatus {
  return status;
}

export function subscribeEngineStatus(fn: (s: EngineStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Aquece o motor. Idempotente: pode ser chamado em hover, focus, idle, etc. */
export function warmEngine(options: { raster?: boolean } = {}): Promise<void> {
  if (status === 'ready') return Promise.resolve();
  setStatus('warming');
  const jobs: Promise<unknown>[] = [loadPdfLib()];
  if (options.raster !== false) jobs.push(loadPdfJs());
  return Promise.all(jobs)
    .then(() => setStatus('ready'))
    .catch(() => setStatus('cold'));
}

/** Agenda o aquecimento para quando a thread principal estiver livre. */
export function scheduleWarmup(options: { raster?: boolean } = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const ric = window.requestIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(() => void warmEngine(options), { timeout: 2500 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => void warmEngine(options), 1200);
  return () => window.clearTimeout(id);
}
