/**
 * Regressão do bug "juntei e o arquivo saiu em branco".
 *
 * Causa original: o documento era aberto com `ignoreEncryption: true`, que abre
 * o PDF sem descriptografar. As páginas existem, a contagem bate, a miniatura
 * até aparece, e o conteúdo copiado continua cifrado. O resultado abre em
 * branco e imprime nada.
 *
 * O caso que pega na prática é o PDF protegido só com senha de dono: prova,
 * boleto, extrato. Ele abre normalmente em qualquer leitor, nunca pede senha, e
 * por isso ninguém desconfia que está cifrado.
 */
import { describe, expect, it } from 'vitest';

const A4: [number, number] = [595.28, 841.89];
const MARCADOR = 'CONTEUDO PRESERVADO';

async function pdfLib() {
  return import('@cantoo/pdf-lib');
}

/** Gera um PDF com texto e a proteção pedida. */
async function gerarPdf(protecao?: { userPassword?: string; ownerPassword: string }): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage(A4).drawText(MARCADOR, { x: 60, y: 760, size: 16, font: fonte, color: rgb(0, 0, 0) });

  if (protecao) {
    doc.encrypt({
      ...(protecao.userPassword ? { userPassword: protecao.userPassword } : {}),
      ownerPassword: protecao.ownerPassword,
      permissions: { printing: 'highResolution' },
    });
    return doc.save({ useObjectStreams: false });
  }
  return doc.save();
}

/** Lê o texto de volta com o pdf.js, que é quem enxerga o que o leitor enxerga. */
async function textoDo(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    // Cópia obrigatória: o pdf.js destaca o buffer que recebe, e quem reusasse
    // o mesmo array depois encontraria zero bytes.
    data: bytes.slice(),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;

  let texto = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const conteudo = await (await doc.getPage(i)).getTextContent();
    texto += conteudo.items.map((item) => ('str' in item ? item.str : '')).join('');
  }
  await doc.destroy();
  return texto.trim();
}

/** Reproduz o que a operação de juntar faz: abre, copia as páginas, salva. */
async function juntar(entradas: Uint8Array[], senha = ''): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const saida = await PDFDocument.create();

  for (const bytes of entradas) {
    const doc = await PDFDocument.load(bytes, { password: senha, updateMetadata: false });
    const paginas = await saida.copyPages(doc, doc.getPageIndices());
    paginas.forEach((pagina) => saida.addPage(pagina));
  }

  return saida.save({ useObjectStreams: true });
}

describe('juntar PDF protegido', () => {
  it('preserva o conteúdo de um PDF travado só com senha de dono', async () => {
    const protegido = await gerarPdf({ ownerPassword: 'dono-secreto' });
    expect(await textoDo(protegido)).toContain(MARCADOR);

    const unido = await juntar([protegido]);
    expect(await textoDo(unido), 'a página saiu em branco: o conteúdo não foi descriptografado').toContain(MARCADOR);
  });

  it('preserva o conteúdo ao misturar arquivo protegido com arquivo comum', async () => {
    const unido = await juntar([await gerarPdf({ ownerPassword: 'x' }), await gerarPdf()]);
    const texto = await textoDo(unido);
    expect(texto.match(new RegExp(MARCADOR, 'g'))?.length).toBe(2);
  });

  it('abre com a senha certa quando existe senha de abertura', async () => {
    const comSenha = await gerarPdf({ userPassword: 'abrir123', ownerPassword: 'dono' });
    const unido = await juntar([comSenha], 'abrir123');
    expect(await textoDo(unido)).toContain(MARCADOR);
  });

  it('recusa a senha errada em vez de gerar arquivo vazio em silêncio', async () => {
    const comSenha = await gerarPdf({ userPassword: 'abrir123', ownerPassword: 'dono' });
    await expect(juntar([comSenha], 'chute-errado')).rejects.toThrow();
  });

  it('entrega o resultado sem senha nenhuma', async () => {
    const protegido = await gerarPdf({ userPassword: 'abrir123', ownerPassword: 'dono' });
    const unido = await juntar([protegido], 'abrir123');

    const { PDFDocument } = await pdfLib();
    // Se ainda estivesse cifrado, abrir sem senha lançaria.
    const reaberto = await PDFDocument.load(unido);
    expect(reaberto.getPageCount()).toBe(1);
  });

  it('pinta o fundo branco atrás do conteúdo, e não por cima', async () => {
    const { PDFDocument, StandardFonts, rgb, PDFName } = await pdfLib();

    // Página com grupo de transparência e sem fundo: some ao juntar.
    const origem = await PDFDocument.create();
    const fonte = await origem.embedFont(StandardFonts.Helvetica);
    const pagina = origem.addPage([400, 300]);
    pagina.drawText(MARCADOR, { x: 20, y: 150, size: 14, font: fonte, color: rgb(0, 0, 0) });
    pagina.node.set(
      PDFName.of('Group'),
      origem.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' }),
    );

    const doc = await PDFDocument.load(await origem.save(), { password: '' });
    const saida = await PDFDocument.create();
    const [copiada] = await saida.copyPages(doc, [0]);
    saida.addPage(copiada);

    const caixa = copiada.getMediaBox();
    const fundo = saida.context.register(
      saida.context.flateStream(`q 1 1 1 rg ${caixa.x} ${caixa.y} ${caixa.width} ${caixa.height} re f Q\n`),
    );
    const vazio = saida.context.register(saida.context.flateStream(''));
    expect(copiada.node.wrapContentStreams(fundo, vazio)).toBe(true);

    // O texto continua lá: o branco entrou por baixo, não por cima.
    expect(await textoDo(await saida.save())).toContain(MARCADOR);
  });

  it('demonstra por que ignoreEncryption não serve', async () => {
    const { PDFDocument } = await pdfLib();
    const protegido = await gerarPdf({ ownerPassword: 'dono-secreto' });

    // Caminho antigo: abre, parece funcionar, e devolve página vazia.
    const doc = await PDFDocument.load(protegido, { ignoreEncryption: true, updateMetadata: false });
    const saida = await PDFDocument.create();
    (await saida.copyPages(doc, doc.getPageIndices())).forEach((p) => saida.addPage(p));

    expect(doc.getPageCount(), 'a contagem de páginas engana: parece que deu certo').toBe(1);
    expect(await textoDo(await saida.save()), 'era este o bug').toBe('');
  });
});
