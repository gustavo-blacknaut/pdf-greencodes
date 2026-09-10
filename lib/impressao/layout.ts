/**
 * Onde a arte cai na folha, em milímetros.
 *
 * A conta mora aqui, sozinha, porque duas telas precisam dela e precisam
 * concordar: a prévia, que desenha a folha na tela, e o HTML que vai para a
 * impressora. Prévia que mostra uma coisa e papel que sai outra é pior que
 * não ter prévia — a pessoa confia e imprime a tiragem.
 *
 * Tudo em milímetro, e nada em pixel. Pixel depende de resolução; milímetro é
 * o que sai da guilhotina.
 */

export type Medida = { largura: number; altura: number };
export type Caixa = { x: number; y: number; largura: number; altura: number };

/**
 * Os papéis, em milímetros e sempre em pé.
 *
 * Deitar é decisão de quem imprime, e vem separada: papel tem medida, não
 * orientação. Misturar as duas coisas foi exatamente o defeito que fez a arte
 * sair encolhida no meio da folha.
 */
export const PAPEIS: Record<string, Medida> = {
  A3: { largura: 297, altura: 420 },
  A4: { largura: 210, altura: 297 },
  A5: { largura: 148, altura: 210 },
  Legal: { largura: 216, altura: 356 },
  Letter: { largura: 216, altura: 279 },
  Tabloid: { largura: 279, altura: 432 },
};

/** A folha escolhida, já deitada se for o caso. */
export function folhaEmMm(papel: string, deitada: boolean): Medida {
  const medida = PAPEIS[papel] ?? PAPEIS.A4;
  return deitada ? { largura: medida.altura, altura: medida.largura } : { ...medida };
}

export type ModoDeEscala =
  /** Cabe inteira dentro da margem, sem cortar nada. */
  | 'pagina'
  /** Ocupa tudo, cortando o que passar. */
  | 'preencher'
  /** Tamanho de verdade, um por um. */
  | 'original'
  /** A porcentagem que a pessoa escrever. */
  | 'porcento';

export type Ajuste = {
  escala: ModoDeEscala;
  /** Vale só no modo porcentagem. 100 é o tamanho original. */
  porcento?: number;
  /** Deslocamento a partir do centro, em milímetros. Positivo vai para a direita e para baixo. */
  deslocaX?: number;
  deslocaY?: number;
  margemLados?: number;
  margemCima?: number;
};

const limitar = (valor: unknown, minimo: number, maximo: number, padrao: number): number => {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
};

/**
 * A caixa da arte na folha.
 *
 * O centro é o padrão porque é o que a impressora faz sozinha, e porque é o
 * que quase todo trabalho quer. O deslocamento parte dali: quem precisa de
 * "3 mm mais para a esquerda" pensa em relação ao centro, não em relação ao
 * canto do papel.
 *
 * O resultado pode sair **fora** da folha, e isso é de propósito: com escala
 * grande ou deslocamento grande, a arte passa da borda mesmo. Quem chama
 * decide se corta, se avisa ou se deixa — e `sobra` diz quanto passou.
 */
export function posicionar(folha: Medida, arte: Medida, ajuste: Ajuste): Caixa {
  const margemLados = limitar(ajuste.margemLados, 0, 100, 0);
  const margemCima = limitar(ajuste.margemCima, 0, 100, 0);

  const disponivel: Medida = {
    largura: Math.max(1, folha.largura - margemLados * 2),
    altura: Math.max(1, folha.altura - margemCima * 2),
  };

  const fator = fatorDeEscala(disponivel, arte, ajuste);
  const largura = arte.largura * fator;
  const altura = arte.altura * fator;

  return {
    x: (folha.largura - largura) / 2 + limitar(ajuste.deslocaX, -1000, 1000, 0),
    y: (folha.altura - altura) / 2 + limitar(ajuste.deslocaY, -1000, 1000, 0),
    largura,
    altura,
  };
}

/** Quanto a arte é multiplicada, conforme o modo escolhido. */
export function fatorDeEscala(disponivel: Medida, arte: Medida, ajuste: Ajuste): number {
  if (arte.largura <= 0 || arte.altura <= 0) return 1;

  switch (ajuste.escala) {
    case 'preencher':
      return Math.max(disponivel.largura / arte.largura, disponivel.altura / arte.altura);
    case 'original':
      return 1;
    case 'porcento':
      return limitar(ajuste.porcento, 1, 1000, 100) / 100;
    default:
      return Math.min(disponivel.largura / arte.largura, disponivel.altura / arte.altura);
  }
}

/**
 * Quanto a arte passou de cada borda da folha, em milímetros.
 *
 * Serve para avisar antes de imprimir. Zero em todos quer dizer que cabe.
 */
export function sobra(folha: Medida, caixa: Caixa) {
  return {
    esquerda: Math.max(0, -caixa.x),
    direita: Math.max(0, caixa.x + caixa.largura - folha.largura),
    cima: Math.max(0, -caixa.y),
    baixo: Math.max(0, caixa.y + caixa.altura - folha.altura),
  };
}

export function passaDaFolha(folha: Medida, caixa: Caixa): boolean {
  const fora = sobra(folha, caixa);
  // Meio milímetro é ruído de arredondamento, e não vazamento de verdade.
  return Math.max(fora.esquerda, fora.direita, fora.cima, fora.baixo) > 0.5;
}

// --------------------------------------------------------------- marcas ---

export type Traco = { x1: number; y1: number; x2: number; y2: number };

/**
 * As marcas de corte dos quatro cantos da arte.
 *
 * São oito riscos, dois por canto, e **nenhum encosta na arte**: o vão existe
 * para a marca não aparecer no trabalho cortado. Marca desenhada em cima do
 * corte é marca impressa no produto.
 *
 * Cada risco fica do lado de fora da caixa, o que exige espaço na folha. Sem
 * margem, não há onde desenhar — e `marcasDeCorte` devolve lista vazia em vez
 * de riscar por cima da arte.
 */
export function marcasDeCorte(caixa: Caixa, comprimento = 4, vao = 2): Traco[] {
  const { x, y, largura, altura } = caixa;
  const direita = x + largura;
  const baixo = y + altura;

  const tracos: Traco[] = [];
  const horizontal = (px: number, py: number, sentido: number) =>
    tracos.push({ x1: px + vao * sentido, y1: py, x2: px + (vao + comprimento) * sentido, y2: py });
  const vertical = (px: number, py: number, sentido: number) =>
    tracos.push({ x1: px, y1: py + vao * sentido, x2: px, y2: py + (vao + comprimento) * sentido });

  // Canto de cima à esquerda, depois os outros três, no sentido do relógio.
  horizontal(x, y, -1);
  vertical(x, y, -1);
  horizontal(direita, y, 1);
  vertical(direita, y, -1);
  horizontal(direita, baixo, 1);
  vertical(direita, baixo, 1);
  horizontal(x, baixo, -1);
  vertical(x, baixo, 1);

  return tracos;
}

/**
 * Onde ficam os alvos de registro, no meio de cada lado.
 *
 * Só servem em impressão de mais de uma chapa: é neles que o impressor vê se
 * as cores estão alinhadas. Em impressão digital não fazem falta nenhuma, e
 * por isso não vêm ligados.
 */
export function marcasDeRegistro(caixa: Caixa, afastamento = 6): { x: number; y: number }[] {
  const meioX = caixa.x + caixa.largura / 2;
  const meioY = caixa.y + caixa.altura / 2;
  return [
    { x: meioX, y: caixa.y - afastamento },
    { x: meioX, y: caixa.y + caixa.altura + afastamento },
    { x: caixa.x - afastamento, y: meioY },
    { x: caixa.x + caixa.largura + afastamento, y: meioY },
  ];
}

/**
 * O tamanho de uma imagem em milímetros, sabendo a resolução dela.
 *
 * As páginas chegam como imagem rasterizada num DPI conhecido. Sem esta
 * conversão não há como falar em "tamanho original" nem em porcentagem — só
 * em "cabe" e "não cabe".
 */
export function pixelsParaMm(pixels: number, dpi: number): number {
  /*
   * Resolução sem sentido cai no padrão, e não no mínimo.
   *
   * Prender entre 1 e 4800 parece seguro e não é: um DPI vindo como zero
   * viraria 1, e 600 pixels a 1 DPI dão quinze metros de papel. Zero não é
   * uma resolução pequena — é a ausência de resolução, e o certo é usar a
   * de referência.
   */
  const lido = Number(dpi);
  const resolucao = Number.isFinite(lido) && lido > 0 ? Math.min(lido, 4800) : 300;
  return (pixels / resolucao) * 25.4;
}
