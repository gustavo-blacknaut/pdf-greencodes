'use client';

/** Escrever, carimbar e recortar por cima do documento. */

import { FORMATOS_MM, PAGE_NUMBER_MARGIN_PT, mmParaPt, openWithPdfLib, respirar, salvarPdf, sanitizeText } from '../nucleo';
import { type ElementoEditor, type RunContext, type RunResult } from '../tipos';
import { suffixName, yieldToBrowser } from '../../utils';
import { hexParaRgb, paraCoordenadasPdf } from '../layout';
import { loadPdfLib } from '../lazy';

export async function watermark(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, degrees, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const text = sanitizeText(String(ctx.options.text ?? '').trim());
  if (!text) throw new Error('Escreva o texto da marca d’água.');

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = Number(ctx.options.size ?? 48);
  const opacity = Math.min(1, Math.max(0.02, Number(ctx.options.opacity ?? 0.18)));
  const angle = Number(ctx.options.angle ?? 45);
  const tile = ctx.options.tile === true || ctx.options.tile === 'true';
  const shade = Number(ctx.options.shade ?? 0.4);
  const color = rgb(shade, shade, shade);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    ctx.onProgress(i / pages.length, `Aplicando na página ${i + 1}/${pages.length}`);
    const page = pages[i];
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);

    if (tile) {
      const stepX = textWidth + size * 2;
      const stepY = size * 4;
      for (let y = -height; y < height * 2; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) {
          page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(angle) });
        }
      }
    } else {
      const radians = (angle * Math.PI) / 180;
      page.drawText(text, {
        x: width / 2 - (Math.cos(radians) * textWidth) / 2,
        y: height / 2 - (Math.sin(radians) * textWidth) / 2 - size / 2,
        size,
        font,
        color,
        opacity,
        rotate: degrees(angle),
      });
    }
    if (i % 12 === 11) await yieldToBrowser();
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'marca-dagua'), blob, pages: pages.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

export async function crop(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pct = (key: string) => Math.min(45, Math.max(0, Number(ctx.options[key] ?? 0))) / 100;
  const [top, right, bottom, left] = [pct('top'), pct('right'), pct('bottom'), pct('left')];
  if (top + bottom === 0 && left + right === 0) throw new Error('Defina ao menos uma margem para cortar.');

  const pages = doc.getPages();
  pages.forEach((page) => {
    const box = page.getCropBox();
    page.setCropBox(
      box.x + box.width * left,
      box.y + box.height * bottom,
      box.width * (1 - left - right),
      box.height * (1 - top - bottom),
    );
  });

  ctx.onProgress(0.8, 'Aplicando o corte');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'cortado'), blob, pages: pages.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['O corte ajusta a área visível (CropBox); o conteúdo original continua no arquivo.'],
  };
}

export async function resize(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const target = String(ctx.options.target ?? 'a4');
  const factor = Math.max(0.1, Number(ctx.options.scale ?? 100) / 100);

  const out = await PDFDocument.create();
  const sourcePages = doc.getPages();
  const embedded = await out.embedPages(sourcePages);

  for (let i = 0; i < embedded.length; i += 1) {
    ctx.onProgress(i / embedded.length, `Página ${i + 1}/${embedded.length}`);
    const item = embedded[i];

    if (target === 'scale') {
      const page = out.addPage([item.width * factor, item.height * factor]);
      page.drawPage(item, { x: 0, y: 0, xScale: factor, yScale: factor });
      continue;
    }

    const medida =
      target === 'personalizado'
        ? {
            largura: Math.min(Math.max(Number(ctx.options.larguraMm) || 210, 10), 2000),
            altura: Math.min(Math.max(Number(ctx.options.alturaMm) || 297, 10), 2000),
          }
        : (FORMATOS_MM[target as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4);
    const w = mmParaPt(medida.largura);
    const h = mmParaPt(medida.altura);

    // Mantemos a orientação de cada página original.
    const landscape = item.width > item.height;
    const pageW = landscape ? h : w;
    const pageH = landscape ? w : h;
    const page = out.addPage([pageW, pageH]);
    const ratio = Math.min(pageW / item.width, pageH / item.height);
    page.drawPage(item, {
      x: (pageW - item.width * ratio) / 2,
      y: (pageH - item.height * ratio) / 2,
      xScale: ratio,
      yScale: ratio,
    });
    if (i % 20 === 19) await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'redimensionado'), blob, pages: embedded.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

export async function pageNumbers(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();
  const posicao = String(ctx.options.position ?? 'rodape-centro');
  const formato = String(ctx.options.format ?? 'numero');
  const inicioEm = Math.max(1, Math.round(Number(ctx.options.startAt ?? 1)));
  const tamanho = Math.max(6, Number(ctx.options.size ?? 11));
  const ultimoNumero = inicioEm + paginas.length - 1;

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Numerando página ${i + 1}/${paginas.length}`);
    const pagina = paginas[i];
    const { width, height } = pagina.getSize();
    const numero = inicioEm + i;
    const texto = formato === 'de-total' ? `Página ${numero} de ${ultimoNumero}` : String(numero);
    const largura = fonte.widthOfTextAtSize(texto, tamanho);

    const y = posicao.startsWith('rodape') ? PAGE_NUMBER_MARGIN_PT : height - PAGE_NUMBER_MARGIN_PT - tamanho;
    const x = posicao.endsWith('esquerda')
      ? PAGE_NUMBER_MARGIN_PT
      : posicao.endsWith('direita')
        ? width - PAGE_NUMBER_MARGIN_PT - largura
        : (width - largura) / 2;

    pagina.drawText(texto, { x, y, size: tamanho, font: fonte, color: rgb(0.4, 0.45, 0.42) });
    await respirar(ctx);
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'numerado'), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/** Carimba um texto fixo no topo e/ou no pé de cada página. */
export async function headerFooter(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = doc.getPages();

  const cabecalho = sanitizeText(String(ctx.options.header ?? '')).trim();
  const rodape = sanitizeText(String(ctx.options.footer ?? '')).trim();
  const alinhamento = String(ctx.options.align ?? 'centro');
  const tamanho = Math.max(6, Math.min(24, Number(ctx.options.size ?? 10)));
  const margem = PAGE_NUMBER_MARGIN_PT;

  if (!cabecalho && !rodape) throw new Error('Escreva pelo menos o cabeçalho ou o rodapé.');

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Página ${i + 1}/${paginas.length}`);
    const pagina = paginas[i];
    const { width, height } = pagina.getSize();

    for (const [texto, y] of [
      [cabecalho, height - margem - tamanho],
      [rodape, margem],
    ] as const) {
      if (!texto) continue;
      const larguraTexto = fonte.widthOfTextAtSize(texto, tamanho);
      const x =
        alinhamento === 'esquerda'
          ? margem
          : alinhamento === 'direita'
            ? width - margem - larguraTexto
            : (width - larguraTexto) / 2;
      pagina.drawText(texto, { x, y, size: tamanho, font: fonte, color: rgb(0.4, 0.45, 0.42) });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'carimbado'), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/**
 * Achata formulários: o que estava preenchido vira conteúdo fixo da página e
 * deixa de ser editável. Serve para enviar um formulário sem que a outra ponta
 * mude os campos.
 */
export async function flatten(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const notes: string[] = [];

  ctx.onProgress(0.3, 'Procurando campos de formulário...');
  try {
    const formulario = doc.getForm();
    const campos = formulario.getFields().length;
    if (campos > 0) {
      formulario.flatten();
      notes.push(`${campos} campo(s) de formulário viraram conteúdo fixo e não podem mais ser editados.`);
    } else {
      notes.push('Este PDF não tem campos de formulário. O arquivo foi só reescrito, sem outras mudanças.');
    }
  } catch {
    notes.push('Não foi possível achatar os campos deste formulário. O arquivo saiu reescrito, sem alteração.');
  }

  ctx.onProgress(0.8, 'Salvando...');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'achatado'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  };
}

export async function edit(ctx: RunContext): Promise<RunResult> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);

  let elementos: ElementoEditor[];
  try {
    elementos = JSON.parse(String(ctx.options.elementos ?? '[]'));
  } catch {
    throw new Error('Não foi possível ler as edições.');
  }
  if (!elementos.length) throw new Error('Adicione ao menos um item ao documento antes de salvar.');

  const paginas = doc.getPages();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < elementos.length; i += 1) {
    const elemento = elementos[i];
    ctx.onProgress(i / elementos.length, `Aplicando ${i + 1} de ${elementos.length}`);

    const pagina = paginas[elemento.pagina];
    if (!pagina) continue;

    const { width: larguraPagina, height: alturaPagina } = pagina.getSize();
    const caixa = paraCoordenadasPdf(elemento, larguraPagina, alturaPagina);
    const cor = hexParaRgb(elemento.cor ?? '#000000');

    if (elemento.tipo === 'retangulo') {
      pagina.drawRectangle({
        x: caixa.x,
        y: caixa.y,
        width: caixa.largura,
        height: caixa.altura,
        color: rgb(cor.r, cor.g, cor.b),
        opacity: elemento.opacidade ?? 1,
      });
      continue;
    }

    if (elemento.tipo === 'imagem' && elemento.dataUrl) {
      const png = await (await fetch(elemento.dataUrl)).arrayBuffer();
      const imagem = await doc.embedPng(png);
      pagina.drawImage(imagem, {
        x: caixa.x,
        y: caixa.y,
        width: caixa.largura,
        height: caixa.altura,
      });
      continue;
    }

    if (elemento.tipo === 'texto') {
      const texto = sanitizeText(String(elemento.texto ?? ''));
      if (!texto.trim()) continue;
      const tamanho = Math.max(4, Number(elemento.tamanho ?? 14));
      const usada = elemento.cor === 'negrito' ? fonteNegrito : fonte;
      pagina.drawText(texto, {
        x: caixa.x,
        // drawText ancora na linha de base da primeira linha, não no topo da caixa.
        y: caixa.y + caixa.altura - tamanho,
        size: tamanho,
        font: usada,
        color: rgb(cor.r, cor.g, cor.b),
        lineHeight: tamanho * 1.2,
        maxWidth: caixa.largura,
      });
    }

    await respirar(ctx);
  }

  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  const sufixo = ctx.options.editor === 'assinatura' ? 'assinado' : 'editado';
  return {
    files: [{ name: suffixName(source.name, sufixo), blob, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`${elementos.length} ${elementos.length === 1 ? 'item aplicado' : 'itens aplicados'}.`],
  };
}
