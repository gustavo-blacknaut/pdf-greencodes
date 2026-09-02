/**
 * Cada quantidade por folha tem uma grade e uma orientação. O teste confere o
 * número de folhas e o tamanho delas, que é onde a orientação aparece.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

async function pdfDe(paginas: number): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([595, 842]).drawText(`P${i}`, { x: 40, y: 400, size: 30, font: f });
  }
  const b = await doc.save();
  return b.buffer as ArrayBuffer;
}

function ctx(bytes: ArrayBuffer, perSheet: number): RunContext {
  const file: LoadedFile = { id: 'a', name: 'doc.pdf', size: bytes.byteLength, type: 'application/pdf', bytes, pageCount: null, thumbnail: null };
  return { files: [file], options: { perSheet }, onProgress: () => {} };
}

async function medir(blob: Blob) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  const { width, height } = doc.getPage(0).getSize();
  return { folhas: doc.getPageCount(), deitada: width > height };
}

describe('várias por folha', () => {
  const casos: [number, number, boolean][] = [
    // [por folha, folhas esperadas para 24 páginas, deitada]
    [2, 12, true],
    [4, 6, false],
    [6, 4, false],
    [8, 3, false],
    [9, 3, false],
    [12, 2, false],
    [16, 2, false],
  ];

  for (const [porFolha, folhas, deitada] of casos) {
    it(`${porFolha} por folha: 24 páginas viram ${folhas} folha(s)`, async () => {
      const r = await runOperation('n-up', ctx(await pdfDe(24), porFolha));
      const medida = await medir(r.files[0].blob);
      expect(medida.folhas).toBe(folhas);
      expect(medida.deitada).toBe(deitada);
    });
  }

  it('quantidade fora da lista cai em 2, em vez de quebrar', async () => {
    const r = await runOperation('n-up', ctx(await pdfDe(4), 7));
    expect((await medir(r.files[0].blob)).folhas).toBe(2);
  });
});
