import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

async function pdfDe(paginas: number, largura = 400, altura = 600): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([largura, altura]).drawText(`P${i}`, { x: 20, y: altura / 2, size: 20, font: fonte });
  }
  const bytes = await doc.save();
  return bytes.buffer as ArrayBuffer;
}

function arquivo(bytes: ArrayBuffer): LoadedFile {
  return { id: 'a', name: 'doc.pdf', size: bytes.byteLength, type: 'application/pdf', bytes, pageCount: null, thumbnail: null };
}

function contexto(bytes: ArrayBuffer, options: RunContext['options'] = {}): RunContext {
  return { files: [arquivo(bytes)], options, onProgress: () => {} };
}

async function tamanhosDe(blob: Blob): Promise<{ paginas: number; primeira: { width: number; height: number } }> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return { paginas: doc.getPageCount(), primeira: doc.getPage(0).getSize() };
}

describe('dividir páginas ao meio', () => {
  it('na vertical, dobra a contagem e corta a largura', async () => {
    const bytes = await pdfDe(3, 400, 600);
    const r = await runOperation('split-pages', contexto(bytes, { mode: 'vertical' }));
    const { paginas, primeira } = await tamanhosDe(r.files[0].blob);

    expect(paginas).toBe(6);
    expect(primeira.width).toBeCloseTo(200, 0);
    expect(primeira.height).toBeCloseTo(600, 0);
  });

  it('na horizontal, corta a altura em vez da largura', async () => {
    const bytes = await pdfDe(2, 400, 600);
    const r = await runOperation('split-pages', contexto(bytes, { mode: 'horizontal' }));
    const { paginas, primeira } = await tamanhosDe(r.files[0].blob);

    expect(paginas).toBe(4);
    expect(primeira.width).toBeCloseTo(400, 0);
    expect(primeira.height).toBeCloseTo(300, 0);
  });

  it('em quatro, sai uma grade 2 x 2 por página', async () => {
    const bytes = await pdfDe(2, 400, 600);
    const r = await runOperation('split-pages', contexto(bytes, { mode: 'quatro' }));
    const { paginas, primeira } = await tamanhosDe(r.files[0].blob);

    expect(paginas).toBe(8);
    expect(primeira.width).toBeCloseTo(200, 0);
    expect(primeira.height).toBeCloseTo(300, 0);
  });
});

describe('livreto', () => {
  it('junta duas páginas por folha, na largura dobrada', async () => {
    const bytes = await pdfDe(8, 400, 600);
    const r = await runOperation('booklet', contexto(bytes));
    const { paginas, primeira } = await tamanhosDe(r.files[0].blob);

    // 8 páginas cabem em 4 folhas (frente e verso de 2 papéis).
    expect(paginas).toBe(4);
    expect(primeira.width).toBeCloseTo(800, 0);
    expect(primeira.height).toBeCloseTo(600, 0);
  });

  it('põe as páginas na ordem da dobra, não na ordem do documento', async () => {
    const bytes = await pdfDe(8, 400, 600);
    const r = await runOperation('booklet', contexto(bytes));

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(await r.files[0].blob.arrayBuffer()),
      isEvalSupported: false,
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    }).promise;

    const folhas: string[][] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const pagina = await doc.getPage(i);
      const conteudo = await pagina.getTextContent();
      // Ordena pelo x da matriz de texto: o que está mais à esquerda vem antes.
      folhas.push(
        conteudo.items
          .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && !!item.str.trim())
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((item) => item.str.trim()),
      );
    }
    await doc.destroy();

    // Brochura grampeada no vinco: a folha de fora carrega a última e a
    // primeira; o verso dela, a segunda e a penúltima.
    expect(folhas).toEqual([
      ['P8', 'P1'],
      ['P2', 'P7'],
      ['P6', 'P3'],
      ['P4', 'P5'],
    ]);
  });

  it('completa com páginas em branco quando não fecha múltiplo de 4', async () => {
    const bytes = await pdfDe(5, 400, 600);
    const r = await runOperation('booklet', contexto(bytes));
    const { paginas } = await tamanhosDe(r.files[0].blob);

    // 5 páginas sobem para 8, que dão 4 folhas.
    expect(paginas).toBe(4);
    expect(r.notes.join(' ')).toContain('3 página(s) em branco');
  });
});

describe('separar pares e ímpares', () => {
  it('devolve dois arquivos com a contagem certa', async () => {
    const bytes = await pdfDe(7);
    const r = await runOperation('odd-even', contexto(bytes));

    expect(r.files).toHaveLength(2);
    expect(r.files[0].name).toContain('impares');
    expect(r.files[1].name).toContain('pares');
    expect((await tamanhosDe(r.files[0].blob)).paginas).toBe(4); // 1, 3, 5, 7
    expect((await tamanhosDe(r.files[1].blob)).paginas).toBe(3); // 2, 4, 6
  });

  it('num documento de uma página só, não gera arquivo de pares vazio', async () => {
    const bytes = await pdfDe(1);
    const r = await runOperation('odd-even', contexto(bytes));

    expect(r.files).toHaveLength(1);
    expect(r.files[0].name).toContain('impares');
  });
});

describe('inserir páginas em branco', () => {
  it('entre uma página e outra, sem sobrar uma solta no fim', async () => {
    const bytes = await pdfDe(3);
    const r = await runOperation('blank-pages', contexto(bytes, { where: 'depois-de-cada', count: 1 }));

    // 3 páginas com 2 brancas no meio.
    expect((await tamanhosDe(r.files[0].blob)).paginas).toBe(5);
  });

  it('respeita a quantidade pedida no fim do documento', async () => {
    const bytes = await pdfDe(2);
    const r = await runOperation('blank-pages', contexto(bytes, { where: 'no-fim', count: 3 }));

    expect((await tamanhosDe(r.files[0].blob)).paginas).toBe(5);
  });

  it('no começo do documento', async () => {
    const bytes = await pdfDe(2);
    const r = await runOperation('blank-pages', contexto(bytes, { where: 'no-inicio', count: 2 }));

    expect((await tamanhosDe(r.files[0].blob)).paginas).toBe(4);
  });
});
