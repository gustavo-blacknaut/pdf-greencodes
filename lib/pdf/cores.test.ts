/**
 * A matemática das ferramentas de cor.
 *
 * Os filtros estão separados da operação justamente para poderem ser
 * verificados assim: com pixels de entrada e pixels de saída, sem montar PDF
 * nem carregar o pdf.js.
 */
import { describe, expect, it } from 'vitest';
import { filtroInverter, filtroTonsDePreto } from './operacoes/otimizar';

/** Um pixel opaco, para o filtro trabalhar em cima. */
function pixel(r: number, g: number, b: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, 255]);
}

const cor = (d: Uint8ClampedArray) => [d[0], d[1], d[2]];

describe('inverter cor', () => {
  it('branco vira preto', () => {
    const d = pixel(255, 255, 255);
    filtroInverter(d);
    expect(cor(d)).toEqual([0, 0, 0]);
  });

  it('preto vira branco', () => {
    const d = pixel(0, 0, 0);
    filtroInverter(d);
    expect(cor(d)).toEqual([255, 255, 255]);
  });

  it('sai em cinza, e não na cor complementar', () => {
    // Vermelho invertido canal a canal daria ciano. O que queremos é o
    // negativo em preto e branco: vermelho é escuro, o negativo é claro.
    const d = pixel(255, 0, 0);
    filtroInverter(d);

    const [r, g, b] = cor(d);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(180);
  });

  it('preserva a opacidade', () => {
    const d = pixel(10, 20, 30);
    filtroInverter(d);
    expect(d[3]).toBe(255);
  });
});

describe('tons de preto', () => {
  it('cinza médio vira preto puro', () => {
    const d = pixel(128, 128, 128);
    filtroTonsDePreto(d, 180);
    expect(cor(d)).toEqual([0, 0, 0]);
  });

  it('cinza bem claro vira branco, para o fundo não sujar', () => {
    const d = pixel(230, 230, 230);
    filtroTonsDePreto(d, 180);
    expect(cor(d)).toEqual([255, 255, 255]);
  });

  it('o limite decide: com 240, o mesmo cinza claro vira preto', () => {
    const d = pixel(230, 230, 230);
    filtroTonsDePreto(d, 240);
    expect(cor(d)).toEqual([0, 0, 0]);
  });

  it('não sobra meio-tom nenhum', () => {
    const d = new Uint8ClampedArray([100, 150, 200, 255, 20, 20, 20, 255, 250, 250, 250, 255]);
    filtroTonsDePreto(d, 180);
    for (const canal of [d[0], d[4], d[8]]) {
      expect([0, 255]).toContain(canal);
    }
  });
});
