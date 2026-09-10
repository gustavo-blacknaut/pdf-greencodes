'use client';

/**
 * Fazer um PDF caber num tamanho, no navegador.
 *
 * O irmão deste arquivo em Python (`motor/motor/encolher.py`) faz melhor: ele
 * reduz **só as imagens embutidas** e o texto continua texto. Aqui isso não
 * existe, e vale dizer por quê em vez de deixar a diferença por conta do
 * acaso: nem o pdf-lib nem o pdf.js sabem reescrever uma imagem dentro de um
 * PDF. O pdf-lib monta arquivos, o pdf.js desenha páginas — e desenhar a
 * página inteira é o único caminho que o navegador oferece.
 *
 * Então, no site, a página vira foto. É perda de verdade: o texto deixa de
 * ser selecionável e a cor passa pelo sRGB do canvas. A nota diz isso com
 * todas as letras, e no aplicativo o caminho é o outro.
 *
 * A ordem das tentativas é a mesma dos dois lados, e vai do que não custa
 * nada para o que custa: primeiro reescrever a estrutura, e só depois mexer
 * no desenho.
 */

import { canvasToBlob, openWithPdfJs, openWithPdfLib, renderPageToCanvas, respirar, salvarPdf } from './nucleo';
import { loadPdfLib } from './lazy';
import type { RunContext } from './tipos';

/**
 * A escada de tentativas.
 *
 * 200 DPI ainda imprime bem em laser; 150 é leitura de tela confortável; 96 é
 * onde texto dentro de imagem ainda se lê. Abaixo disso já é o caso de
 * "precisa caber, custe o que custar".
 */
export const DEGRAUS = [
  { dpi: 200, qualidade: 0.88 },
  { dpi: 150, qualidade: 0.82 },
  { dpi: 120, qualidade: 0.75 },
  { dpi: 96, qualidade: 0.68 },
  { dpi: 72, qualidade: 0.6 },
  { dpi: 50, qualidade: 0.45 },
];

export type Encolhido = {
  blob: Blob;
  coube: boolean;
  /** Falso quando alguma página teve que ser redesenhada. */
  semPerda: boolean;
};

/** Redesenha o documento inteiro no DPI e na qualidade pedidos. */
async function rasterizar(
  bytes: ArrayBuffer,
  senha: string | undefined,
  dpi: number,
  qualidade: number,
  ctx: RunContext,
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await openWithPdfJs(bytes, senha);
  const out = await PDFDocument.create();

  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);
      const jpeg = await canvasToBlob(canvas, 'image/jpeg', qualidade);
      const embutida = await out.embedJpg(await jpeg.arrayBuffer());
      out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });
      page.cleanup();
      await respirar(ctx);
    }
  } finally {
    await doc.destroy();
  }

  return salvarPdf(out, senha);
}

/**
 * Encolhe até caber, tirando o menos possível.
 *
 * Devolve o menor arquivo que conseguiu mesmo quando não coube: entregar
 * nada seria pior, e quem chamou avisa que passou.
 */
export async function ateCaber(
  bytes: ArrayBuffer,
  limiteBytes: number,
  ctx: RunContext,
  senha?: string,
): Promise<Encolhido> {
  // Passo 1: só reescrever a estrutura. Não custa qualidade nenhuma.
  const arrumado = await salvarPdf(await openWithPdfLib(bytes, senha), senha);
  if (arrumado.size <= limiteBytes) {
    return { blob: arrumado, coube: true, semPerda: true };
  }

  const canvas = document.createElement('canvas');
  let melhor = arrumado;

  for (const degrau of DEGRAUS) {
    const tentativa = await rasterizar(bytes, senha, degrau.dpi, degrau.qualidade, ctx, canvas);
    melhor = tentativa;
    if (tentativa.size <= limiteBytes) {
      return { blob: tentativa, coube: true, semPerda: false };
    }
  }

  // Nem no degrau mais baixo. Se depois de tudo o redesenho ficou maior que a
  // simples reescrita — acontece em página só de texto —, o menor dos dois é
  // o que vale.
  const escolhido = melhor.size < arrumado.size ? melhor : arrumado;
  return { blob: escolhido, coube: false, semPerda: escolhido === arrumado };
}
