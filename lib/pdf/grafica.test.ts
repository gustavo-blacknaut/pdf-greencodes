/**
 * As ferramentas de gráfica.
 *
 * Todas mexem em geometria, e geometria errada não quebra: entrega um PDF
 * bonito com a medida trocada, que só aparece depois de cortado. Por isso os
 * testes medem a folha e contam as páginas de volta, em vez de conferir que a
 * operação não estourou.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { CANTOS, calcularGrade } from './operacoes/grafica';
import { loadPdfLib } from './lazy';

const PT_POR_MM = 72 / 25.4;
const mm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

async function pdfDe(paginas: number, largura = 595, altura = 842): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([largura, altura]).drawText(`P${i}`, { x: 20, y: 20, size: 12, font: fonte });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

function ctx(bytes: ArrayBuffer, options: Record<string, string | number | boolean> = {}): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: 'arte.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options, onProgress: () => {} };
}

async function abrir(blob: Blob) {
  const { PDFDocument } = await loadPdfLib();
  return PDFDocument.load(await blob.arrayBuffer());
}

describe('marcas de corte', () => {
  it('a folha cresce a sangria mais a marca mais o respiro, dos dois lados', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1, 300, 400), { sangriaMm: 3, marcasMm: 4 }));
    const doc = await abrir(resultado.files[0].blob);
    const { width, height } = doc.getPage(0).getSize();

    // 3 de sangria + 4 de marca + 2 de respiro = 9 mm de cada lado.
    const borda = 9 * PT_POR_MM;
    expect(width).toBeCloseTo(300 + borda * 2, 1);
    expect(height).toBeCloseTo(400 + borda * 2, 1);
  });

  it('sangria zero encosta as marcas na linha de corte', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1, 300, 400), { sangriaMm: 0, marcasMm: 4 }));
    const doc = await abrir(resultado.files[0].blob);
    const borda = 6 * PT_POR_MM;
    expect(doc.getPage(0).getWidth()).toBeCloseTo(300 + borda * 2, 1);
  });

  it('mantém uma folha para cada página', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(5)));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(5);
  });

  it('avisa que contou com a sangria vinda do arquivo', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1), { sangriaMm: 3 }));
    expect(resultado.notes.join(' ')).toMatch(/já tenha 3 mm de sangria/);
  });

  it('ampliar avisa que é remendo, e não sangria de verdade', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1), { sangriaMm: 3, origem: 'ampliar' }));
    expect(resultado.notes.join(' ')).toMatch(/remendo/);
  });
});

describe('calcularGrade', () => {
  const a4 = { l: 210 * PT_POR_MM, a: 297 * PT_POR_MM };

  it('cabem 10 cartões de 90x50 num A4 com 5 mm de margem', () => {
    const grade = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0);
    expect(grade).not.toBeNull();
    expect(grade!.colunas).toBe(2);
    expect(grade!.linhas).toBe(5);
  });

  it('centra a grade dividindo a sobra pelos dois lados', () => {
    const grade = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)!;
    const usado = grade.colunas * 90 * PT_POR_MM;
    expect(grade.margemX).toBeCloseTo((a4.l - usado) / 2, 4);
    // E a margem calculada nunca pode ser menor que a pedida.
    expect(grade.margemX).toBeGreaterThanOrEqual(5 * PT_POR_MM - 0.01);
  });

  it('o espaço entre itens tira uma coluna quando não sobra rua', () => {
    const semEspaco = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)!;
    const comEspaco = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 25 * PT_POR_MM)!;
    expect(comEspaco.colunas).toBeLessThan(semEspaco.colunas);
  });

  it('devolve nulo quando o item não cabe', () => {
    expect(calcularGrade(a4.l, a4.a, 400 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)).toBeNull();
    expect(calcularGrade(a4.l, a4.a, 0, 50, 5, 0)).toBeNull();
  });
});

describe('cartão de visita', () => {
  it('enche o A4 com o mesmo cartão e diz quantos couberam', async () => {
    const resultado = await runOperation('business-cards', ctx(await pdfDe(1, 255, 142), { papel: 'a4' }));
    const doc = await abrir(resultado.files[0].blob);

    expect(doc.getPageCount()).toBe(1);
    expect(mm(doc.getPage(0).getWidth())).toBeCloseTo(210, 0);
    expect(resultado.notes.join(' ')).toMatch(/2 x 5 = 10 por folha/);
  });

  it('frente e verso saem em duas folhas', async () => {
    const resultado = await runOperation('business-cards', ctx(await pdfDe(2, 255, 142), { modo: 'repetir' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(2);
  });

  it('A3 rende mais que A4', async () => {
    const arte = await pdfDe(1, 255, 142);
    const emA4 = await runOperation('business-cards', ctx(arte, { papel: 'a4' }));
    const emA3 = await runOperation('business-cards', ctx(arte, { papel: 'a3' }));
    const quantos = (notas: string[]) => Number(notas.join(' ').match(/= (\d+) por folha/)?.[1]);
    expect(quantos(emA3.notes)).toBeGreaterThan(quantos(emA4.notes));
  });

  it('recusa um cartão maior que o papel, dizendo o que fazer', async () => {
    await expect(
      runOperation('business-cards', ctx(await pdfDe(1), { medida: 'personalizado', larguraMm: 250, alturaMm: 250 })),
    ).rejects.toThrow(/não cabe|papel maior/);
  });
});

describe('etiquetas', () => {
  it('a grade obedece a medida informada', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(1, 142, 85), { larguraMm: 50, alturaMm: 30, espacoMm: 0, margemMm: 5 }));
    // (210-10)/50 = 4 colunas; (297-10)/30 = 9 linhas
    expect(resultado.notes.join(' ')).toMatch(/4 x 9 = 36 por folha/);
  });

  it('junta páginas diferentes na mesma folha no modo sequência', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(8, 142, 85), { larguraMm: 50, alturaMm: 30, modo: 'sequencia' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(1);
  });
});

describe('numeração sequencial', () => {
  it('uma página por número quando o jogo tem uma página', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(1), { quantidade: 25 }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(25);
  });

  it('o jogo inteiro repete por número, para o canhoto bater com a via', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(2), { quantidade: 10 }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(20);
    expect(resultado.notes.join(' ')).toMatch(/canhoto/);
  });

  it('conta a partir do início pedido, com zero à esquerda', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(1), { quantidade: 3, inicio: 98, digitos: 5, prefixo: 'A' }));
    expect(resultado.notes[0]).toBe('3 números, de A00098 a A00100.');
  });

  it('recusa antes de gerar quando o total estoura o limite', async () => {
    await expect(
      runOperation('sequential-numbering', ctx(await pdfDe(3), { quantidade: 4000 })),
    ).rejects.toThrow(/acima do limite/);
  });
});

describe('espelhar', () => {
  it('mantém o tamanho da página', async () => {
    const resultado = await runOperation('mirror', ctx(await pdfDe(3, 300, 400)));
    const doc = await abrir(resultado.files[0].blob);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(300, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(400, 1);
  });

  it('diz em que sentido espelhou', async () => {
    const vertical = await runOperation('mirror', ctx(await pdfDe(1), { eixo: 'vertical' }));
    expect(vertical.notes[0]).toMatch(/de cima para baixo/);
  });
});

describe('repetir páginas', () => {
  it('cada página seguida: 1,1,2,2,3,3', async () => {
    const resultado = await runOperation('repeat-pages', ctx(await pdfDe(3), { vezes: 2, modo: 'cada-pagina' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(6);
    expect(resultado.notes[0]).toMatch(/Cada página saiu 2 vezes/);
  });

  it('documento inteiro: 1,2,3,1,2,3', async () => {
    const resultado = await runOperation('repeat-pages', ctx(await pdfDe(3), { vezes: 4, modo: 'documento-inteiro' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(12);
    expect(resultado.notes[0]).toMatch(/o documento saiu 4 vezes/i);
  });

  it('recusa quando o total estoura o limite', async () => {
    await expect(runOperation('repeat-pages', ctx(await pdfDe(20), { vezes: 400 }))).rejects.toThrow(/acima do limite/);
  });
});

describe('as que só existem no aplicativo', () => {
  it.each([
    ['photo-sheet', /aplicativo para Windows/],
    ['separate-plates', /aplicativo para Windows/],
    ['ink-coverage', /aplicativo para Windows/],
  ] as const)('%s explica por que não roda no site', async (id, mensagem) => {
    await expect(runOperation(id, ctx(await pdfDe(1)))).rejects.toThrow(mensagem);
  });
});

describe('páginas com /Rotate', () => {
  async function pdfGirado(giro: number): Promise<ArrayBuffer> {
    const { PDFDocument, degrees, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([300, 400]);
    pagina.drawRectangle({ x: 0, y: 0, width: 60, height: 60, color: rgb(0, 0, 0) });
    if (giro) pagina.setRotation(degrees(giro));
    return (await doc.save()).buffer as ArrayBuffer;
  }

  /**
   * O XObject da página tem que existir de verdade no arquivo final.
   *
   * O documento intermediário que aplica o giro precisa ser gravado e
   * reaberto: sem isso o pdf-lib entrega uma referência que não resolve, o
   * leitor reclama de "cannot find object in xref" e a folha sai EM BRANCO —
   * com o tamanho todo certo, que é o que torna o defeito traiçoeiro.
   */
  async function temDesenhoDeVerdade(blob: Blob): Promise<boolean> {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    const xobjects = doc.getPage(0).node.normalizedEntries().XObject;
    if (!xobjects || xobjects.asMap().size === 0) return false;

    // Um XObject é stream, não dicionário: o que importa é a referência
    // resolver para alguma coisa. Antes ela apontava para o vazio.
    for (const [, referencia] of xobjects.asMap()) {
      if (doc.context.lookup(referencia) === undefined) return false;
    }
    return true;
  }

  it.each([0, 90, 180, 270])('/Rotate %i: a folha sai na medida que o leitor mostra', async (giro) => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(giro), { sangriaMm: 0, marcasMm: 3 }));
    const doc = await abrir(resultado.files[0].blob);
    const { width, height } = doc.getPage(0).getSize();

    const deitada = giro === 90 || giro === 270;
    const borda = 5 * PT_POR_MM; // 3 de marca + 2 de respiro
    expect(Math.round(width)).toBe(Math.round((deitada ? 400 : 300) + borda * 2));
    expect(Math.round(height)).toBe(Math.round((deitada ? 300 : 400) + borda * 2));
  });

  it.each([90, 180, 270])('/Rotate %i: a folha não sai em branco', async (giro) => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(giro)));
    expect(await temDesenhoDeVerdade(resultado.files[0].blob)).toBe(true);
  });

  it('espelhar também respeita o giro', async () => {
    const resultado = await runOperation('mirror', ctx(await pdfGirado(90)));
    const doc = await abrir(resultado.files[0].blob);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(400);
    expect(await temDesenhoDeVerdade(resultado.files[0].blob)).toBe(true);
  });

  it('documento reto não paga nada por isso', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(0), { sangriaMm: 0, marcasMm: 3 }));
    expect(Math.round(await abrir(resultado.files[0].blob).then((d) => d.getPage(0).getWidth()))).toBe(328);
  });
});


describe('onde o número é assentado', () => {
  const L = 300;
  const A = 400;

  it('no topo, desconta a altura da letra da margem de cima', () => {
    expect(CANTOS['topo-direita'](L, A, 10, 72)).toEqual({ x: 290, y: 318, direita: true });
    expect(CANTOS['topo-esquerda'](L, A, 10, 72)).toEqual({ x: 10, y: 318, direita: false });
  });

  it('no rodapé, a margem já É a linha de base', () => {
    expect(CANTOS['rodape-direita'](L, A, 10, 72)).toEqual({ x: 290, y: 10, direita: true });
    expect(CANTOS['rodape-esquerda'](L, A, 10, 72)).toEqual({ x: 10, y: 10, direita: false });
  });

  it('letra grande com margem mínima continua dentro da folha', () => {
    // O caso que estourava: descontar o tamanho também no rodapé punha a
    // linha de base em 5,7 - 72 = -66, e o número saía fora do papel.
    for (const posicao of Object.keys(CANTOS) as (keyof typeof CANTOS)[]) {
      const { x, y } = CANTOS[posicao](L, A, 5.7, 72);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + 72).toBeLessThanOrEqual(A);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(L);
    }
  });
});
