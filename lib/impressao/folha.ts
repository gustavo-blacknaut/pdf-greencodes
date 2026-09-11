'use client';

/**
 * Monta a folha inteira como imagem, do tamanho exato do papel.
 *
 * Antes, cada página ia para a impressora como uma imagem solta e quem
 * decidia o tamanho era o outro lado — o CSS da janela escondida, depois o
 * driver. Duas medidas para a mesma folha, e quando discordavam o driver
 * encolhia o trabalho para caber: uma fatura A4 saía do tamanho de uma A5, no
 * meio do papel.
 *
 * Agora só existe uma medida. A folha é desenhada aqui, em milímetros, com a
 * arte já escalada, deslocada, espelhada e marcada dentro dela. O outro lado
 * recebe uma imagem na proporção exata do papel e só precisa dizer ao Windows
 * qual papel é — não sobra o que negociar.
 *
 * A conta de onde a arte cai é a de `layout.ts`, a mesma que a prévia usa.
 * Prévia que mostra uma coisa e papel que sai outra é pior que não ter prévia.
 */

import {
  folhaEmMm,
  marcasDeCorte,
  marcasDeRegistro,
  posicionar,
  type Caixa,
  type Medida,
  type ModoDeEscala,
} from './layout';

export type Espelho = 'nao' | 'horizontal' | 'vertical';

export type Montagem = {
  papel: string;
  paisagem: boolean;
  /** Resolução do desenho. 300 é onde a diferença deixa de aparecer no papel. */
  dpi: number;
  escala: ModoDeEscala;
  porcento?: number;
  deslocaX?: number;
  deslocaY?: number;
  margemLados?: number;
  margemCima?: number;
  espelho?: Espelho;
  negativo?: boolean;
  marcasCorte?: boolean;
  marcasRegistro?: boolean;
};

/** O que a arte mede de verdade, em milímetros. */
export type Arte = Medida;

export type Plano = {
  /** A folha em pixels, que vira o tamanho do canvas. */
  folha: { largura: number; altura: number };
  /** Onde a arte entra, em pixels. */
  arte: { x: number; y: number; largura: number; altura: number };
  pontosPorMm: number;
};

const ESPESSURA_DA_MARCA_MM = 0.25;
const COMPRIMENTO_DA_MARCA_MM = 4;
const VAO_DA_MARCA_MM = 2;
const RAIO_DO_ALVO_MM = 1.5;
const AFASTAMENTO_DO_ALVO_MM = 6;

/**
 * O teto do desenho.
 *
 * Uma A3 a 600 DPI daria 70 megapixels, e o canvas do navegador recusa acima
 * de uns 268. Parar em 300 é onde a diferença deixa de aparecer no papel, e
 * de quebra mantém a folha dentro do que qualquer máquina aguenta.
 */
export const DPI_MAXIMO = 300;

export function resolucao(dpi: unknown): number {
  const lido = Number(dpi);
  if (!Number.isFinite(lido) || lido <= 0) return DPI_MAXIMO;
  return Math.min(Math.max(lido, 72), DPI_MAXIMO);
}

/**
 * A geometria da folha, sem tocar em canvas nenhum.
 *
 * Separada do desenho para poder ser conferida sozinha: é aqui que mora a
 * diferença entre a arte no tamanho certo e a arte encolhida no meio.
 */
export function planoDaFolha(arte: Arte, montagem: Montagem): Plano {
  const dpi = resolucao(montagem.dpi);
  const pontosPorMm = dpi / 25.4;
  const folha = folhaEmMm(montagem.papel, Boolean(montagem.paisagem));

  const caixa = posicionar(folha, arte, {
    escala: montagem.escala,
    porcento: montagem.porcento,
    deslocaX: montagem.deslocaX,
    deslocaY: montagem.deslocaY,
    margemLados: montagem.margemLados,
    margemCima: montagem.margemCima,
  });

  return {
    folha: {
      largura: Math.max(1, Math.round(folha.largura * pontosPorMm)),
      altura: Math.max(1, Math.round(folha.altura * pontosPorMm)),
    },
    arte: {
      x: caixa.x * pontosPorMm,
      y: caixa.y * pontosPorMm,
      largura: Math.max(1, caixa.largura * pontosPorMm),
      altura: Math.max(1, caixa.altura * pontosPorMm),
    },
    pontosPorMm,
  };
}

/**
 * Desenha a folha pronta para imprimir.
 *
 * `origem` é a página já rasterizada; `arte` é quanto ela mede de verdade, em
 * milímetros. As duas coisas são separadas de propósito: o tamanho do raster
 * depende da resolução do desenho, o tamanho da arte não — é o que está
 * escrito no PDF, e é ele que manda quando alguém pede "tamanho original".
 */
export function desenharFolha(
  origem: CanvasImageSource,
  arte: Arte,
  montagem: Montagem,
  destino: HTMLCanvasElement,
): Plano {
  const plano = planoDaFolha(arte, montagem);

  destino.width = plano.folha.largura;
  destino.height = plano.folha.altura;

  const pincel = destino.getContext('2d', { alpha: false });
  if (!pincel) throw new Error('Seu navegador bloqueou o canvas 2D, necessário para imprimir.');

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, destino.width, destino.height);
  pincel.imageSmoothingEnabled = true;
  pincel.imageSmoothingQuality = 'high';

  desenharArte(pincel, origem, plano, montagem);

  if (montagem.marcasCorte || montagem.marcasRegistro) {
    desenharMarcas(pincel, plano, montagem);
  }

  return plano;
}

function desenharArte(
  pincel: CanvasRenderingContext2D,
  origem: CanvasImageSource,
  plano: Plano,
  montagem: Montagem,
): void {
  const { x, y, largura, altura } = plano.arte;

  pincel.save();

  // O espelho vira o eixo em torno do centro da própria arte: espelhar em
  // torno do centro da folha moveria o trabalho de lugar, e quem imprime
  // transfer quer a mesma posição, ao contrário.
  if (montagem.espelho === 'horizontal' || montagem.espelho === 'vertical') {
    const centroX = x + largura / 2;
    const centroY = y + altura / 2;
    pincel.translate(centroX, centroY);
    pincel.scale(
      montagem.espelho === 'horizontal' ? -1 : 1,
      montagem.espelho === 'vertical' ? -1 : 1,
    );
    pincel.translate(-centroX, -centroY);
  }

  // Negativo só na arte, e não na folha: o papel em volta continua branco
  // porque é papel, e não parte do fotolito.
  if (montagem.negativo) pincel.filter = 'invert(1)';

  pincel.drawImage(origem, x, y, largura, altura);
  pincel.restore();
}

function desenharMarcas(
  pincel: CanvasRenderingContext2D,
  plano: Plano,
  montagem: Montagem,
): void {
  const mm = plano.pontosPorMm;
  const caixaEmMm: Caixa = {
    x: plano.arte.x / mm,
    y: plano.arte.y / mm,
    largura: plano.arte.largura / mm,
    altura: plano.arte.altura / mm,
  };

  pincel.save();
  pincel.fillStyle = '#000000';
  pincel.strokeStyle = '#000000';

  if (montagem.marcasCorte) {
    const espessura = Math.max(1, ESPESSURA_DA_MARCA_MM * mm);
    for (const traco of marcasDeCorte(caixaEmMm, COMPRIMENTO_DA_MARCA_MM, VAO_DA_MARCA_MM)) {
      const x1 = Math.min(traco.x1, traco.x2) * mm;
      const y1 = Math.min(traco.y1, traco.y2) * mm;
      const comprimento = Math.abs(traco.x2 - traco.x1) * mm;
      const altura = Math.abs(traco.y2 - traco.y1) * mm;
      pincel.fillRect(
        x1 - (comprimento === 0 ? espessura / 2 : 0),
        y1 - (altura === 0 ? espessura / 2 : 0),
        comprimento === 0 ? espessura : comprimento,
        altura === 0 ? espessura : altura,
      );
    }
  }

  if (montagem.marcasRegistro) {
    const espessura = Math.max(1, (ESPESSURA_DA_MARCA_MM * mm) / 1.5);
    const raio = RAIO_DO_ALVO_MM * mm;
    const braco = raio + 1 * mm;
    pincel.lineWidth = espessura;

    for (const alvo of marcasDeRegistro(caixaEmMm, AFASTAMENTO_DO_ALVO_MM)) {
      const cx = alvo.x * mm;
      const cy = alvo.y * mm;

      pincel.beginPath();
      pincel.arc(cx, cy, raio, 0, Math.PI * 2);
      pincel.stroke();

      pincel.beginPath();
      pincel.moveTo(cx - braco, cy);
      pincel.lineTo(cx + braco, cy);
      pincel.moveTo(cx, cy - braco);
      pincel.lineTo(cx, cy + braco);
      pincel.stroke();
    }
  }

  pincel.restore();
}

/** O tamanho de uma página de PDF em milímetros, a partir dos pontos dela. */
export function pontosParaMm(pontos: number): number {
  return (pontos / 72) * 25.4;
}
