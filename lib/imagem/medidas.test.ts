/**
 * As contas de imagem.
 *
 * Medida errada não quebra: entrega uma imagem bonita no tamanho errado, e
 * isso só aparece depois de impressa. Por isso cada conta é provada aqui,
 * sem canvas no meio.
 */
import { describe, expect, it } from 'vitest';
import {
  bytesDoAlvo,
  dpiNaImpressao,
  encaixar,
  formatoValido,
  nomeNoFormato,
  pixelsParaImprimir,
  proximaQualidade,
  semAumentar,
} from './medidas';

describe('milímetro e DPI', () => {
  it('10x15 cm a 300 DPI dá 1181x1772 px', () => {
    expect(pixelsParaImprimir(100, 300)).toBe(1181);
    expect(pixelsParaImprimir(150, 300)).toBe(1772);
  });

  it('uma polegada a 300 DPI dá 300 px, por definição', () => {
    expect(pixelsParaImprimir(25.4, 300)).toBe(300);
  });

  it('a volta responde se a foto do cliente aguenta o tamanho', () => {
    // Uma foto de 800 px numa faixa de 1 metro sai com 20 DPI.
    expect(dpiNaImpressao(800, 1000)).toBe(20);
    // A mesma foto num 3x4 sai com folga.
    expect(dpiNaImpressao(800, 30)).toBe(677);
  });

  it('medida zero não estoura', () => {
    expect(dpiNaImpressao(800, 0)).toBe(0);
  });
});

describe('encaixar', () => {
  const foto = { largura: 4000, altura: 3000 }; // 4:3 deitada

  it('só a largura: a altura acompanha a proporção', () => {
    expect(encaixar(foto, { largura: 800 })).toEqual({ largura: 800, altura: 600 });
  });

  it('só a altura: a largura acompanha', () => {
    expect(encaixar(foto, { altura: 600 })).toEqual({ largura: 800, altura: 600 });
  });

  it('cabe: entra inteira e pode sobrar borda', () => {
    // Num quadrado de 1000, a foto deitada entra pela largura.
    expect(encaixar(foto, { largura: 1000, altura: 1000 }, 'cabe')).toEqual({ largura: 1000, altura: 750 });
  });

  it('preenche: cobre o quadro e o resto é aparado', () => {
    expect(encaixar(foto, { largura: 1000, altura: 1000 }, 'preenche')).toEqual({ largura: 1333, altura: 1000 });
  });

  it('esticar: usa a medida exata, deformando', () => {
    expect(encaixar(foto, { largura: 1000, altura: 1000 }, 'esticar')).toEqual({ largura: 1000, altura: 1000 });
  });

  it('nunca devolve zero pixel', () => {
    const minusculo = encaixar(foto, { largura: 1, altura: 1 }, 'cabe');
    expect(minusculo.largura).toBeGreaterThanOrEqual(1);
    expect(minusculo.altura).toBeGreaterThanOrEqual(1);
  });

  it('imagem vazia devolve vazio em vez de dividir por zero', () => {
    expect(encaixar({ largura: 0, altura: 0 }, { largura: 100 })).toEqual({ largura: 0, altura: 0 });
  });
});

describe('não aumentar sozinho', () => {
  const pequena = { largura: 800, altura: 600 };

  it('deixa como está quando a medida pedida é maior', () => {
    expect(semAumentar(pequena, { largura: 3000, altura: 2250 })).toEqual(pequena);
  });

  it('deixa reduzir normalmente', () => {
    expect(semAumentar(pequena, { largura: 400, altura: 300 })).toEqual({ largura: 400, altura: 300 });
  });

  it('só um lado maior já é aumento', () => {
    expect(semAumentar(pequena, { largura: 900, altura: 300 })).toEqual(pequena);
  });
});

describe('formato de saída', () => {
  it('jpg e jpeg são o mesmo', () => {
    expect(formatoValido('jpg')).toBe('jpeg');
    expect(formatoValido('JPEG')).toBe('jpeg');
  });

  it('formato desconhecido vira jpeg em vez de quebrar', () => {
    expect(formatoValido('tiff')).toBe('jpeg');
    expect(formatoValido(undefined)).toBe('jpeg');
  });

  it('troca a extensão do nome', () => {
    expect(nomeNoFormato('rosto.HEIC', 'jpeg')).toBe('rosto.jpg');
    expect(nomeNoFormato('foto.webp', 'png')).toBe('foto.png');
    expect(nomeNoFormato('sem extensao', 'webp')).toBe('sem extensao.webp');
  });

  it('ponto no meio do nome não vira extensão', () => {
    expect(nomeNoFormato('cliente 2.5 metros.png', 'jpeg')).toBe('cliente 2.5 metros.jpg');
  });
});

describe('peso alvo', () => {
  it('entende as unidades que a pessoa escreve', () => {
    expect(bytesDoAlvo('500 KB')).toBe(512_000);
    expect(bytesDoAlvo('500kb')).toBe(512_000);
    expect(bytesDoAlvo('1,5 MB')).toBe(1_572_864);
    expect(bytesDoAlvo('2mb')).toBe(2_097_152);
  });

  it('número solto é lido como KB, que é como se fala', () => {
    expect(bytesDoAlvo('500')).toBe(512_000);
  });

  it('recusa o que não dá para entender', () => {
    expect(bytesDoAlvo('')).toBeNull();
    expect(bytesDoAlvo('grande')).toBeNull();
    expect(bytesDoAlvo('0')).toBeNull();
    expect(bytesDoAlvo('-5 MB')).toBeNull();
  });
});

describe('busca da qualidade', () => {
  it('pesou demais: a próxima tentativa é menor', () => {
    const passo = proximaQualidade({ minima: 0.05, maxima: 0.97 }, 0.7, 900_000, 500_000);
    expect(passo.qualidade).toBeLessThan(0.7);
    expect(passo.faixa.maxima).toBe(0.7);
  });

  it('coube: a próxima tentativa é maior, para não entregar qualidade à toa', () => {
    const passo = proximaQualidade({ minima: 0.05, maxima: 0.97 }, 0.7, 200_000, 500_000);
    expect(passo.qualidade).toBeGreaterThan(0.7);
    expect(passo.faixa.minima).toBe(0.7);
  });

  it('converge em sete passos', () => {
    // Modelo simples: o peso cresce com a qualidade. A busca tem que chegar
    // perto da qualidade que dá exatamente o alvo.
    const pesoDe = (q: number) => q * 1_000_000;
    const alvo = 500_000;

    let faixa = { minima: 0.05, maxima: 0.97 };
    let qualidade = 0.7;
    for (let i = 0; i < 7; i += 1) {
      const passo = proximaQualidade(faixa, qualidade, pesoDe(qualidade), alvo);
      qualidade = passo.qualidade;
      faixa = passo.faixa;
    }

    expect(qualidade).toBeCloseTo(0.5, 1);
    expect(pesoDe(qualidade)).toBeLessThan(alvo * 1.05);
  });

  it('o intervalo só encolhe, nunca cresce', () => {
    let faixa = { minima: 0.05, maxima: 0.97 };
    let qualidade = 0.5;
    let largura = faixa.maxima - faixa.minima;

    for (let i = 0; i < 6; i += 1) {
      const passo = proximaQualidade(faixa, qualidade, i % 2 === 0 ? 900_000 : 100_000, 500_000);
      qualidade = passo.qualidade;
      faixa = passo.faixa;
      const nova = faixa.maxima - faixa.minima;
      expect(nova).toBeLessThanOrEqual(largura);
      largura = nova;
    }
  });
});
