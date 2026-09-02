/**
 * Comprimir vários arquivos e receber vários de volta obriga a juntar depois,
 * numa segunda passada. Com a opção ligada, sai um documento só.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

// compress cria um canvas mesmo no nível sem perda, que não o usa.
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({}) };

async function pdfDe(paginas: number): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([595, 842]).drawText(`P${i}`, { x: 40, y: 400, size: 24, font: fonte });
  }
  const bytes = await doc.save();
  return bytes.buffer as ArrayBuffer;
}

function arquivo(nome: string, bytes: ArrayBuffer): LoadedFile {
  return { id: nome, name: nome, size: bytes.byteLength, type: 'application/pdf', bytes, pageCount: null, thumbnail: null };
}

function contexto(arquivos: LoadedFile[], juntar: boolean): RunContext {
  return { files: arquivos, options: { level: 'sem-perda', juntar }, onProgress: () => {} };
}

async function paginasDe(blob: Blob): Promise<number> {
  const { PDFDocument } = await loadPdfLib();
  return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
}

describe('comprimir juntando', () => {
  it('sem a opção, devolve um arquivo por entrada', async () => {
    const a = arquivo('a.pdf', await pdfDe(2));
    const b = arquivo('b.pdf', await pdfDe(3));

    const r = await runOperation('compress', contexto([a, b], false));
    expect(r.files).toHaveLength(2);
  });

  it('com a opção, devolve um só com todas as páginas na ordem da fila', async () => {
    const a = arquivo('a.pdf', await pdfDe(2));
    const b = arquivo('b.pdf', await pdfDe(3));

    const r = await runOperation('compress', contexto([a, b], true));
    expect(r.files).toHaveLength(1);
    expect(await paginasDe(r.files[0].blob)).toBe(5);
    expect(r.notes.join(' ')).toContain('2 arquivos comprimidos e unidos');
  });

  it('com um arquivo só, a opção não muda nada', async () => {
    const a = arquivo('a.pdf', await pdfDe(2));

    const r = await runOperation('compress', contexto([a], true));
    expect(r.files).toHaveLength(1);
    expect(r.files[0].name).toContain('comprimido');
    expect(r.files[0].name).not.toContain('unido');
  });
});
