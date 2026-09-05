/**
 * A reamostragem.
 *
 * Conta errada aqui não quebra: entrega uma imagem suave demais, ou com
 * serrilha, ou com faixas de brilho — e nada disso levanta erro. Só aparece
 * quando alguém imprime. Por isso cada propriedade é medida.
 */
import { describe, expect, it } from 'vitest';
import { lanczos, pesosDaLinha, realcar, recortar, redimensionar, type Bitmap } from './lanczos';

/** Um bitmap de cor sólida, para provar que a cor não muda. */
function solido(largura: number, altura: number, cor: [number, number, number, number]): Bitmap {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let i = 0; i < dados.length; i += 4) {
    dados[i] = cor[0];
    dados[i + 1] = cor[1];
    dados[i + 2] = cor[2];
    dados[i + 3] = cor[3];
  }
  return { dados, largura, altura };
}

/** Metade preta, metade branca: uma borda vertical bem no meio. */
function meioAMeio(largura: number, altura: number): Bitmap {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const tom = x < largura / 2 ? 0 : 255;
      const p = (y * largura + x) * 4;
      dados[p] = tom;
      dados[p + 1] = tom;
      dados[p + 2] = tom;
      dados[p + 3] = 255;
    }
  }
  return { dados, largura, altura };
}

const pixel = (b: Bitmap, x: number, y: number) => {
  const p = (y * b.largura + x) * 4;
  return [b.dados[p], b.dados[p + 1], b.dados[p + 2], b.dados[p + 3]];
};

describe('o núcleo', () => {
  it('vale 1 no centro e 0 fora da janela', () => {
    expect(lanczos(0, 3)).toBe(1);
    expect(lanczos(3, 3)).toBe(0);
    expect(lanczos(4, 3)).toBe(0);
  });

  it('zera nos inteiros dentro da janela, que é o que preserva o pixel original', () => {
    expect(lanczos(1, 3)).toBeCloseTo(0, 10);
    expect(lanczos(2, 3)).toBeCloseTo(0, 10);
  });

  it('tem lóbulo negativo, que é de onde vem a definição de borda', () => {
    expect(lanczos(1.5, 3)).toBeLessThan(0);
  });

  it('é simétrico', () => {
    expect(lanczos(-1.3, 3)).toBeCloseTo(lanczos(1.3, 3), 12);
  });
});

describe('os pesos', () => {
  it('cada janela soma 1, senão a imagem sai com faixas de brilho', () => {
    for (const [de, para] of [
      [100, 250],
      [250, 100],
      [37, 37],
      [1000, 83],
    ]) {
      for (const janela of pesosDaLinha(de, para)) {
        const soma = [...janela.pesos].reduce((s, p) => s + p, 0);
        expect(soma).toBeCloseTo(1, 5);
      }
    }
  });

  it('a janela cresce ao reduzir, para não jogar pixel fora', () => {
    const ampliando = pesosDaLinha(100, 400);
    const reduzindo = pesosDaLinha(400, 100);
    const media = (j: { pesos: Float32Array }[]) => j.reduce((s, x) => s + x.pesos.length, 0) / j.length;

    expect(media(reduzindo)).toBeGreaterThan(media(ampliando) * 2);
  });

  it('nunca sai da imagem', () => {
    for (const janela of pesosDaLinha(10, 100)) {
      expect(janela.inicio).toBeGreaterThanOrEqual(0);
      expect(janela.inicio + janela.pesos.length).toBeLessThanOrEqual(10);
    }
  });
});

describe('redimensionar', () => {
  it('cor sólida continua exatamente a mesma cor', () => {
    const grande = redimensionar(solido(20, 20, [200, 100, 50, 255]), 60, 60);

    expect(grande.largura).toBe(60);
    expect(grande.altura).toBe(60);
    expect(pixel(grande, 30, 30)).toEqual([200, 100, 50, 255]);
    expect(pixel(grande, 0, 0)).toEqual([200, 100, 50, 255]);
  });

  it('a medida pedida é a medida entregue', () => {
    const r = redimensionar(meioAMeio(64, 48), 123, 77);
    expect([r.largura, r.altura]).toEqual([123, 77]);
    expect(r.dados.length).toBe(123 * 77 * 4);
  });

  it('mesma medida devolve a mesma imagem, sem trabalho à toa', () => {
    const origem = meioAMeio(30, 30);
    expect(redimensionar(origem, 30, 30)).toBe(origem);
  });

  it('a borda continua no meio depois de ampliar', () => {
    const grande = redimensionar(meioAMeio(40, 8), 160, 32);

    expect(pixel(grande, 10, 16)[0]).toBeLessThan(40); // lado escuro
    expect(pixel(grande, 150, 16)[0]).toBeGreaterThan(215); // lado claro
  });

  it('a transição é mais curta que a de uma interpolação mole', () => {
    // Lanczos passa de escuro a claro em poucos pixels. Uma bilinear
    // esticada espalharia isso por dezenas.
    const grande = redimensionar(meioAMeio(40, 4), 400, 4);
    let transicao = 0;
    for (let x = 0; x < 400; x += 1) {
      const tom = pixel(grande, x, 2)[0];
      if (tom > 20 && tom < 235) transicao += 1;
    }
    expect(transicao).toBeLessThan(30);
  });

  it('reduzir não estoura nem devolve medida zero', () => {
    const pequena = redimensionar(meioAMeio(1000, 1000), 3, 3);
    expect([pequena.largura, pequena.altura]).toEqual([3, 3]);
    for (const v of pequena.dados) expect(Number.isFinite(v)).toBe(true);
  });

  it('preserva a transparência', () => {
    const meio = redimensionar(solido(10, 10, [255, 0, 0, 128]), 20, 20);
    expect(pixel(meio, 10, 10)[3]).toBe(128);
  });
});

describe('realçar', () => {
  it('força zero não mexe em nada', () => {
    const origem = meioAMeio(20, 20);
    expect(realcar(origem, 0)).toBe(origem);
  });

  it('aumenta o contraste na borda', () => {
    const origem = meioAMeio(20, 20);
    const nitida = realcar(origem, 1.2);

    // O pixel claro logo depois da borda fica mais claro ainda.
    const antes = pixel(origem, 10, 10)[0];
    const depois = pixel(nitida, 10, 10)[0];
    expect(depois).toBeGreaterThanOrEqual(antes);
  });

  it('não inventa granulado na área lisa', () => {
    const liso = solido(30, 30, [128, 128, 128, 255]);
    const nitido = realcar(liso, 1.5);
    expect(pixel(nitido, 15, 15)).toEqual([128, 128, 128, 255]);
  });

  it('o limiar segura o ruído fraco', () => {
    const quase = solido(30, 30, [128, 128, 128, 255]);
    // Um pixel dois tons acima: abaixo do limiar padrão de 3.
    const p = (15 * 30 + 15) * 4;
    quase.dados[p] = 130;
    const nitido = realcar(quase, 2, 3);
    expect(nitido.dados[p]).toBe(130);
  });
});

describe('recortar', () => {
  it('copia o pedaço sem alterar um pixel sequer', () => {
    const origem = meioAMeio(100, 100);
    const pedaco = recortar(origem, 60, 20, 30, 30);

    expect([pedaco.largura, pedaco.altura]).toEqual([30, 30]);
    // Tudo à direita do meio é branco, e continua branco.
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        expect(pixel(pedaco, x, y)).toEqual([255, 255, 255, 255]);
      }
    }
  });

  it('o recorte que passa da borda é aparado, e não estoura', () => {
    const pedaco = recortar(meioAMeio(50, 50), 40, 40, 100, 100);
    expect([pedaco.largura, pedaco.altura]).toEqual([10, 10]);
  });

  it('coordenada negativa vira zero', () => {
    const pedaco = recortar(meioAMeio(50, 50), -10, -10, 20, 20);
    expect([pedaco.largura, pedaco.altura]).toEqual([20, 20]);
  });

  it('nunca devolve recorte vazio', () => {
    const pedaco = recortar(meioAMeio(50, 50), 49, 49, 0, 0);
    expect(pedaco.largura).toBeGreaterThanOrEqual(1);
    expect(pedaco.altura).toBeGreaterThanOrEqual(1);
  });
});
