'use client';

/** Senha, permissões e os dados que o arquivo carrega sobre si. */

import { type PdfDoc, canvasToBlob, isPasswordError, openWithPdfJs, openWithPdfLib, renderPageToCanvas, respirar, salvarPdf, sanitizeText, toPdfBlob } from '../nucleo';
import { type RunContext, type RunResult } from '../tipos';
import { suffixName } from '../../utils';
import { split } from './organizar';
import { loadPdfLib } from '../lazy';

export async function stripMetadata(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const epoch = new Date(0);

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('');
  doc.setCreator('');
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);

  ctx.onProgress(0.6, 'Reescrevendo o documento');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'limpo'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Autor, título, produtor e datas de criação foram zerados.'],
  };
}

export async function protect(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const password = String(ctx.options.password ?? '');
  if (password.length < 4) throw new Error('Use uma senha de pelo menos 4 caracteres.');

  const doc = await openWithPdfLib(source.bytes, source.senha);
  ctx.onProgress(0.4, 'Criptografando');

  const allow = (key: string) => ctx.options[key] === true || ctx.options[key] === 'true';
  doc.encrypt({
    userPassword: password,
    // Senha de dono distinta e aleatória: sem ela, quem abre com a senha de
    // usuário teria acesso total e as permissões não valeriam nada.
    ownerPassword: `dono-${crypto.randomUUID()}`,
    permissions: {
      printing: allow('printing') ? 'highResolution' : false,
      copying: allow('copying'),
      modifying: allow('modifying'),
      annotating: allow('modifying'),
      fillingForms: allow('modifying'),
      documentAssembly: allow('modifying'),
      contentAccessibility: true,
    },
  });

  // Object streams não convivem bem com criptografia, então gravamos sem eles.
  const blob = toPdfBlob(await doc.save({ useObjectStreams: false }));
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'protegido'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Guarde a senha: sem ela nem nós conseguimos reabrir o arquivo.'],
  };
}

/**
 * Remove a proteção de um PDF.
 *
 * Não existe um caminho que sirva para todo arquivo, então são três, do que
 * preserva mais para o que preserva menos:
 *
 * 1. Copiar as páginas para um documento novo. Sai limpo, sem sobra nenhuma da
 *    estrutura de criptografia.
 * 2. Reserializar o documento como o pdf-lib o entendeu. `copyPages` precisa
 *    percorrer e clonar o grafo inteiro de objetos e quebra quando algum ramo
 *    não decifrou; salvar direto só reescreve o que já foi lido, e é o que
 *    resolve boa parte dos arquivos que morriam com erro de tipo do pdf-lib.
 * 3. Redesenhar as páginas como imagem, usando o pdf.js. É o único caminho
 *    quando o pdf-lib entende a criptografia pela metade, e custa o texto:
 *    o resultado vira imagem e deixa de ser pesquisável.
 */
export async function unlock(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const senha = String(ctx.options.password ?? '') || source.senha || '';

  const finalizar = (blob: Blob, paginas: number, notes: string[]): RunResult => ({
    files: [{ name: suffixName(source.name, 'desbloqueado'), blob, pages: paginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  });

  const semSenha = senha.length === 0;
  const comoAbriu = semSenha
    ? 'Não foi preciso digitar senha: o arquivo só tinha restrições de permissão.'
    : 'Senha removida. O arquivo gerado abre sem pedir nada.';

  let doc: PdfDoc | null = null;
  let erroAoAbrir: unknown = null;
  try {
    doc = await openWithPdfLib(source.bytes, senha);
  } catch (error) {
    erroAoAbrir = error;
  }

  if (doc) {
    const { PDFDocument } = await loadPdfLib();
    const paginas = doc.getPageCount();

    // 1. Documento novo, só com as páginas.
    try {
      ctx.onProgress(0.4, 'Removendo a proteção');
      const limpo = await PDFDocument.create();
      const copiadas = await limpo.copyPages(doc, doc.getPageIndices());
      copiadas.forEach((pagina) => limpo.addPage(pagina));
      const blob = toPdfBlob(await limpo.save({ useObjectStreams: true }));
      ctx.onProgress(1);
      return finalizar(blob, limpo.getPageCount(), [comoAbriu]);
    } catch {
      /* grafo incompleto: tenta reescrever sem clonar */
    }

    // 2. Reserializar o que o pdf-lib leu.
    try {
      ctx.onProgress(0.6, 'Reescrevendo o arquivo');
      const blob = toPdfBlob(await doc.save({ useObjectStreams: false }));
      ctx.onProgress(1);
      return finalizar(blob, paginas, [
        comoAbriu,
        'Este arquivo não aceitou a reconstrução página a página, então foi reescrito inteiro. Confira se abriu como esperado.',
      ]);
    } catch {
      /* nem reescrever deu: sobra o caminho pelo pdf.js */
    }
  }

  // 3. Redesenhar pelo pdf.js, que decifra formatos que o pdf-lib não cobre.
  let docJs;
  try {
    docJs = await openWithPdfJs(source.bytes, senha || undefined);
  } catch (error) {
    if (isPasswordError(error) || (erroAoAbrir && isPasswordError(erroAoAbrir))) {
      throw new Error(
        semSenha
          ? 'Este PDF exige a senha de abertura. Digite-a no campo acima para continuar.'
          : 'Senha incorreta para este arquivo.',
      );
    }
    throw new Error('Não foi possível ler este PDF: a criptografia dele não é reconhecida.');
  }

  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= docJs.numPages; i += 1) {
    ctx.onProgress((i - 1) / docJs.numPages, `Redesenhando a página ${i} de ${docJs.numPages}`);
    const page = await docJs.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, 150, canvas);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });
    page.cleanup();
    await respirar(ctx);
  }
  await docJs.destroy();

  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return finalizar(blob, out.getPageCount(), [
    comoAbriu,
    'A estrutura interna deste PDF não sobreviveu à remoção da proteção, então as páginas foram redesenhadas como imagem. O documento abre e imprime normalmente, mas o texto deixou de ser selecionável e pesquisável.',
  ]);
}

/**
 * Escreve título, autor, assunto e palavras-chave. O contrário de "Limpar
 * metadados", para quem precisa que o documento se identifique direito num
 * acervo ou num sistema de busca.
 */
export async function setMetadata(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);

  const titulo = sanitizeText(String(ctx.options.title ?? '')).trim();
  const autor = sanitizeText(String(ctx.options.author ?? '')).trim();
  const assunto = sanitizeText(String(ctx.options.subject ?? '')).trim();
  const palavras = sanitizeText(String(ctx.options.keywords ?? '')).trim();

  ctx.onProgress(0.4, 'Gravando os campos...');
  doc.setTitle(titulo);
  doc.setAuthor(autor);
  doc.setSubject(assunto);
  doc.setKeywords(palavras ? palavras.split(',').map((p) => p.trim()).filter(Boolean) : []);
  doc.setModificationDate(new Date());

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'com-dados'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['Campo deixado em branco é gravado vazio, apagando o que estava lá antes.'],
  };
}
