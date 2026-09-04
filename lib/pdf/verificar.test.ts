/**
 * A conferência de impressão, nas duas partes que não precisam de tela.
 *
 * O cálculo de DPI depende de rasterizar com o pdf.js, que precisa de canvas,
 * e a suíte roda em Node. Mas a parte que erra em silêncio é a matriz: um
 * sinal trocado ali entrega "600 DPI" para uma foto que vai sair borrada, e o
 * relatório fica errado sem quebrar nada. Essa dá para testar sozinha, e é o
 * que está aqui, junto com a leitura de fontes, que é pdf-lib puro.
 */
import { describe, expect, it } from 'vitest';
import { conferirFontes, multiplicar } from './operacoes/verificar';
import { loadPdfLib } from './lazy';

type Matriz = [number, number, number, number, number, number];
const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/** O tamanho em pontos que uma imagem ganha sob esta matriz. */
function tamanhoDesenhado(m: Matriz) {
  return { largura: Math.hypot(m[0], m[1]), altura: Math.hypot(m[2], m[3]) };
}

describe('matriz de transformação', () => {
  it('a identidade não muda nada', () => {
    const escala: Matriz = [200, 0, 0, 100, 30, 40];
    expect(multiplicar(escala, IDENTIDADE)).toEqual(escala);
    expect(multiplicar(IDENTIDADE, escala)).toEqual(escala);
  });

  it('escalas em sequência se multiplicam', () => {
    const metade: Matriz = [0.5, 0, 0, 0.5, 0, 0];
    const cem: Matriz = [100, 0, 0, 100, 0, 0];
    const composta = multiplicar(cem, metade) as Matriz;
    expect(tamanhoDesenhado(composta)).toEqual({ largura: 50, altura: 50 });
  });

  it('a translação do pai desloca o filho', () => {
    const move: Matriz = [1, 0, 0, 1, 10, 20];
    const outroMove: Matriz = [1, 0, 0, 1, 5, 7];
    const composta = multiplicar(outroMove, move);
    expect(composta[4]).toBe(15);
    expect(composta[5]).toBe(27);
  });

  it('imagem girada 90° mantém o tamanho medido', () => {
    // Girar 90° e esticar 200x100: a largura desenhada continua 200.
    const giradaEEsticada: Matriz = [0, 200, -100, 0, 0, 0];
    const { largura, altura } = tamanhoDesenhado(giradaEEsticada);
    expect(largura).toBeCloseTo(200, 6);
    expect(altura).toBeCloseTo(100, 6);
  });

  it('espelhar não vira tamanho negativo', () => {
    const espelhada: Matriz = [-300, 0, 0, 150, 300, 0];
    const { largura, altura } = tamanhoDesenhado(espelhada);
    expect(largura).toBe(300);
    expect(altura).toBe(150);
  });

  it('uma foto de 1200 px em 100 pt dá 864 DPI', () => {
    const desenho: Matriz = [100, 0, 0, 100, 0, 0];
    const { largura } = tamanhoDesenhado(multiplicar(desenho, IDENTIDADE) as Matriz);
    expect(Math.round((1200 * 72) / largura)).toBe(864);
  });
});

describe('fontes embutidas', () => {
  async function pdfComFonteDeSistema(): Promise<ArrayBuffer> {
    const { PDFDocument, StandardFonts } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText('teste', { x: 10, y: 10, size: 12, font: fonte });
    return (await doc.save()).buffer as ArrayBuffer;
  }

  /** Uma fonte com FontFile2 montada à mão, que é o que se quer detectar. */
  async function pdfComFonteEmbutida(): Promise<ArrayBuffer> {
    const { PDFDocument, PDFName } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([200, 200]);

    const arquivoDaFonte = doc.context.register(doc.context.flateStream('bytes-da-fonte'));
    const descritor = doc.context.register(
      doc.context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+MinhaFonte', FontFile2: arquivoDaFonte }),
    );
    const fonte = doc.context.register(
      doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+MinhaFonte', FontDescriptor: descritor }),
    );
    pagina.node.normalizedEntries().Font.set(PDFName.of('F9'), fonte);

    return (await doc.save()).buffer as ArrayBuffer;
  }

  it('a Helvetica do sistema não está embutida', async () => {
    const { embutidas, soltas } = await conferirFontes(await pdfComFonteDeSistema());
    expect(soltas).toContain('Helvetica');
    expect(embutidas).toHaveLength(0);
  });

  it('uma fonte com FontFile2 é reconhecida como embutida', async () => {
    const { embutidas, soltas } = await conferirFontes(await pdfComFonteEmbutida());
    expect(embutidas).toContain('MinhaFonte');
    expect(soltas).toHaveLength(0);
  });

  it('tira o prefixo de subconjunto do nome', async () => {
    const { embutidas } = await conferirFontes(await pdfComFonteEmbutida());
    // Guardada como "ABCDEF+MinhaFonte"; quem lê o laudo quer o nome.
    expect(embutidas.some((nome) => nome.startsWith('ABCDEF+'))).toBe(false);
  });

  it('documento sem texto não inventa fonte', async () => {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const { embutidas, soltas } = await conferirFontes((await doc.save()).buffer as ArrayBuffer);
    expect(embutidas).toHaveLength(0);
    expect(soltas).toHaveLength(0);
  });
});
