'use client';

/**
 * Prepara um PDF para a impressora do aplicativo.
 *
 * Cada página é desenhada como imagem e mandada na hora para o processo
 * principal, que grava em disco e depois monta o HTML que vai imprimir.
 *
 * O caminho é esse porque abrir o PDF numa janela escondida e mandar imprimir
 * não funciona: aquela janela mostra o visualizador do Chromium, e o print()
 * imprime a tela dele — saía uma folha só, com um retângulo preto.
 *
 * Uma página por vez, e a imagem é solta assim que sai: um documento de 55
 * páginas passa de 50 MB desenhado, e segurar tudo antes de enviar derruba a
 * aba em máquina fraca.
 */

import { loadPdfJs } from './lazy';

/**
 * Teto do desenho.
 *
 * A qualidade escolhida no painel diz à impressora em que resolução imprimir;
 * aqui ela também definiria o tamanho do desenho, e 1200 DPI numa A4 daria 139
 * megapixels por página. Acima de 300 a diferença não aparece no papel, então
 * é onde paramos.
 */
const DPI_MAXIMO = 300;

export type ProgressoImpressao = (feitas: number, total: number) => void;

/** Desenha o PDF folha a folha e entrega cada uma ao processo principal. */
export async function prepararParaImpressao(
  blob: Blob,
  dpi: number,
  enviarPagina: (indice: number, bytes: ArrayBuffer) => Promise<unknown>,
  onProgresso?: ProgressoImpressao,
): Promise<number> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const escala = Math.min(Math.max(Number(dpi) || 300, 72), DPI_MAXIMO) / 72;
  const canvas = document.createElement('canvas');

  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const pagina = await doc.getPage(i);
      const viewport = pagina.getViewport({ scale: escala });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const contexto = canvas.getContext('2d');
      if (!contexto) throw new Error('Não foi possível desenhar a página para imprimir.');

      // O PDF não desenha fundo: sem pintar branco antes, a folha sai preta
      // no canvas, que começa transparente e vira preto no JPEG.
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, canvas.width, canvas.height);

      await pagina.render({ canvasContext: contexto, viewport }).promise;
      pagina.cleanup();

      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!jpeg) throw new Error('Não foi possível converter a página para imprimir.');

      await enviarPagina(i, await jpeg.arrayBuffer());
      onProgresso?.(i, doc.numPages);
    }
    return doc.numPages;
  } finally {
    await doc.destroy();
    canvas.width = 0;
    canvas.height = 0;
  }
}
