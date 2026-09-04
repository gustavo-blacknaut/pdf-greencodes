/**
 * O desenho do código de barras.
 *
 * O leitor do caixa mede a largura relativa dos traços. Errar a quantidade,
 * a ordem ou a proporção entrega um código que parece certo impresso e que
 * nenhuma máquina lê — e isso só se descobre no caixa, com o cliente na fila.
 */
import { describe, expect, it } from 'vitest';
import { barrasDoCodigo } from '../pdf/operacoes/boleto';

const CODIGO = '34191844100000020001090061713957757174464000';

describe('Intercalado 2 de 5', () => {
  it('a quantidade de traços é a que o padrão manda', () => {
    // 4 do início + 10 por par de dígitos + 3 do fim.
    const pares = CODIGO.length / 2;
    expect(barrasDoCodigo(CODIGO)).toHaveLength(4 + pares * 10 + 3);
  });

  it('começa com quatro traços estreitos, alternando barra e espaço', () => {
    const inicio = barrasDoCodigo(CODIGO).slice(0, 4);
    expect(inicio.map((t) => t.largura)).toEqual([1, 1, 1, 1]);
    expect(inicio.map((t) => t.preta)).toEqual([true, false, true, false]);
  });

  it('termina com barra larga, espaço estreito e barra estreita', () => {
    const fim = barrasDoCodigo(CODIGO).slice(-3);
    expect(fim).toEqual([
      { largura: 3, preta: true },
      { largura: 1, preta: false },
      { largura: 1, preta: true },
    ]);
  });

  it('barra e espaço se alternam do início ao fim', () => {
    // É o que "intercalado" quer dizer: dois traços pretos seguidos viram
    // uma barra grossa que o leitor interpreta errado.
    const tracos = barrasDoCodigo(CODIGO);
    for (let i = 1; i < tracos.length; i += 1) {
      expect(tracos[i].preta, `traço ${i}`).toBe(!tracos[i - 1].preta);
    }
  });

  it('só existe estreito e largo, e o largo vale três', () => {
    for (const traco of barrasDoCodigo(CODIGO)) {
      expect([1, 3]).toContain(traco.largura);
    }
  });

  it('cada par de dígitos tem exatamente duas barras largas e dois espaços largos', () => {
    // Cada dígito do padrão tem dois "w" entre cinco posições.
    const tracos = barrasDoCodigo('0123456789').slice(4, -3);
    for (let par = 0; par < 5; par += 1) {
      const dez = tracos.slice(par * 10, par * 10 + 10);
      expect(dez.filter((t) => t.preta && t.largura === 3)).toHaveLength(2);
      expect(dez.filter((t) => !t.preta && t.largura === 3)).toHaveLength(2);
    }
  });

  it('recusa quantidade ímpar, que o padrão não sabe desenhar', () => {
    expect(() => barrasDoCodigo('123')).toThrow(/quantidade par/);
  });

  it('recusa o que não é dígito', () => {
    expect(() => barrasDoCodigo('12ab')).toThrow(/só aceita dígitos/);
  });
});
