'use client';

/**
 * Leitura dos arquivos que entram, e o desenho deles para a interface.
 *
 * É o que roda antes de qualquer ferramenta: conferir o que o arquivo é,
 * contar páginas, gerar miniatura e destravar o que veio com senha.
 */

import { yieldToBrowser } from '../utils';
import { LIMITES, pareceMesmoDocx, pareceMesmoImagem, pareceMesmoPdf, pareceSerImagem } from './guards';
import { isPasswordError, openWithPdfJs, openWithPdfLib, renderPageToCanvas } from './nucleo';
import { split } from './operacoes/organizar';
import { type LoadedFile, type PaginaParaEditor } from './tipos';

export async function imageThumbnail(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

export async function inspectFile(file: File, id: string): Promise<LoadedFile> {
  const bytes = await file.arrayBuffer();
  const base: LoadedFile = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''),
    bytes,
    pageCount: null,
    thumbnail: null,
  };

  const nomeMinusculo = base.name.toLowerCase();
  // .docx, .xlsx e .pptx sao o mesmo pacote zip de XML por dentro.
  const ehOfficePeloNome = /\.(docx|xlsx|pptx)$/.test(nomeMinusculo);
  const ehTxtPeloNome = nomeMinusculo.endsWith('.txt');

  const ehImagem = pareceSerImagem(nomeMinusculo, base.type);

  if (!ehImagem && !nomeMinusculo.endsWith('.pdf') && !ehOfficePeloNome && !ehTxtPeloNome) {
    return { ...base, error: 'Formato não suportado.' };
  }

  // Texto puro não tem assinatura para conferir nem estrutura para inspecionar.
  if (ehTxtPeloNome) return { ...base, pageCount: null };

  // O conteúdo manda, não a extensão nem o MIME informado pelo sistema: os dois
  // são só rótulos e podem estar mentindo. Quem não passa daqui não chega ao parser.
  if (ehImagem) {
    if (!pareceMesmoImagem(bytes)) {
      return { ...base, error: 'Tem nome de imagem, mas o conteúdo não é de nenhum formato de imagem conhecido.' };
    }
    return { ...base, pageCount: 1, thumbnail: await imageThumbnail(file) };
  }

  if (ehOfficePeloNome) {
    if (!pareceMesmoDocx(bytes)) {
      return { ...base, error: `Este arquivo tem extensão ${base.name.split('.').pop()} mas o conteúdo não é um documento do Office válido.` };
    }
    return { ...base, pageCount: null };
  }

  if (!pareceMesmoPdf(bytes)) {
    return { ...base, error: 'Este arquivo tem extensão .pdf mas o conteúdo não é um PDF.' };
  }

  try {
    const doc = await openWithPdfJs(bytes);
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, 48, canvas);
    const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
    const pageCount = doc.numPages;
    await doc.destroy();
    return { ...base, pageCount, thumbnail };
  } catch (error) {
    if (isPasswordError(error)) {
      return { ...base, locked: true, error: 'Protegido por senha' };
    }
    // Ainda pode ser utilizável, só não conseguimos gerar a miniatura.
    try {
      const doc = await openWithPdfLib(bytes);
      return { ...base, pageCount: doc.getPageCount() };
    } catch {
      return { ...base, error: 'Não foi possível ler este PDF (pode estar corrompido).' };
    }
  }
}

/**
 * Tenta abrir um PDF travado com a senha que a pessoa digitou.
 *
 * Devolve o arquivo já com miniatura e contagem de páginas, para dar retorno na
 * hora: se a miniatura apareceu, a senha valeu. A senha fica só neste objeto,
 * em memória, e some quando a aba fecha.
 */
export async function desbloquearArquivo(arquivo: LoadedFile, senha: string): Promise<LoadedFile> {
  let doc;
  try {
    doc = await openWithPdfJs(arquivo.bytes, senha);
  } catch (error) {
    throw new Error(
      isPasswordError(error) ? 'Senha incorreta para este arquivo.' : 'Não foi possível abrir este PDF.',
    );
  }

  try {
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    await renderPageToCanvas(page, 48, canvas);
    page.cleanup();
    return {
      ...arquivo,
      senha,
      locked: false,
      error: undefined,
      pageCount: doc.numPages,
      thumbnail: canvas.toDataURL('image/jpeg', 0.7),
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Miniaturas de todas as páginas, entregues uma a uma conforme ficam prontas.
 * Assim a grade vai se preenchendo, em vez de piscar tudo de uma vez no fim.
 */
export async function renderPageThumbnails(
  bytes: ArrayBuffer,
  onPage: (index: number, dataUrl: string, total: number) => void,
  cancelToken: { cancelled: boolean },
): Promise<void> {
  const doc = await openWithPdfJs(bytes);
  const canvas = document.createElement('canvas');
  // Documentos enormes não podem virar milhares de imagens em memória; acima do
  // teto as páginas continuam na grade, só que identificadas pelo número.
  const ate = Math.min(doc.numPages, LIMITES.miniaturas);
  try {
    for (let i = 1; i <= ate; i += 1) {
      if (cancelToken.cancelled) return;
      const page = await doc.getPage(i);
      await renderPageToCanvas(page, 36, canvas);
      onPage(i - 1, canvas.toDataURL('image/jpeg', 0.72), doc.numPages);
      page.cleanup();
      await yieldToBrowser();
    }
  } finally {
    await doc.destroy();
  }
}

/**
 * Desenha uma página para o editor visual.
 *
 * O viewport é forçado em `rotation: 0` de propósito: assim o que aparece na
 * tela é exatamente o espaço de coordenadas em que o pdf-lib vai desenhar, e a
 * conversão de posição vira uma regra de três. Com rotação embutida, cada uma
 * das quatro orientações precisaria de uma matriz diferente, e um erro ali
 * colocaria a assinatura no lugar errado sem ninguém perceber.
 */
export async function renderPaginaParaEditor(
  bytes: ArrayBuffer,
  indice: number,
  larguraAlvo = 1000,
): Promise<PaginaParaEditor> {
  const doc = await openWithPdfJs(bytes);
  try {
    const page = await doc.getPage(indice + 1);
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const escala = Math.min(2, larguraAlvo / base.width);
    const viewport = page.getViewport({ scale: escala, rotation: 0 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Seu navegador bloqueou o canvas 2D, necessário para o editor.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

    const resultado: PaginaParaEditor = {
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      larguraPt: base.width,
      alturaPt: base.height,
      rotacao: ((page.rotate % 360) + 360) % 360,
      totalPaginas: doc.numPages,
    };
    page.cleanup();
    return resultado;
  } finally {
    await doc.destroy();
  }
}
