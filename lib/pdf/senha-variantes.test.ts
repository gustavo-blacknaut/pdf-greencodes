/**
 * Senha certa recusada por detalhe de digitação.
 *
 * Dois casos reais, e nenhum deles é a pessoa ter errado a senha:
 *
 * - Espaço sobrando, que vem junto quando se copia a senha de um e-mail.
 * - Acento em forma diferente. "coração" pode estar composto (NFC, padrão no
 *   Windows) ou decomposto (NFD, padrão no macOS). Os bytes são outros e o PDF
 *   guarda o hash de uma forma só.
 *
 * Tentar essas formas não é adivinhar senha: é a mesma senha que a pessoa
 * digitou, escrita de outro jeito.
 *
 * O caminho contrário (arquivo em NFD, pessoa digitando NFC) não é testado
 * porque não existe: acento decomposto não cabe na codificação que o PDF usa
 * para senha, e a própria biblioteca recusa criar um arquivo assim.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

async function pdfComSenha(senha: string): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText('FATURA', { x: 30, y: 200, size: 18, font: fonte });
  doc.encrypt({ userPassword: senha, ownerPassword: 'dono-secreto' });
  const bytes = await doc.save({ useObjectStreams: false });
  return bytes.buffer as ArrayBuffer;
}

function contexto(bytes: ArrayBuffer, password: string): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: 'Fatura.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options: { password }, onProgress: () => {} };
}

async function abreSemSenha(blob: Blob): Promise<boolean> {
  const { PDFDocument } = await loadPdfLib();
  try {
    await PDFDocument.load(await blob.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}

describe('formas da mesma senha', () => {
  it('aceita a senha com espaço sobrando na ponta', async () => {
    const bytes = await pdfComSenha('senha123');
    const r = await runOperation('unlock', contexto(bytes, '  senha123 '));
    expect(await abreSemSenha(r.files[0].blob)).toBe(true);
  });

  it('aceita acento decomposto quando o arquivo guardou o composto', async () => {
    const senha = 'coração2026';
    const bytes = await pdfComSenha(senha.normalize('NFC'));

    // O que um teclado de Mac costuma produzir.
    const r = await runOperation('unlock', contexto(bytes, senha.normalize('NFD')));
    expect(await abreSemSenha(r.files[0].blob)).toBe(true);
  });

  it('continua recusando senha que é realmente outra', async () => {
    const bytes = await pdfComSenha('senha123');
    await expect(runOperation('unlock', contexto(bytes, 'outra-coisa'))).rejects.toThrow(/senha incorreta/i);
  });
});
