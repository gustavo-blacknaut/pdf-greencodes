/**
 * Onde a arte cai na folha.
 *
 * Esta conta é usada em dois lugares que precisam concordar: a prévia na tela
 * e o HTML que vai para a impressora. Prévia mostrando uma coisa e papel
 * saindo outra é pior que não ter prévia — a pessoa confia e imprime a
 * tiragem inteira.
 *
 * Tudo em milímetro. Pixel depende de resolução; milímetro é o que sai da
 * guilhotina.
 */
import { describe, expect, it } from 'vitest';
import {
  fatorDeEscala,
  marcasDeCorte,
  marcasDeRegistro,
  passaDaFolha,
  pixelsParaMm,
  posicionar,
  sobra,
} from './layout';

const A4 = { largura: 210, altura: 297 };
const A4_DEITADA = { largura: 297, altura: 210 };

describe('cabe na página', () => {
  it('encaixa pelo lado que aperta primeiro', () => {
    // Arte quadrada em folha em pé: quem limita é a largura.
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'pagina' });
    expect(caixa.largura).toBeCloseTo(210, 1);
    expect(caixa.altura).toBeCloseTo(210, 1);
  });

  it('centraliza o que sobra', () => {
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'pagina' });
    expect(caixa.x).toBeCloseTo(0, 1);
    expect(caixa.y).toBeCloseTo((297 - 210) / 2, 1);
  });

  it('não deforma: os dois lados crescem igual', () => {
    const arte = { largura: 40, altura: 30 };
    const caixa = posicionar(A4, arte, { escala: 'pagina' });
    expect(caixa.largura / caixa.altura).toBeCloseTo(arte.largura / arte.altura, 3);
  });

  it('a margem aperta a área disponível', () => {
    const semMargem = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'pagina' });
    const comMargem = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'pagina', margemLados: 20 });
    expect(comMargem.largura).toBeLessThan(semMargem.largura);
    expect(comMargem.largura).toBeCloseTo(210 - 40, 1);
  });
});

describe('preencher', () => {
  it('ocupa a folha inteira, mesmo cortando', () => {
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'preencher' });
    // Quadrada numa folha em pé: para cobrir a altura, a largura passa.
    expect(caixa.altura).toBeCloseTo(297, 1);
    expect(caixa.largura).toBeCloseTo(297, 1);
    expect(passaDaFolha(A4, caixa)).toBe(true);
  });

  it('o que passa é dito, e para cada lado', () => {
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'preencher' });
    const fora = sobra(A4, caixa);
    expect(fora.esquerda).toBeCloseTo((297 - 210) / 2, 1);
    expect(fora.direita).toBeCloseTo((297 - 210) / 2, 1);
    expect(fora.cima).toBeCloseTo(0, 1);
  });
});

describe('tamanho original e porcentagem', () => {
  it('original não mexe na medida', () => {
    const caixa = posicionar(A4, { largura: 80, altura: 60 }, { escala: 'original' });
    expect(caixa.largura).toBeCloseTo(80, 3);
    expect(caixa.altura).toBeCloseTo(60, 3);
  });

  it('porcentagem multiplica a medida de verdade', () => {
    const metade = posicionar(A4, { largura: 80, altura: 60 }, { escala: 'porcento', porcento: 50 });
    expect(metade.largura).toBeCloseTo(40, 3);

    const dobro = posicionar(A4, { largura: 80, altura: 60 }, { escala: 'porcento', porcento: 200 });
    expect(dobro.largura).toBeCloseTo(160, 3);
  });

  it('100% é o mesmo que original', () => {
    const a = posicionar(A4, { largura: 80, altura: 60 }, { escala: 'porcento', porcento: 100 });
    const b = posicionar(A4, { largura: 80, altura: 60 }, { escala: 'original' });
    expect(a).toEqual(b);
  });

  it('porcentagem sem número cai em 100, e não em zero', () => {
    // Campo vazio na tela não pode virar arte de tamanho nenhum.
    expect(fatorDeEscala(A4, { largura: 10, altura: 10 }, { escala: 'porcento' })).toBe(1);
  });

  it('a folha deitada muda o encaixe, e não a arte', () => {
    const arte = { largura: 100, altura: 50 };
    const emPe = posicionar(A4, arte, { escala: 'pagina' });
    const deitada = posicionar(A4_DEITADA, arte, { escala: 'pagina' });
    expect(deitada.largura).toBeGreaterThan(emPe.largura);
  });
});

describe('posição', () => {
  it('sem deslocamento, fica no centro', () => {
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'original' });
    expect(caixa.x + caixa.largura / 2).toBeCloseTo(105, 3);
    expect(caixa.y + caixa.altura / 2).toBeCloseTo(148.5, 3);
  });

  it('o deslocamento parte do centro, e não do canto', () => {
    /*
     * Quem pede "3 mm para a direita" está pensando em relação ao meio da
     * folha, que é onde a impressora põe o trabalho sozinha.
     */
    const centro = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'original' });
    const movida = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'original', deslocaX: 3, deslocaY: -5 });
    expect(movida.x - centro.x).toBeCloseTo(3, 3);
    expect(movida.y - centro.y).toBeCloseTo(-5, 3);
  });

  it('deslocar demais tira a arte da folha, e isso é dito', () => {
    const caixa = posicionar(A4, { largura: 100, altura: 100 }, { escala: 'original', deslocaX: 200 });
    expect(passaDaFolha(A4, caixa)).toBe(true);
    expect(sobra(A4, caixa).direita).toBeGreaterThan(100);
  });

  it('meio milímetro de sobra não conta como vazamento', () => {
    // É ruído de arredondamento, e avisar disso seria alarme falso a cada uso.
    const caixa = posicionar(A4, { largura: 210, altura: 297 }, { escala: 'original' });
    expect(passaDaFolha(A4, caixa)).toBe(false);
  });
});

describe('marcas de corte', () => {
  const caixa = { x: 50, y: 50, largura: 100, altura: 100 };

  it('são oito riscos, dois por canto', () => {
    expect(marcasDeCorte(caixa)).toHaveLength(8);
  });

  it('nenhum risco encosta na arte', () => {
    /*
     * O vão existe para a marca não sair impressa no trabalho cortado. Marca
     * desenhada em cima do corte é marca dentro do produto.
     */
    for (const traco of marcasDeCorte(caixa, 4, 2)) {
      const dentroX = traco.x1 > caixa.x + 0.01 && traco.x1 < caixa.x + caixa.largura - 0.01;
      const dentroY = traco.y1 > caixa.y + 0.01 && traco.y1 < caixa.y + caixa.altura - 0.01;
      expect(dentroX && dentroY, `risco dentro da arte: ${JSON.stringify(traco)}`).toBe(false);
    }
  });

  it('os riscos ficam alinhados com as bordas da arte', () => {
    // É isso que faz a marca indicar onde cortar: ela prolonga a borda.
    const tracos = marcasDeCorte(caixa);
    const bordas = [caixa.x, caixa.x + caixa.largura, caixa.y, caixa.y + caixa.altura];
    for (const traco of tracos) {
      const naBorda =
        bordas.some((b) => Math.abs(traco.y1 - b) < 0.01) || bordas.some((b) => Math.abs(traco.x1 - b) < 0.01);
      expect(naBorda, `risco solto: ${JSON.stringify(traco)}`).toBe(true);
    }
  });

  it('o comprimento pedido é respeitado', () => {
    for (const traco of marcasDeCorte(caixa, 7, 2)) {
      const tamanho = Math.hypot(traco.x2 - traco.x1, traco.y2 - traco.y1);
      expect(tamanho).toBeCloseTo(7, 3);
    }
  });
});

describe('marcas de registro', () => {
  it('são quatro, uma no meio de cada lado', () => {
    const caixa = { x: 50, y: 50, largura: 100, altura: 100 };
    const alvos = marcasDeRegistro(caixa, 6);
    expect(alvos).toHaveLength(4);
    // Duas no eixo vertical do centro, duas no horizontal.
    expect(alvos.filter((a) => Math.abs(a.x - 100) < 0.01)).toHaveLength(2);
    expect(alvos.filter((a) => Math.abs(a.y - 100) < 0.01)).toHaveLength(2);
  });

  it('ficam fora da arte', () => {
    const caixa = { x: 50, y: 50, largura: 100, altura: 100 };
    for (const alvo of marcasDeRegistro(caixa, 6)) {
      const dentro =
        alvo.x > caixa.x && alvo.x < caixa.x + caixa.largura && alvo.y > caixa.y && alvo.y < caixa.y + caixa.altura;
      expect(dentro).toBe(false);
    }
  });
});

describe('de pixel para milímetro', () => {
  it('300 DPI: uma polegada são 300 pixels e 25,4 mm', () => {
    expect(pixelsParaMm(300, 300)).toBeCloseTo(25.4, 3);
  });

  it('uma A4 a 150 DPI', () => {
    // 210 mm a 150 DPI dão 1240 px; a volta tem que fechar.
    expect(pixelsParaMm(1240, 150)).toBeCloseTo(210, 0);
  });

  it('resolução inválida cai em 300, e não em divisão por zero', () => {
    expect(Number.isFinite(pixelsParaMm(600, 0))).toBe(true);
    expect(pixelsParaMm(600, 0)).toBeCloseTo(pixelsParaMm(600, 300), 3);
  });
});
