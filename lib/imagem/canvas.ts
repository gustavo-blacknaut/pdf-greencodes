'use client';

/**
 * A ponte entre o canvas do navegador e os pixels crus.
 *
 * De um lado o `ImageBitmap`, que o navegador decodifica e sabe desenhar; do
 * outro o `Bitmap` deste projeto, que é só um array de bytes e roda em
 * qualquer lugar. Todo tratamento de imagem atravessa esta ponte duas vezes:
 * na entrada e na saída.
 *
 * Fica separado das ferramentas porque duas delas precisam do mesmo caminho —
 * as de formato e as de tratamento — e porque nada aqui é testável em Node:
 * é justamente a parte que só existe dentro do navegador.
 */

import { FORMATOS_DE_SAIDA, type FormatoDeSaida } from './medidas';
import type { Bitmap } from './lanczos';
import type { Decodificada } from './decodificar';
import { canvasToBlob } from '../pdf/nucleo';

/** Do bitmap decodificado do navegador para os pixels crus. */
export async function pixelsDe(imagem: Decodificada): Promise<Bitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = imagem.largura;
  canvas.height = imagem.altura;
  // `willReadFrequently` avisa o navegador para manter o quadro na memória do
  // processador em vez de na placa de vídeo. Sem isso, cada `getImageData`
  // arranca os pixels da GPU, e numa fila de fotos isso domina o tempo todo.
  const pincel = canvas.getContext('2d', { willReadFrequently: true });
  if (!pincel) throw new Error('O navegador não deixou ler os pixels da imagem.');

  pincel.drawImage(imagem.bitmap, 0, 0);
  const dados = pincel.getImageData(0, 0, imagem.largura, imagem.altura);
  return { dados: dados.data, largura: imagem.largura, altura: imagem.altura };
}

/** Um canvas com os pixels já dentro, para quem ainda vai desenhar por cima. */
export function canvasDe(mapa: Bitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = mapa.largura;
  canvas.height = mapa.altura;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');

  // O quadro sai do próprio contexto, e não do construtor de `ImageData`: a
  // tipagem do construtor muda conforme a versão da lib do TypeScript, e esta
  // forma funciona em todas.
  const quadro = pincel.createImageData(mapa.largura, mapa.altura);
  quadro.data.set(mapa.dados);
  pincel.putImageData(quadro, 0, 0);
  return canvas;
}

/**
 * Dos pixels crus para o arquivo.
 *
 * O cuidado com transparência não é detalhe: `putImageData` sobrescreve o que
 * estiver embaixo em vez de compor, então pintar o fundo branco antes não
 * funciona. O jeito é passar por um canvas intermediário e voltar com
 * `drawImage`, que compõe. Sem isso, uma logo em PNG salva como JPG sai com
 * fundo preto.
 */
export async function gravarPixels(
  mapa: Bitmap,
  formato: FormatoDeSaida,
  qualidade: number,
): Promise<Blob> {
  const alvo = FORMATOS_DE_SAIDA[formato];
  const comPixels = canvasDe(mapa);

  if (alvo.temTransparencia) {
    return canvasToBlob(comPixels, alvo.mime, alvo.temQualidade ? qualidade : undefined);
  }

  const canvas = document.createElement('canvas');
  canvas.width = mapa.largura;
  canvas.height = mapa.altura;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, canvas.width, canvas.height);
  pincel.drawImage(comPixels, 0, 0);

  return canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined);
}
