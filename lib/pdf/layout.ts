/**
 * Conversão entre as coordenadas da tela e as do PDF.
 *
 * O editor guarda posição e tamanho como fração da página (0 a 1). Assim o
 * mesmo elemento vale para qualquer zoom do preview e para qualquer tamanho de
 * página, sem recalcular nada quando a tela muda.
 *
 * Os dois sistemas discordam em duas coisas, e é daí que vem todo erro de
 * posicionamento: a tela mede do topo para baixo, o PDF mede da base para cima;
 * e a tela ancora o elemento pelo canto superior esquerdo, o PDF pelo inferior
 * esquerdo.
 */

export type Retangulo = {
  /** Fração da largura da página, do canto esquerdo. */
  x: number;
  /** Fração da altura da página, do topo. */
  y: number;
  largura: number;
  altura: number;
};

export type CaixaPdf = { x: number; y: number; largura: number; altura: number };

export function paraCoordenadasPdf(
  retangulo: Retangulo,
  paginaLargura: number,
  paginaAltura: number,
): CaixaPdf {
  const largura = retangulo.largura * paginaLargura;
  const altura = retangulo.altura * paginaAltura;
  return {
    x: retangulo.x * paginaLargura,
    y: paginaAltura - retangulo.y * paginaAltura - altura,
    largura,
    altura,
  };
}

/** Mantém o elemento inteiro dentro da página ao arrastar ou redimensionar. */
export function limitarAPagina(retangulo: Retangulo): Retangulo {
  const largura = Math.min(Math.max(retangulo.largura, 0.01), 1);
  const altura = Math.min(Math.max(retangulo.altura, 0.01), 1);
  return {
    largura,
    altura,
    x: Math.min(Math.max(retangulo.x, 0), 1 - largura),
    y: Math.min(Math.max(retangulo.y, 0), 1 - altura),
  };
}

/** #RRGGBB para os três canais de 0 a 1 que o pdf-lib espera. */
export function hexParaRgb(hex: string): { r: number; g: number; b: number } {
  const limpo = hex.replace('#', '').trim();
  const completo =
    limpo.length === 3
      ? limpo
          .split('')
          .map((c) => c + c)
          .join('')
      : limpo;

  if (!/^[0-9a-fA-F]{6}$/.test(completo)) return { r: 0, g: 0, b: 0 };

  return {
    r: parseInt(completo.slice(0, 2), 16) / 255,
    g: parseInt(completo.slice(2, 4), 16) / 255,
    b: parseInt(completo.slice(4, 6), 16) / 255,
  };
}

/**
 * Recorta a área realmente desenhada de um traço, para a assinatura não vir
 * com uma moldura enorme de pixels transparentes em volta.
 */
export function recortarTransparente(
  origem: HTMLCanvasElement,
  margem = 6,
): HTMLCanvasElement | null {
  const ctx = origem.getContext('2d');
  if (!ctx) return null;

  const { width, height } = origem;
  const dados = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dados[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // nada foi desenhado

  const x0 = Math.max(0, minX - margem);
  const y0 = Math.max(0, minY - margem);
  const x1 = Math.min(width, maxX + margem + 1);
  const y1 = Math.min(height, maxY + margem + 1);

  const recorte = document.createElement('canvas');
  recorte.width = x1 - x0;
  recorte.height = y1 - y0;
  recorte.getContext('2d')?.drawImage(origem, x0, y0, recorte.width, recorte.height, 0, 0, recorte.width, recorte.height);
  return recorte;
}
