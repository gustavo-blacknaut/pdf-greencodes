/**
 * O desbloqueio tem três caminhos, do que preserva mais para o que preserva
 * menos. Estes testes prendem o comportamento de cada um e, principalmente,
 * garantem que erro interno do pdf-lib nunca chegue à tela: um "Expected
 * instance of rs, but got instance of undefined" não diz nada a ninguém.
 */
import { describe, expect, it, vi } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

async function pdfProtegido(userPassword: string): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText('FATURA 12345', { x: 30, y: 200, size: 18, font: fonte });
  doc.encrypt({
    userPassword,
    ownerPassword: 'dono-secreto',
    permissions: { printing: false, copying: false, modifying: false },
  });
  const bytes = await doc.save({ useObjectStreams: false });
  return bytes.buffer as ArrayBuffer;
}

function contexto(bytes: ArrayBuffer, password = ''): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: 'Fatura_02_09_2026.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options: { password }, onProgress: () => {} };
}

/** Abre sem senha e ainda tem o texto? */
async function conferir(blob: Blob): Promise<{ abreSemSenha: boolean; texto: string }> {
  const { PDFDocument } = await loadPdfLib();
  const bytes = await blob.arrayBuffer();

  let abreSemSenha = false;
  try {
    await PDFDocument.load(bytes);
    abreSemSenha = true;
  } catch {
    abreSemSenha = false;
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;
  const conteudo = await (await doc.getPage(1)).getTextContent();
  const texto = conteudo.items.map((item) => ('str' in item ? item.str : '')).join('');
  await doc.destroy();

  return { abreSemSenha, texto };
}

describe('desbloquear PDF', () => {
  it('tira as restrições de um PDF sem senha de abertura, preservando o texto', async () => {
    const bytes = await pdfProtegido('');
    const r = await runOperation('unlock', contexto(bytes));

    const { abreSemSenha, texto } = await conferir(r.files[0].blob);
    expect(abreSemSenha).toBe(true);
    expect(texto).toContain('FATURA 12345');
    expect(r.notes[0]).toContain('Não foi preciso digitar senha');
  });

  it('remove a senha de abertura quando ela é informada', async () => {
    const bytes = await pdfProtegido('segredo123');
    const r = await runOperation('unlock', contexto(bytes, 'segredo123'));

    const { abreSemSenha, texto } = await conferir(r.files[0].blob);
    expect(abreSemSenha).toBe(true);
    expect(texto).toContain('FATURA 12345');
  });

  it('pede a senha em vez de vazar erro interno da biblioteca', async () => {
    const bytes = await pdfProtegido('segredo123');
    await expect(runOperation('unlock', contexto(bytes))).rejects.toThrow(/senha de abertura/i);
  });

  it('avisa que a senha está errada quando a informada não serve', async () => {
    const bytes = await pdfProtegido('segredo123');
    await expect(runOperation('unlock', contexto(bytes, 'chute-errado'))).rejects.toThrow(/senha incorreta/i);
  });

  it('cai para a reescrita inteira quando a cópia página a página falha', async () => {
    const bytes = await pdfProtegido('');
    const { PDFDocument } = await loadPdfLib();

    // Reproduz o arquivo do usuário: o pdf-lib carrega, mas clonar o grafo de
    // objetos estoura com o erro de tipo dele.
    const original = PDFDocument.prototype.copyPages;
    const espiao = vi
      .spyOn(PDFDocument.prototype, 'copyPages')
      .mockRejectedValueOnce(new TypeError('Expected instance of rs, but got instance of undefined'));

    try {
      const r = await runOperation('unlock', contexto(bytes));
      const { abreSemSenha, texto } = await conferir(r.files[0].blob);

      expect(abreSemSenha).toBe(true);
      expect(texto).toContain('FATURA 12345');
      expect(r.notes.join(' ')).toContain('reescrito inteiro');
      // O erro cru da biblioteca não pode aparecer em lugar nenhum.
      expect(r.notes.join(' ')).not.toContain('Expected instance');
    } finally {
      espiao.mockRestore();
      PDFDocument.prototype.copyPages = original;
    }
  });
});
