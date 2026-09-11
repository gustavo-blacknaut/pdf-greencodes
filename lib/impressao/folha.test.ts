import { describe, expect, it } from 'vitest';

import { planoDaFolha, pontosParaMm, resolucao, type Montagem } from './folha';

/**
 * O defeito que estes testes prendem: "está imprimindo um A5 no meio do A4".
 *
 * A folha nunca esteve errada — ela sempre saiu A4. O que estava errado era a
 * arte, encolhida por 210/297 (0,707) e centralizada, porque o tamanho da
 * folha era declarado em dois lugares que discordavam.
 *
 * Por isso nenhum teste aqui se contenta em conferir o tamanho da folha:
 * todos olham também **onde a arte caiu dentro dela**. Medir só a folha teria
 * aprovado o defeito original sem piscar.
 */

const A4_EM_MM = { largura: 210, altura: 297 };

function montagem(extras: Partial<Montagem> = {}): Montagem {
  return { papel: 'A4', paisagem: false, dpi: 300, escala: 'pagina', ...extras };
}

/** Quanto da folha a arte cobre. Um é a folha inteira. */
function cobertura(plano: ReturnType<typeof planoDaFolha>): number {
  return (plano.arte.largura * plano.arte.altura) / (plano.folha.largura * plano.folha.altura);
}

describe('a folha tem o tamanho do papel', () => {
  it('A4 em pé a 300 DPI dá 2480 por 3508 pixels', () => {
    const plano = planoDaFolha(A4_EM_MM, montagem());
    expect(plano.folha.largura).toBe(2480);
    expect(plano.folha.altura).toBe(3508);
  });

  it('deitada, a folha vira 3508 por 2480 — e não encolhe', () => {
    const plano = planoDaFolha({ largura: 297, altura: 210 }, montagem({ paisagem: true }));
    expect(plano.folha.largura).toBe(3508);
    expect(plano.folha.altura).toBe(2480);
  });

  it('A5 é menor que A4, e não A4 com a arte pequena no meio', () => {
    const a4 = planoDaFolha(A4_EM_MM, montagem());
    const a5 = planoDaFolha({ largura: 148, altura: 210 }, montagem({ papel: 'A5' }));
    expect(a5.folha.largura).toBeLessThan(a4.folha.largura);
    expect(a5.folha.altura).toBeLessThan(a4.folha.altura);
    // E o que importa: nas duas, a arte ocupa a folha inteira.
    expect(cobertura(a4)).toBeGreaterThan(0.99);
    expect(cobertura(a5)).toBeGreaterThan(0.99);
  });

  it('cada papel da tela tem a própria medida', () => {
    const medidas = ['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid'].map((papel) => {
      const plano = planoDaFolha(A4_EM_MM, montagem({ papel }));
      return `${plano.folha.largura}x${plano.folha.altura}`;
    });
    expect(new Set(medidas).size).toBe(medidas.length);
  });
});

describe('a arte cai onde deveria', () => {
  it('uma página A4 numa folha A4 cobre a folha toda, no canto zero', () => {
    const plano = planoDaFolha(A4_EM_MM, montagem());
    expect(plano.arte.x).toBeCloseTo(0, 5);
    expect(plano.arte.y).toBeCloseTo(0, 5);
    expect(cobertura(plano)).toBeGreaterThan(0.999);
  });

  it('deitada, a página deitada continua cobrindo a folha toda', () => {
    // Era exatamente aqui que o defeito aparecia: a arte saía com 50% da área.
    const plano = planoDaFolha({ largura: 297, altura: 210 }, montagem({ paisagem: true }));
    expect(cobertura(plano)).toBeGreaterThan(0.999);
    expect(plano.arte.x).toBeCloseTo(0, 5);
  });

  it('a 0,707 da folha, a área cai para a metade — a assinatura do defeito', () => {
    const certo = planoDaFolha(A4_EM_MM, montagem());
    const defeituoso = planoDaFolha(
      A4_EM_MM,
      montagem({ escala: 'porcento', porcento: 70.7 }),
    );
    expect(cobertura(certo)).toBeGreaterThan(0.99);
    expect(cobertura(defeituoso)).toBeGreaterThan(0.45);
    expect(cobertura(defeituoso)).toBeLessThan(0.55);
  });

  it('a 50%, a arte ocupa um quarto da folha e fica centrada', () => {
    const plano = planoDaFolha(A4_EM_MM, montagem({ escala: 'porcento', porcento: 50 }));
    expect(cobertura(plano)).toBeCloseTo(0.25, 2);
    expect(plano.arte.x).toBeCloseTo(plano.folha.largura / 4, 0);
    expect(plano.arte.y).toBeCloseTo(plano.folha.altura / 4, 0);
  });

  it('tamanho original mantém a medida do PDF, seja qual for o papel', () => {
    const cartao = { largura: 90, altura: 50 };
    const plano = planoDaFolha(cartao, montagem({ escala: 'original' }));
    expect(plano.arte.largura / plano.pontosPorMm).toBeCloseTo(90, 3);
    expect(plano.arte.altura / plano.pontosPorMm).toBeCloseTo(50, 3);
  });

  it('a margem recua a arte por dentro da folha, sem mudar a folha', () => {
    const semMargem = planoDaFolha(A4_EM_MM, montagem());
    const comMargem = planoDaFolha(A4_EM_MM, montagem({ margemLados: 10, margemCima: 10 }));
    expect(comMargem.folha).toEqual(semMargem.folha);
    expect(comMargem.arte.largura).toBeLessThan(semMargem.arte.largura);
    expect(comMargem.arte.x).toBeGreaterThan(0);
  });

  it('deslocar move a arte sem mudar o tamanho dela', () => {
    const centrada = planoDaFolha(A4_EM_MM, montagem({ escala: 'porcento', porcento: 50 }));
    const movida = planoDaFolha(
      A4_EM_MM,
      montagem({ escala: 'porcento', porcento: 50, deslocaX: 20 }),
    );
    expect(movida.arte.largura).toBeCloseTo(centrada.arte.largura, 5);
    expect(movida.arte.x - centrada.arte.x).toBeCloseTo(20 * centrada.pontosPorMm, 3);
  });

  it('preencher cobre a folha mesmo quando a proporção não bate', () => {
    const largo = { largura: 300, altura: 100 };
    const cabe = planoDaFolha(largo, montagem({ escala: 'pagina' }));
    const preenche = planoDaFolha(largo, montagem({ escala: 'preencher' }));
    expect(cobertura(cabe)).toBeLessThan(0.5);
    expect(preenche.arte.largura).toBeGreaterThanOrEqual(preenche.folha.largura - 1);
    expect(preenche.arte.altura).toBeGreaterThanOrEqual(preenche.folha.altura - 1);
  });
});

describe('resolução', () => {
  it('para em 300: acima disso a diferença não sai da tela', () => {
    expect(resolucao(1200)).toBe(300);
    expect(resolucao(150)).toBe(150);
  });

  it('resolução sem sentido cai no padrão, e não no mínimo', () => {
    // Zero não é uma resolução pequena: é a ausência de resolução. Tratá-lo
    // como 1 daria quinze metros de papel.
    expect(resolucao(0)).toBe(300);
    expect(resolucao(-5)).toBe(300);
    expect(resolucao(undefined)).toBe(300);
  });
});

describe('pontos para milímetros', () => {
  it('uma A4 em pontos dá 210 por 297 milímetros', () => {
    expect(pontosParaMm(595.28)).toBeCloseTo(210, 1);
    expect(pontosParaMm(841.89)).toBeCloseTo(297, 1);
  });
});
