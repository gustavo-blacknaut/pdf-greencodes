'use client';

/**
 * OCR client-side com tesseract.js.
 *
 * Motor (wasm), worker e dados de idioma são servidos por `public/tesseract`,
 * nunca por CDN: mesmo princípio das outras ferramentas, nada sai deste
 * domínio. O core usado é a variante "lstm" (só a rede neural, sem o motor
 * legado) com SIMD, suportada por qualquer navegador de 2021 em diante — o
 * Electron empacotado está bem acima disso.
 *
 * Depois do primeiro uso, tesseract.js guarda o motor e os dados de idioma no
 * IndexedDB (opção `cacheMethod: 'write'`), então só a primeira operação de
 * OCR baixa os poucos megabytes; as próximas reaproveitam o cache local.
 */

export type OcrLanguage = 'por' | 'eng' | 'por+eng';

export const OCR_LANGUAGES: { value: OcrLanguage; label: string }[] = [
  { value: 'por', label: 'Português' },
  { value: 'eng', label: 'Inglês' },
  { value: 'por+eng', label: 'Português + Inglês' },
];

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

let tesseractPromise: Promise<TesseractModule> | null = null;
function loadTesseract(): Promise<TesseractModule> {
  tesseractPromise ??= import('tesseract.js');
  return tesseractPromise;
}

/** Aquece o download do motor sem esperar por um arquivo, para hover antecipado. */
export function warmOcrEngine(): Promise<unknown> {
  return loadTesseract();
}

export async function createOcrWorker(
  lang: OcrLanguage,
  onStatus?: (status: string, fraction: number) => void,
): Promise<TesseractWorker> {
  const { createWorker } = await loadTesseract();
  return createWorker(lang, undefined, {
    workerPath: '/tesseract/worker.min.js',
    // O core resolve o `.wasm` irmão a partir de `self.location`, que só
    // aponta para cá quando o worker roda direto da URL (sem o wrapper em
    // blob:, cujo "location" opaco quebra essa resolução relativa) e quando
    // o `.wasm` mora ao lado do `worker.min.js`, não numa subpasta.
    workerBlobURL: false,
    corePath: '/tesseract/tesseract-core-simd-lstm.js',
    langPath: '/tesseract/lang',
    gzip: true,
    cacheMethod: 'write',
    logger: (m) => onStatus?.(m.status, m.progress),
  });
}
