import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { runOperation, type LoadedFile, type RunContext } from './engine';

// O pdf.js do navegador procura o worker por URL; no Node quem roda é o
// "legacy", que traz o worker junto — o mesmo que os outros testes usam.
vi.mock('./lazy', async (original) => ({
  ...(await original<typeof import('./lazy')>()),
  loadPdfJs: async () => import('pdfjs-dist/legacy/build/pdf.mjs'),
}));

/**
 * PDF para Word, com e sem OCR.
 *
 * O OCR em si precisa de canvas e do tesseract, que só existem no navegador
 * e no aplicativo — lá ele foi conferido rodando. O que se prova aqui é a
 * decisão de cada página: com texto, o texto dela vai para o .docx sem subir
 * o OCR; sem OCR, a página digitalizada vira um aviso claro, e não um Word
 * vazio sem explicação.
 */

async function pdf(paginas: (string | null)[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const texto of paginas) {
    const pagina = doc.addPage([595, 842]);
    // null é página "digitalizada": só desenho, nenhuma letra no arquivo.
    if (texto === null) pagina.drawRectangle({ x: 50, y: 50, width: 400, height: 600 });
    else pagina.drawText(texto, { x: 50, y: 780, size: 14, font: fonte });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

function contexto(bytes: ArrayBuffer, ocr: string): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: 'contrato.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options: { ocr, language: 'por' }, onProgress: () => {} };
}

async function textoDoDocx(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('\n');
}

describe('PDF para Word', () => {
  it('no automático, página com texto usa o texto dela e não sobe o OCR', async () => {
    // Se o OCR subisse aqui, estouraria: no Node não existe canvas.
    const resultado = await runOperation('pdf-to-word', contexto(await pdf(['Clausula primeira', 'Clausula segunda']), 'automatico'));
    const texto = await textoDoDocx(resultado.files[0].blob);
    expect(texto).toContain('Clausula primeira');
    expect(texto).toContain('Clausula segunda');
    expect(resultado.notes.join(' ')).not.toMatch(/OCR/);
    expect(resultado.files[0].name).toBe('contrato.docx');
  });

  it('sem OCR, a página digitalizada vira aviso para ligar o OCR', async () => {
    const resultado = await runOperation('pdf-to-word', contexto(await pdf([null]), 'nunca'));
    expect(resultado.notes.join(' ')).toMatch(/rode de novo com o OCR ligado/);
  });

  it('o campo de OCR existe, vem no automático, e o idioma só aparece com OCR', async () => {
    const { getTool, isFieldVisible } = await import('../tools');
    const ferramenta = getTool('pdf-para-word')!;
    const ocr = ferramenta.fields.find((f) => f.key === 'ocr')!;
    const idioma = ferramenta.fields.find((f) => f.key === 'language')!;
    expect(ocr.default).toBe('automatico');
    expect(isFieldVisible(idioma, { ocr: 'automatico' })).toBe(true);
    expect(isFieldVisible(idioma, { ocr: 'nunca' })).toBe(false);
  });
});
