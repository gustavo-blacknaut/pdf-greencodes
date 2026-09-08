/**
 * O tratamento de pixel, conferido em imagens pequenas e conhecidas.
 *
 * Imagem de 4x4 montada à mão vale mais que foto de verdade aqui: dá para
 * saber o valor exato que cada pixel tem que ter no fim, e um erro de sinal
 * ou de índice aparece como número errado em vez de "ficou meio esquisito".
 */
import { describe, expect, it } from 'vitest';
import {
  ajustar,
  corDaBorda,
  corDoTexto,
  emoldurar,
  girar,
  histogramaDeBrilho,
  limiarDeOtsu,
  limparDigitalizacao,
  luminancia,
  percentil,
  removerFundo,
  trocarCor,
} from './pixels';
import type { Bitmap } from './lanczos';

/** Monta um bitmap a partir de uma lista de cores, linha por linha. */
function bitmap(largura: number, altura: number, cor: (x: number, y: number) => number[]): Bitmap {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const [r, g, b, a = 255] = cor(x, y);
      const i = (y * largura + x) * 4;
      dados[i] = r;
      dados[i + 1] = g;
      dados[i + 2] = b;
      dados[i + 3] = a;
    }
  }
  return { dados, largura, altura };
}

const pixel = (imagem: Bitmap, x: number, y: number) => {
  const i = (y * imagem.largura + x) * 4;
  return [imagem.dados[i], imagem.dados[i + 1], imagem.dados[i + 2], imagem.dados[i + 3]];
};

const cheio = (largura: number, altura: number, cor: number[]) => bitmap(largura, altura, () => cor);

describe('luminância', () => {
  it('pesa o verde mais que o azul, como o olho', () => {
    expect(luminancia(0, 255, 0)).toBeGreaterThan(luminancia(0, 0, 255));
    expect(luminancia(255, 0, 0)).toBeGreaterThan(luminancia(0, 0, 255));
  });

  it('o cinza sai igual ao próprio valor', () => {
    expect(Math.round(luminancia(128, 128, 128))).toBe(128);
  });
});

describe('ajustes', () => {
  it('sem ajuste nenhum, a imagem sai igual', () => {
    const original = bitmap(3, 3, (x, y) => [x * 40, y * 40, 100]);
    const saida = ajustar(original, {});
    expect(Array.from(saida.dados)).toEqual(Array.from(original.dados));
  });

  it('não estraga a entrada de quem chamou', () => {
    const original = cheio(2, 2, [100, 100, 100]);
    const antes = Array.from(original.dados);
    ajustar(original, { brilho: 50 });
    expect(Array.from(original.dados)).toEqual(antes);
  });

  it('brilho positivo clareia e negativo escurece', () => {
    const original = cheio(2, 2, [100, 100, 100]);
    expect(pixel(ajustar(original, { brilho: 20 }), 0, 0)[0]).toBeGreaterThan(100);
    expect(pixel(ajustar(original, { brilho: -20 }), 0, 0)[0]).toBeLessThan(100);
  });

  it('contraste afasta o claro do escuro', () => {
    const original = bitmap(2, 1, (x) => (x === 0 ? [80, 80, 80] : [180, 180, 180]));
    const saida = ajustar(original, { contraste: 40 });
    expect(pixel(saida, 0, 0)[0]).toBeLessThan(80);
    expect(pixel(saida, 1, 0)[0]).toBeGreaterThan(180);
  });

  it('contraste negativo aproxima o claro do escuro', () => {
    // A fórmula satura em -255, não em -100: no mínimo a imagem fica lavada,
    // e não chapada num cinza só.
    const original = bitmap(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    const saida = ajustar(original, { contraste: -100 });
    const distancia = pixel(saida, 1, 0)[0] - pixel(saida, 0, 0)[0];
    expect(distancia).toBeGreaterThan(0);
    expect(distancia).toBeLessThan(255 / 2);
  });

  it('saturação no mínimo tira toda a cor', () => {
    const saida = ajustar(cheio(2, 2, [200, 50, 50]), { saturacao: -100 });
    const [r, g, b] = pixel(saida, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('saturação positiva afasta o canal da média', () => {
    const saida = ajustar(cheio(2, 2, [200, 50, 50]), { saturacao: 50 });
    expect(pixel(saida, 0, 0)[0]).toBeGreaterThan(200);
  });

  it('gama acima de 1 clareia o meio-tom sem mexer nas pontas', () => {
    // A convenção é a do ImageMagick: saída = entrada ^ (1/gama). Preto
    // continua preto e branco continua branco em qualquer gama — o que muda
    // é só o caminho entre os dois.
    const tons = [0, 128, 255];
    const original = bitmap(3, 1, (x) => [tons[x], tons[x], tons[x]]);

    const claro = ajustar(original, { gama: 2 });
    expect(pixel(claro, 0, 0)[0]).toBe(0);
    expect(pixel(claro, 1, 0)[0]).toBeGreaterThan(128);
    expect(pixel(claro, 2, 0)[0]).toBe(255);

    const escuro = ajustar(original, { gama: 0.5 });
    expect(pixel(escuro, 1, 0)[0]).toBeLessThan(128);
  });

  it('não deixa o valor sair da faixa nem no extremo', () => {
    const saida = ajustar(cheio(2, 2, [250, 250, 250]), { brilho: 100, contraste: 100 });
    for (const valor of pixel(saida, 0, 0)) expect(valor).toBeLessThanOrEqual(255);
  });

  it('preserva o canal alfa', () => {
    const saida = ajustar(cheio(2, 2, [100, 100, 100, 77]), { brilho: 40, contraste: 30 });
    expect(pixel(saida, 0, 0)[3]).toBe(77);
  });
});

describe('cor', () => {
  it('o cinza iguala os três canais', () => {
    const saida = trocarCor(cheio(2, 2, [200, 100, 50]), 'cinza');
    const [r, g, b] = pixel(saida, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('o sépia puxa para o quente: mais vermelho que azul', () => {
    const saida = trocarCor(cheio(2, 2, [128, 128, 128]), 'sepia');
    const [r, , b] = pixel(saida, 0, 0);
    expect(r).toBeGreaterThan(b);
  });

  it('o preto e branco só devolve 0 e 255', () => {
    const original = bitmap(4, 4, (x, y) => {
      const v = (x + y) * 30;
      return [v, v, v];
    });
    const saida = trocarCor(original, 'pb');
    for (let i = 0; i < saida.dados.length; i += 4) {
      expect([0, 255]).toContain(saida.dados[i]);
    }
  });
});

describe('o limiar do Otsu', () => {
  it('cai entre os dois grupos de uma imagem de dois tons', () => {
    // O limiar é o último tom do grupo escuro, então o piso é o próprio 40.
    const histograma = new Uint32Array(256);
    histograma[40] = 500;
    histograma[200] = 500;
    const limiar = limiarDeOtsu(histograma);
    expect(limiar).toBeGreaterThanOrEqual(40);
    expect(limiar).toBeLessThan(200);
  });

  it('acha o corte mesmo com o fundo cinza, onde 128 falharia', () => {
    // Texto escuro sobre papel cinza-claro: o caso da digitalização de
    // verdade. Com limiar fixo em 128 a folha inteira sairia preta.
    const histograma = new Uint32Array(256);
    histograma[90] = 100; // a tinta
    histograma[160] = 900; // o papel
    const limiar = limiarDeOtsu(histograma);
    expect(limiar).toBeGreaterThanOrEqual(90);
    expect(limiar).toBeLessThan(160);
  });

  it('o tom escuro vira preto e o claro vira branco, e não o contrário', () => {
    // O limiar é o último tom do grupo escuro, então a comparação tem que ser
    // estrita. Com `>=` o tom mais escuro da imagem sairia branco — a página
    // inteira invertida, e o teste do limiar sozinho não pegaria isso.
    const duasFaixas = bitmap(4, 2, (_x, y) => (y === 0 ? [60, 60, 60] : [200, 200, 200]));
    const saida = trocarCor(duasFaixas, 'pb');
    expect(pixel(saida, 0, 0)[0], 'a tinta').toBe(0);
    expect(pixel(saida, 0, 1)[0], 'o papel').toBe(255);
  });

  it('não estoura com histograma vazio', () => {
    expect(limiarDeOtsu(new Uint32Array(256))).toBe(128);
  });

  it('o histograma conta um pixel para cada pixel da imagem', () => {
    const total = histogramaDeBrilho(cheio(4, 5, [10, 10, 10])).reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
  });
});

describe('giro', () => {
  const original = bitmap(3, 2, (x, y) => [x * 10, y * 10, 0]);

  it('90 graus troca largura por altura', () => {
    const saida = girar(original, 90);
    expect(saida.largura).toBe(2);
    expect(saida.altura).toBe(3);
  });

  it('quatro giros de 90 voltam ao original, pixel por pixel', () => {
    let atual = original;
    for (let i = 0; i < 4; i += 1) atual = girar(atual, 90);
    expect(Array.from(atual.dados)).toEqual(Array.from(original.dados));
  });

  it('180 é o mesmo que dois de 90', () => {
    expect(Array.from(girar(original, 180).dados)).toEqual(Array.from(girar(girar(original, 90), 90).dados));
  });

  it('leva o canto de cima à esquerda para o de cima à direita', () => {
    // É a conferência que diz se o giro é horário ou anti-horário — trocar o
    // sinal aqui é o erro que só aparece com a folha na mão.
    const marcado = bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 0]));
    expect(pixel(girar(marcado, 90), 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('espelhar na horizontal inverte as colunas', () => {
    const marcado = bitmap(2, 1, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255]));
    const saida = girar(marcado, 0, 'horizontal');
    expect(pixel(saida, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it('espelhar na vertical inverte as linhas', () => {
    const marcado = bitmap(1, 2, (_x, y) => (y === 0 ? [255, 0, 0] : [0, 0, 255]));
    const saida = girar(marcado, 0, 'vertical');
    expect(pixel(saida, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it('sem giro e sem espelho, devolve igual', () => {
    expect(Array.from(girar(original, 0).dados)).toEqual(Array.from(original.dados));
  });
});

describe('remover fundo', () => {
  it('acha a cor do fundo pela borda, e não pelo meio', () => {
    // Fundo branco com um quadrado preto no centro: a borda é branca.
    const imagem = bitmap(5, 5, (x, y) => (x > 0 && x < 4 && y > 0 && y < 4 ? [0, 0, 0] : [255, 255, 255]));
    expect(corDaBorda(imagem)).toEqual([255, 255, 255]);
  });

  it('a mediana aguenta um pixel intruso na borda', () => {
    const imagem = bitmap(5, 5, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [250, 250, 250]));
    expect(corDaBorda(imagem)).toEqual([250, 250, 250]);
  });

  it('apaga o fundo e deixa o desenho', () => {
    const imagem = bitmap(5, 5, (x, y) => (x === 2 && y === 2 ? [0, 0, 0] : [255, 255, 255]));
    const { imagem: saida } = removerFundo(imagem, { tolerancia: 10, suavizar: false });
    expect(pixel(saida, 0, 0)[3]).toBe(0);
    expect(pixel(saida, 2, 2)[3]).toBe(255);
  });

  it('não apaga o branco de dentro do desenho', () => {
    /*
     * É a diferença entre esta ferramenta e "apagar tudo que for branco". O
     * miolo de um "O" é branco, e tem que continuar lá — senão a logo sai
     * furada quando for para cima de um fundo colorido.
     *
     *   . . . . .      . = fundo branco (sai)
     *   . # # # .      # = traço preto  (fica)
     *   . # o # .      o = miolo branco (fica)
     *   . # # # .
     *   . . . . .
     */
    const anel = bitmap(5, 5, (x, y) => {
      const naMoldura = x === 0 || y === 0 || x === 4 || y === 4;
      const noMiolo = x === 2 && y === 2;
      return naMoldura || noMiolo ? [255, 255, 255] : [0, 0, 0];
    });
    const { imagem: saida } = removerFundo(anel, { tolerancia: 10, suavizar: false });
    expect(pixel(saida, 0, 0)[3], 'a moldura sai').toBe(0);
    expect(pixel(saida, 2, 2)[3], 'o miolo fica').toBe(255);
  });

  it('a tolerância decide quanto do quase-branco vai junto', () => {
    const comSombra = bitmap(5, 5, (x, y) => {
      if (x === 2 && y === 2) return [0, 0, 0];
      return x === 0 ? [230, 230, 230] : [255, 255, 255];
    });
    const apertado = removerFundo(comSombra, { tolerancia: 5, suavizar: false });
    const folgado = removerFundo(comSombra, { tolerancia: 40, suavizar: false });
    expect(folgado.apagados).toBeGreaterThan(apertado.apagados);
  });

  it('conta quantos pixels saíram', () => {
    const imagem = cheio(4, 4, [255, 255, 255]);
    const { apagados } = removerFundo(imagem, { tolerancia: 10, suavizar: false });
    expect(apagados).toBe(16);
  });

  it('suavizar mexe só no alfa, nunca na cor', () => {
    const imagem = bitmap(5, 5, (x, y) => (x === 2 && y === 2 ? [10, 20, 30] : [255, 255, 255]));
    const { imagem: saida } = removerFundo(imagem, { tolerancia: 10, suavizar: true });
    expect(pixel(saida, 2, 2).slice(0, 3)).toEqual([10, 20, 30]);
  });
});

describe('limpar digitalização', () => {
  it('leva o papel cinza para o branco', () => {
    // Uma folha cinza-clara com uma linha de texto escuro.
    const digitalizada = bitmap(10, 10, (_x, y) => (y === 5 ? [70, 70, 70] : [210, 210, 210]));
    const saida = limparDigitalizacao(digitalizada, 1);
    expect(pixel(saida, 0, 0)[0]).toBeGreaterThan(240);
  });

  it('escurece a tinta em vez de apagá-la junto', () => {
    const digitalizada = bitmap(10, 10, (_x, y) => (y === 5 ? [70, 70, 70] : [210, 210, 210]));
    const saida = limparDigitalizacao(digitalizada, 1);
    expect(pixel(saida, 0, 5)[0]).toBeLessThan(70);
  });

  it('tira o amarelado do papel velho, canal por canal', () => {
    // Papel amarelado: azul mais baixo que os outros dois. Depois de limpar,
    // o fundo tem que ficar neutro — e não amarelo mais claro.
    const amarelada = bitmap(10, 10, (_x, y) => (y === 5 ? [60, 55, 40] : [225, 215, 180]));
    const saida = limparDigitalizacao(amarelada, 1);
    const [r, g, b] = pixel(saida, 0, 0);
    expect(Math.abs(r - b)).toBeLessThan(Math.abs(225 - 180));
    expect(g).toBeGreaterThan(200);
  });

  it('força zero devolve a imagem como estava', () => {
    const original = bitmap(6, 6, (x, y) => [200 + x, 190 + y, 180]);
    const saida = limparDigitalizacao(original, 0);
    expect(Array.from(saida.dados)).toEqual(Array.from(original.dados));
  });

  it('folha em branco vira folha branca, e não uma página preta', () => {
    /*
     * O caso do verso da folha, que sai do scanner cinza e sem nada escrito.
     * Como o ponto de branco e o de preto caem no mesmo tom, a conta de
     * esticar mandaria o papel inteiro para zero — uma página preta, que é o
     * pior resultado possível e gasta um cartucho.
     */
    const chapada = cheio(6, 6, [128, 128, 128]);
    const saida = limparDigitalizacao(chapada, 1);
    expect(pixel(saida, 0, 0)[0]).toBe(255);
  });

  it('a folha quase em branco também não escurece', () => {
    // Uma sujeirinha de nada não é faixa de tom suficiente para esticar.
    const quaseLimpa = bitmap(10, 10, (x, y) => (x === 9 && y === 9 ? [120, 120, 120] : [200, 200, 200]));
    const saida = limparDigitalizacao(quaseLimpa, 1);
    expect(pixel(saida, 0, 0)[0]).toBeGreaterThanOrEqual(200);
  });
});

describe('percentil', () => {
  it('acha o valor onde a contagem passa da fração', () => {
    const histograma = new Uint32Array(256);
    histograma[10] = 90;
    histograma[200] = 10;
    expect(percentil(histograma, 0.5)).toBe(10);
    expect(percentil(histograma, 0.97)).toBe(200);
  });

  it('não estoura com histograma vazio', () => {
    expect(percentil(new Uint32Array(256), 0.97)).toBe(255);
    expect(percentil(new Uint32Array(256), 0.02)).toBe(0);
  });
});

describe('moldura', () => {
  it('cresce dos dois lados em cada eixo', () => {
    const saida = emoldurar(cheio(4, 6, [0, 0, 0]), 3, [255, 255, 255, 255]);
    expect(saida.largura).toBe(10);
    expect(saida.altura).toBe(12);
  });

  it('põe a cor pedida na borda e a imagem no meio', () => {
    const saida = emoldurar(cheio(2, 2, [10, 20, 30]), 1, [200, 100, 50, 255]);
    expect(pixel(saida, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(saida, 1, 1)).toEqual([10, 20, 30, 255]);
  });

  it('espessura zero devolve uma cópia intacta', () => {
    const original = cheio(3, 3, [1, 2, 3]);
    const saida = emoldurar(original, 0, [0, 0, 0, 255]);
    expect(saida.largura).toBe(3);
    expect(Array.from(saida.dados)).toEqual(Array.from(original.dados));
  });
});

describe('cor escrita em texto', () => {
  it.each([
    ['#ffffff', [255, 255, 255, 255]],
    ['000000', [0, 0, 0, 255]],
    ['#FF8800', [255, 136, 0, 255]],
  ])('lê %s', (texto, esperado) => {
    expect(corDoTexto(texto)).toEqual(esperado);
  });

  it('cai no padrão quando o texto não é cor', () => {
    expect(corDoTexto('azul')).toEqual([255, 255, 255, 255]);
    expect(corDoTexto('')).toEqual([255, 255, 255, 255]);
    expect(corDoTexto(undefined, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });
});
