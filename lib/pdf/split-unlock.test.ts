import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

async function criarPdfDeTeste(numPaginas: number): Promise<ArrayBuffer> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const textoLongo = 'Conteúdo de teste para preencher a página do PDF. '.repeat(100);
  for (let i = 0; i < numPaginas; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Página ${i + 1}: ${textoLongo}`);
  }
  const bytes = await doc.save();
  return bytes.buffer as ArrayBuffer;
}

describe('dividir e desbloquear PDF', () => {
  it('divide o PDF em partes por tamanho (mode size)', async () => {
    const pdfBytes = await criarPdfDeTeste(10);
    const mockFile: LoadedFile = {
      id: 'test1',
      name: 'exemplo.pdf',
      size: pdfBytes.byteLength,
      type: 'application/pdf',
      bytes: pdfBytes,
      pageCount: 10,
      thumbnail: null,
    };

    const ctx: RunContext = {
      files: [mockFile],
      options: { mode: 'size', maxSize: 0.005 }, // ~5KB por parte
      onProgress: () => {},
    };

    const result = await runOperation('split', ctx);
    expect(result.files.length).toBeGreaterThan(1);
    expect(result.notes[0]).toContain('Dividido por tamanho limite');
  });

  it('extrai apenas as páginas selecionadas no modo extract', async () => {
    const pdfBytes = await criarPdfDeTeste(5);
    const mockFile: LoadedFile = {
      id: 'test2',
      name: 'exemplo.pdf',
      size: pdfBytes.byteLength,
      type: 'application/pdf',
      bytes: pdfBytes,
      pageCount: 5,
      thumbnail: null,
    };

    const ctx: RunContext = {
      files: [mockFile],
      options: { mode: 'extract', extractRanges: '1, 3, 5' },
      onProgress: () => {},
    };

    const result = await runOperation('split', ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].pages).toBe(3);
    expect(result.notes[0]).toContain('3 página(s) extraída(s)');
  });

  it('desbloqueia PDF sem necessidade de digitar senha quando não há senha de abertura', async () => {
    const pdfBytes = await criarPdfDeTeste(2);
    const mockFile: LoadedFile = {
      id: 'test3',
      name: 'documento.pdf',
      size: pdfBytes.byteLength,
      type: 'application/pdf',
      bytes: pdfBytes,
      pageCount: 2,
      thumbnail: null,
    };

    const ctx: RunContext = {
      files: [mockFile],
      options: { password: '' },
      onProgress: () => {},
    };

    const result = await runOperation('unlock', ctx);
    expect(result.files).toHaveLength(1);
    expect(result.notes[0]).toContain('sem necessidade de digitar senha');
  });
});
