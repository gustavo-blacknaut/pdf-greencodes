'use client';

/**
 * Prepara um PDF para a impressora do aplicativo.
 *
 * Cada página vira uma **folha inteira**, do tamanho exato do papel escolhido,
 * e é essa folha que vai para o processo principal. O caminho antigo mandava a
 * página solta e deixava o tamanho para o outro lado decidir — era daí que
 * saía a fatura A4 impressa do tamanho de uma A5, no meio do papel.
 *
 * Uma folha por vez, e a imagem é solta assim que sai: um documento de 55
 * páginas passa de 50 MB desenhado, e segurar tudo antes de enviar derruba a
 * aba em máquina fraca.
 */

import {
  desenharFolha,
  planoDaFolha,
  pontosParaMm,
  resolucao,
  type Montagem,
} from '../impressao/folha';
import { openWithPdfJs, renderPageToCanvas } from './nucleo';

/**
 * Teto do desenho da página, antes de entrar na folha.
 *
 * Passa dos 300 da folha porque ampliar é caso real de gráfica: um cartão de
 * visita a 300% precisa de três vezes mais pixel na origem para chegar com
 * 300 no papel. Acima de 600 o ganho não sai da tela.
 */
const DPI_MAXIMO_DA_PAGINA = 600;

export type ProgressoImpressao = (feitas: number, total: number) => void;

/** Desenha o PDF folha a folha e entrega cada uma ao processo principal. */
export async function prepararParaImpressao(
  blob: Blob,
  montagem: Montagem,
  enviarFolha: (indice: number, bytes: ArrayBuffer) => Promise<unknown>,
  onProgresso?: ProgressoImpressao,
): Promise<number> {
  const doc = await openWithPdfJs(await blob.arrayBuffer());
  const dpiDaFolha = resolucao(montagem.dpi);
  const pagina = document.createElement('canvas');
  const folha = document.createElement('canvas');

  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const atual = await doc.getPage(i);
      const medida = atual.getViewport({ scale: 1 });
      const arte = {
        largura: pontosParaMm(medida.width),
        altura: pontosParaMm(medida.height),
      };

      // Desenhar a página na resolução em que ela vai **terminar** na folha:
      // reduzida, poupa memória; ampliada, evita o borrão de esticar depois.
      const plano = planoDaFolha(arte, montagem);
      const fator = arte.largura > 0 ? plano.arte.largura / plano.pontosPorMm / arte.largura : 1;
      const dpiDaPagina = Math.min(
        Math.max(dpiDaFolha * fator, 72),
        DPI_MAXIMO_DA_PAGINA,
      );

      // A mesma função que comprimir, tons de cinza e OCR usam. Desenhar aqui
      // por conta própria custou uma versão travada: sem `intent: 'print'` o
      // pdf.js agenda o desenho por quadro de animação, e numa janela que não
      // está em primeiro plano esse agendamento não roda — a promessa do
      // desenho nunca resolvia e a impressão ficava em "Enviando..." para
      // sempre.
      await renderPageToCanvas(atual, dpiDaPagina, pagina);
      atual.cleanup();

      desenharFolha(pagina, arte, montagem, folha);

      const jpeg = await new Promise<Blob | null>((resolve) =>
        folha.toBlob(resolve, 'image/jpeg', 0.95),
      );
      if (!jpeg) throw new Error('Não foi possível converter a folha para imprimir.');

      await enviarFolha(i, await jpeg.arrayBuffer());
      onProgresso?.(i, doc.numPages);
    }
    return doc.numPages;
  } finally {
    await doc.destroy();
    pagina.width = 0;
    pagina.height = 0;
    folha.width = 0;
    folha.height = 0;
  }
}
