import { describe, expect, it } from 'vitest';
import { hexParaRgb, limitarAPagina, paraCoordenadasPdf } from './layout';

// A4 em pontos, o caso que mais aparece.
const L = 595.28;
const A = 841.89;

describe('paraCoordenadasPdf', () => {
  it('inverte o eixo vertical: o topo da tela vira o alto da página', () => {
    const caixa = paraCoordenadasPdf({ x: 0, y: 0, largura: 1, altura: 0.1 }, L, A);
    expect(caixa.x).toBeCloseTo(0);
    // Encostado no topo: a base do elemento fica a 90% da altura.
    expect(caixa.y).toBeCloseTo(A * 0.9, 4);
  });

  it('um elemento encostado na base fica com y zero', () => {
    const caixa = paraCoordenadasPdf({ x: 0, y: 0.9, largura: 1, altura: 0.1 }, L, A);
    expect(caixa.y).toBeCloseTo(0, 6);
  });

  it('converte largura e altura proporcionalmente', () => {
    const caixa = paraCoordenadasPdf({ x: 0.25, y: 0.5, largura: 0.5, altura: 0.2 }, L, A);
    expect(caixa.x).toBeCloseTo(L * 0.25, 4);
    expect(caixa.largura).toBeCloseTo(L * 0.5, 4);
    expect(caixa.altura).toBeCloseTo(A * 0.2, 4);
  });

  it('mantém o elemento dentro da página em qualquer canto', () => {
    for (const canto of [
      { x: 0, y: 0 },
      { x: 0.8, y: 0 },
      { x: 0, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ]) {
      const caixa = paraCoordenadasPdf({ ...canto, largura: 0.2, altura: 0.2 }, L, A);
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.y).toBeGreaterThanOrEqual(-0.001);
      expect(caixa.x + caixa.largura).toBeLessThanOrEqual(L + 0.001);
      expect(caixa.y + caixa.altura).toBeLessThanOrEqual(A + 0.001);
    }
  });

  it('funciona com página em paisagem', () => {
    const caixa = paraCoordenadasPdf({ x: 0.5, y: 0.5, largura: 0.25, altura: 0.25 }, A, L);
    expect(caixa.x).toBeCloseTo(A * 0.5, 4);
    expect(caixa.y).toBeCloseTo(L * 0.25, 4);
  });
});

describe('limitarAPagina', () => {
  it('puxa de volta um elemento arrastado para fora pela esquerda ou pelo topo', () => {
    const preso = limitarAPagina({ x: -0.5, y: -0.3, largura: 0.2, altura: 0.2 });
    expect(preso.x).toBe(0);
    expect(preso.y).toBe(0);
  });

  it('puxa de volta um elemento arrastado para fora pela direita ou por baixo', () => {
    const preso = limitarAPagina({ x: 2, y: 2, largura: 0.3, altura: 0.25 });
    expect(preso.x).toBeCloseTo(0.7, 6);
    expect(preso.y).toBeCloseTo(0.75, 6);
  });

  it('impede tamanho zero ou negativo ao redimensionar para trás', () => {
    const preso = limitarAPagina({ x: 0.5, y: 0.5, largura: -1, altura: 0 });
    expect(preso.largura).toBeGreaterThan(0);
    expect(preso.altura).toBeGreaterThan(0);
  });

  it('não deixa o elemento ficar maior que a página', () => {
    const preso = limitarAPagina({ x: 0, y: 0, largura: 5, altura: 5 });
    expect(preso.largura).toBe(1);
    expect(preso.altura).toBe(1);
  });

  it('não mexe em quem já está dentro', () => {
    const dentro = { x: 0.2, y: 0.3, largura: 0.4, altura: 0.1 };
    expect(limitarAPagina(dentro)).toEqual(dentro);
  });
});

describe('hexParaRgb', () => {
  it('converte a forma longa', () => {
    expect(hexParaRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexParaRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('aceita a forma curta e sem cerquilha', () => {
    expect(hexParaRgb('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexParaRgb('ffffff')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('converte um valor intermediário', () => {
    const { r, g, b } = hexParaRgb('#fde047');
    expect(r).toBeCloseTo(253 / 255, 5);
    expect(g).toBeCloseTo(224 / 255, 5);
    expect(b).toBeCloseTo(71 / 255, 5);
  });

  it('cai para preto em vez de quebrar com entrada inválida', () => {
    expect(hexParaRgb('nao-e-cor')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexParaRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});
