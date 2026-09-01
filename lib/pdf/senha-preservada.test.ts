/**
 * Um PDF protegido que entra numa ferramenta tem que sair protegido.
 *
 * Antes disso, abrir o arquivo com a senha e salvar devolvia um PDF aberto:
 * comprimir um contrato publicava o conteúdo sem avisar ninguém. Tirar a senha
 * é trabalho da ferramenta de desbloqueio, e de mais nenhuma.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

// `compress` cria um canvas mesmo no nível sem perda, que não o usa.
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({}) };

const SENHA = 'segredo123';

async function pdfProtegido(): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText('CONFIDENCIAL', { x: 30, y: 200, size: 18, font: fonte });
  doc.addPage([300, 400]).drawText('SEGUNDA', { x: 30, y: 200, size: 18, font: fonte });
  doc.encrypt({ userPassword: SENHA, ownerPassword: 'dono-do-teste' });
  const bytes = await doc.save({ useObjectStreams: false });
  return bytes.buffer as ArrayBuffer;
}

function arquivo(bytes: ArrayBuffer): LoadedFile {
  return {
    id: 'protegido',
    name: 'contrato.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: 2,
    thumbnail: null,
    senha: SENHA,
  };
}

/** Confere que o arquivo exige senha e que é a mesma de antes. */
async function exigeSenha(blob: Blob): Promise<boolean> {
  const { PDFDocument } = await loadPdfLib();
  const bytes = await blob.arrayBuffer();

  let abriuSemSenha = false;
  try {
    await PDFDocument.load(bytes);
    abriuSemSenha = true;
  } catch {
    abriuSemSenha = false;
  }
  if (abriuSemSenha) return false;

  // Com a senha certa tem que abrir; se não abrir, trocamos a senha do usuário.
  await PDFDocument.load(bytes, { password: SENHA });
  return true;
}

const OPERACOES = [
  ['compress', { level: 'sem-perda' }],
  ['reverse', {}],
  ['page-numbers', { position: 'rodape-centro', format: 'numero', startAt: 1, size: 11 }],
  ['header-footer', { header: 'INTERNO', footer: '', align: 'centro', size: 10 }],
  ['set-metadata', { title: 'Contrato', author: '', subject: '', keywords: '' }],
  ['strip-metadata', {}],
  ['flatten', {}],
  ['repair', {}],
  ['crop', { top: 5, right: 5, bottom: 5, left: 5 }],
] as const;

describe('senha do original sobrevive à operação', () => {
  for (const [operacao, opcoes] of OPERACOES) {
    it(`${operacao} devolve um PDF que ainda pede a mesma senha`, async () => {
      const bytes = await pdfProtegido();
      const ctx: RunContext = { files: [arquivo(bytes)], options: { ...opcoes }, onProgress: () => {} };
      const resultado = await runOperation(operacao, ctx);

      expect(await exigeSenha(resultado.files[0].blob)).toBe(true);
      expect(resultado.notes.join(' ')).toContain('continua protegido');
    });
  }

  it('desbloquear continua tirando a senha, que é o trabalho dela', async () => {
    const bytes = await pdfProtegido();
    const ctx: RunContext = { files: [arquivo(bytes)], options: { password: SENHA }, onProgress: () => {} };
    const resultado = await runOperation('unlock', ctx);

    expect(await exigeSenha(resultado.files[0].blob)).toBe(false);
    expect(resultado.notes.join(' ')).not.toContain('continua protegido');
  });
});
