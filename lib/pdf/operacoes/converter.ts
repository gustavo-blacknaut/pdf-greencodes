'use client';

/**
 * Entrar e sair do formato PDF.
 *
 * Os arquivos do Office são zip de XML por dentro, e são lidos aqui com um
 * parser mínimo — só o conteúdo atravessa, nunca o visual.
 */

import { PAGE_SIZES, type PdfDoc, canvasToBlob, copy, decodificarEntidadesXml, desenharPaginaDeImagem, drawPdfImage, escapeXml, mmParaPt, openWithPdfJs, renderPageToCanvas, respirar, salvarPdf, sanitizeText, tamanhoDaPagina, toPdfBlob, zipFiles } from '../nucleo';
import { type Ajuste, type OutputFile, type RunContext, type RunResult } from '../tipos';
import { replaceExtension, suffixName, yieldToBrowser } from '../../utils';
import { abortarSePreciso } from '../guards';
import { type OcrLanguage, createOcrWorker } from '../ocr';
import { split } from './organizar';
import { loadPdfJs, loadPdfLib } from '../lazy';

export async function pdfToImages(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const dpi = Number(ctx.options.dpi ?? 150);
  const format = String(ctx.options.format ?? 'jpeg');
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const quality = format === 'png' ? undefined : Number(ctx.options.quality ?? 0.85);
  const canvas = document.createElement('canvas');
  const padWidth = String(doc.numPages).length;

  const images: { name: string; blob: Blob }[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Renderizando página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    await renderPageToCanvas(page, dpi, canvas);
    images.push({
      name: `${source.name.replace(/\.[^.]+$/, '')}-${String(i).padStart(padWidth, '0')}.${ext}`,
      blob: await canvasToBlob(canvas, mime, quality),
    });
    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  if (images.length === 1) {
    ctx.onProgress(1);
    return { files: images, inputBytes: source.size, outputBytes: images[0].blob.size, notes: [] };
  }

  ctx.onProgress(0.95, 'Compactando em .zip');
  const zip = await zipFiles(images);
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'zip'), blob: zip, pages: images.length }],
    inputBytes: source.size,
    outputBytes: zip.size,
    notes: [`${images.length} imagens a ${dpi} DPI.`],
  };
}

export async function imagesToPdf(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  const margem = mmParaPt(Number(ctx.options.margemMm ?? 0));
  const ajuste = String(ctx.options.ajuste ?? 'proporcao') as Ajuste;
  let inputBytes = 0;

  for (let i = 0; i < ctx.files.length; i += 1) {
    const source = ctx.files[i];
    inputBytes += source.size;
    ctx.onProgress(i / ctx.files.length, `Convertendo ${source.name}`);

    const bitmap = await createImageBitmap(new Blob([copy(source.bytes)], { type: source.type }));
    const pagina = tamanhoDaPagina(ctx.options, bitmap.width, bitmap.height);

    await desenharPaginaDeImagem(out, canvas, bitmap, pagina, margem, ajuste);
    bitmap.close();
    await respirar(ctx);
  }

  const name = String(ctx.options.filename || 'imagens').replace(/[\\/:*?"<>|]/g, '') || 'imagens';
  const blob = toPdfBlob(await out.save({ useObjectStreams: true }));
  ctx.onProgress(1);
  return {
    files: [{ name: `${name}.pdf`, blob, pages: out.getPageCount() }],
    inputBytes,
    outputBytes: blob.size,
    notes: [],
  };
}

export async function pdfToText(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const separators = ctx.options.separators !== false && ctx.options.separators !== 'false';
  const chunks: string[] = [];
  let foundText = false;

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Extraindo texto da página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
      else if (!item.str.endsWith(' ')) text += ' ';
    }
    const clean = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (clean) foundText = true;
    chunks.push(separators ? `--- Página ${i} ---\n${clean}` : clean);
    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  const body = chunks.join('\n\n');
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'txt'), blob, pages: doc.numPages }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: foundText
      ? []
      : ['Nenhum texto encontrado. Este PDF provavelmente é digitalizado: rode a ferramenta de OCR antes.'],
  };
}

/**
 * OCR: reconhece o texto de um PDF digitalizado e devolve um PDF pesquisável.
 *
 * Cada página vira imagem (o visual não muda) e o texto reconhecido é
 * desenhado por cima na mesma posição, com renderMode invisível. O resultado
 * parece igual ao original, mas dá para selecionar, copiar e pesquisar.
 */
export async function ocr(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const lang = String(ctx.options.language ?? 'por+eng') as OcrLanguage;
  const { PDFDocument, StandardFonts, TextRenderingMode } = await loadPdfLib();
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const totalPaginas = doc.numPages;
  const out = await PDFDocument.create();
  const fonte = await out.embedFont(StandardFonts.Helvetica);
  const canvas = document.createElement('canvas');
  const dpi = 200;

  ctx.onProgress(0, 'Preparando o motor de OCR (a primeira vez baixa alguns megabytes)...');
  const worker = await createOcrWorker(lang);

  let somaConfianca = 0;
  let paginasComBaixaConfianca = 0;

  try {
    for (let i = 1; i <= totalPaginas; i += 1) {
      abortarSePreciso(ctx.signal);
      ctx.onProgress((i - 1) / totalPaginas, `Reconhecendo texto da página ${i}/${totalPaginas}`);

      const page = await doc.getPage(i);
      const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);
      page.cleanup();

      const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.85);
      const embutida = await out.embedJpg(await jpeg.arrayBuffer());
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: false, tsv: false });

      const novaPagina = out.addPage([widthPt, heightPt]);
      novaPagina.drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

      const escala = 72 / dpi;
      for (const word of data.words) {
        const texto = sanitizeText(word.text ?? '');
        if (!texto.trim()) continue;
        const alturaPx = word.bbox.y1 - word.bbox.y0;
        const tamanho = Math.max(4, alturaPx * escala);
        novaPagina.drawText(texto, {
          x: word.bbox.x0 * escala,
          y: heightPt - word.bbox.y1 * escala,
          size: tamanho,
          font: fonte,
          renderMode: TextRenderingMode.Invisible,
        });
      }

      if (typeof data.confidence === 'number') {
        somaConfianca += data.confidence;
        if (data.confidence < 60) paginasComBaixaConfianca += 1;
      }

      await respirar(ctx);
    }
  } finally {
    await worker.terminate();
  }
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const confianca = totalPaginas ? Math.round(somaConfianca / totalPaginas) : 0;
  return {
    files: [{ name: suffixName(source.name, 'pesquisavel'), blob, pages: totalPaginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `Confiança média do reconhecimento: ${confianca}%.`,
      ...(paginasComBaixaConfianca > 0
        ? [`${paginasComBaixaConfianca} página(s) com baixa confiança — confira o texto selecionável.`]
        : []),
      'O texto reconhecido fica invisível sobre a imagem da página original: a aparência não muda, mas dá para selecionar, copiar e pesquisar.',
    ],
  };
}

/**
 * Converte o texto embutido do PDF (o mesmo que "PDF para texto" extrai) num
 * .docx mínimo, montado à mão como zip de XML porque é isso que o formato é.
 * Só o texto atravessa: layout, colunas, imagens e tabelas do PDF original
 * não são preservados.
 */
export async function pdfToWord(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const totalPaginas = doc.numPages;
  const paginasXml: string[] = [];
  let foundText = false;

  for (let i = 1; i <= totalPaginas; i += 1) {
    ctx.onProgress((i - 1) / totalPaginas, `Extraindo texto da página ${i}/${totalPaginas}`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let texto = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      texto += item.str;
      if (item.hasEOL) texto += '\n';
      else if (!item.str.endsWith(' ')) texto += ' ';
    }
    const linhas = texto
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .split('\n');
    if (linhas.some((linha) => linha.trim())) foundText = true;

    const paragrafos = linhas.length
      ? linhas.map((linha) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(linha)}</w:t></w:r></w:p>`).join('')
      : '<w:p/>';
    const quebraDePagina = i < totalPaginas ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
    paginasXml.push(paragrafos + quebraDePagina);

    page.cleanup();
    await yieldToBrowser();
  }
  await doc.destroy();

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paginasXml.join('')}<w:sectPr/></w:body></w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'docx'), blob, pages: totalPaginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Só o texto sai no .docx: layout, colunas, imagens e tabelas do PDF original não são preservados.',
      ...(foundText
        ? []
        : ['Nenhum texto encontrado. Este PDF provavelmente é digitalizado: rode a ferramenta de OCR antes.']),
    ],
  };
}

export type ParagrafoDocx = { runs: { texto: string; negrito: boolean }[] };

/**
 * Lê os parágrafos de um .docx com um parser XML mínimo, na unha, em vez de
 * DOMParser: essa API não existe fora do navegador, e este mesmo motor roda
 * em teste (Node). Cada <w:p> vira um item, cada <w:r> um run com o texto dos
 * <w:t>, os <w:tab/> e as quebras manuais de <w:br/>.
 */
export function lerParagrafosDoXml(documentXml: string): ParagrafoDocx[] {
  const paragrafos: ParagrafoDocx[] = [];
  const reParagrafo = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let matchParagrafo: RegExpExecArray | null;
  while ((matchParagrafo = reParagrafo.exec(documentXml))) {
    // w:pPr guarda as propriedades do parágrafo (inclui a marca de fim de
    // parágrafo, que pode ter seu próprio rPr): tirar isso fora evita
    // confundir formatação do marcador com um run de texto de verdade.
    const corpo = matchParagrafo[1].replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g, '');
    const runs: { texto: string; negrito: boolean }[] = [];
    const reRun = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let matchRun: RegExpExecArray | null;
    while ((matchRun = reRun.exec(corpo))) {
      const runXml = matchRun[1];
      const rPr = runXml.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
      const tagNegrito = rPr.match(/<w:b\b[^>]*\/?>/)?.[0];
      const negrito = Boolean(tagNegrito) && !/w:val="(0|false)"/.test(tagNegrito!);

      let texto = '';
      const reConteudo = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
      let matchConteudo: RegExpExecArray | null;
      while ((matchConteudo = reConteudo.exec(runXml))) {
        if (matchConteudo[0].startsWith('<w:tab')) texto += '\t';
        else if (matchConteudo[0].startsWith('<w:br')) texto += '\n';
        else texto += decodificarEntidadesXml(matchConteudo[1] ?? '');
      }
      if (texto) runs.push({ texto, negrito });
    }
    paragrafos.push({ runs });
  }
  return paragrafos;
}

export async function lerParagrafosDocx(bytes: ArrayBuffer): Promise<ParagrafoDocx[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Não encontramos word/document.xml dentro do arquivo: não parece ser um .docx válido.');
  }
  return lerParagrafosDoXml(documentXml);
}

/**
 * Desenha parágrafos de texto num PDF novo em A4, quebrando linha por largura
 * e abrindo página quando a margem de baixo é alcançada.
 *
 * A fonte é Helvetica, que só cobre Latin-1. Caractere fora disso quebraria o
 * `drawText`, então é trocado por "?" antes de entrar.
 */
export async function pdfDeParagrafos(
  paragrafos: ParagrafoDocx[],
  tamanhoFonte: number,
  deitada = false,
): Promise<{ doc: PdfDoc; algumTexto: boolean }> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  // Slide é deitado; documento de texto é em pé. Sem isto a apresentação
  // saía num formato que ela nunca teve.
  const [curto, longo] = PAGE_SIZES.a4;
  const [largura, altura] = deitada ? [longo, curto] : [curto, longo];
  const margem = 56.7; // 20 mm
  const alturaLinha = tamanhoFonte * 1.4;
  const larguraUtil = largura - margem * 2;

  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

  let pagina = doc.addPage([largura, altura]);
  let y = altura - margem;
  let algumTexto = false;

  const novaPagina = () => {
    pagina = doc.addPage([largura, altura]);
    y = altura - margem;
  };

  for (const paragrafo of paragrafos) {
    if (!paragrafo.runs.length) {
      y -= alturaLinha;
      if (y < margem) novaPagina();
      continue;
    }

    let x = margem;
    for (const run of paragrafo.runs) {
      const fonteRun = run.negrito ? fonteNegrito : fonte;
      const linhas = sanitizeText(run.texto).replace(/\t/g, '    ').split('\n');
      for (let li = 0; li < linhas.length; li += 1) {
        for (const palavra of linhas[li].split(/\s+/).filter(Boolean)) {
          const larguraPalavra = fonteRun.widthOfTextAtSize(palavra, tamanhoFonte);
          const espaco = x > margem ? fonteRun.widthOfTextAtSize(' ', tamanhoFonte) : 0;
          if (x + espaco + larguraPalavra > margem + larguraUtil && x > margem) {
            x = margem;
            y -= alturaLinha;
            if (y < margem) novaPagina();
          } else {
            x += espaco;
          }
          pagina.drawText(palavra, { x, y, size: tamanhoFonte, font: fonteRun, color: rgb(0.06, 0.06, 0.06) });
          algumTexto = true;
          x += larguraPalavra;
        }
        if (li < linhas.length - 1) {
          x = margem;
          y -= alturaLinha;
          if (y < margem) novaPagina();
        }
      }
    }
    y -= alturaLinha;
    if (y < margem) novaPagina();
  }

  return { doc, algumTexto };
}

/**
 * Converte um .docx num PDF a partir do texto dos parágrafos. Só o texto
 * atravessa: layout, colunas, imagens e tabelas do original não são preservados.
 */
export async function wordToPdf(ctx: RunContext): Promise<RunResult> {
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Só o texto entra no PDF: layout, colunas, imagens e tabelas do documento original não são preservados.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const paragrafos = await lerParagrafosDocx(source.bytes);
    const { doc, algumTexto } = await pdfDeParagrafos(paragrafos, 11);

    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    if (!algumTexto) notes.push(`${source.name}: não encontramos texto dentro do documento.`);
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}

/**
 * Lê uma planilha .xlsx.
 *
 * O texto das células não fica na planilha: os valores de texto vão todos para
 * sharedStrings.xml e a célula guarda só o índice (t="s"). Número, data e
 * fórmula ficam no próprio <v>, já calculados pelo Excel.
 */
export async function lerPlanilha(bytes: ArrayBuffer): Promise<{ nome: string; linhas: string[][] }[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);

  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbook) {
    throw new Error('Não encontramos xl/workbook.xml: o arquivo não parece ser um .xlsx válido.');
  }

  const compartilhadas: string[] = [];
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (sharedXml) {
    for (const item of sharedXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? []) {
      // Uma célula com formatação vira vários <t>; juntamos todos.
      const pedacos = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificarEntidadesXml(m[1]));
      compartilhadas.push(pedacos.join(''));
    }
  }

  const nomes = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/g)].map((m) =>
    decodificarEntidadesXml(m[1]),
  );

  const planilhas: { nome: string; linhas: string[][] }[] = [];
  for (let i = 0; i < nomes.length; i += 1) {
    const folha = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)?.async('string');
    if (!folha) continue;

    const linhas: string[][] = [];
    for (const linhaXml of folha.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const celulas: string[] = [];
      for (const celula of linhaXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        // A referência (A1, B1...) diz a coluna: sem isso, uma célula vazia no
        // meio da linha desloca todo o resto para a esquerda.
        const coluna = celula.match(/r="([A-Z]+)\d+"/)?.[1];
        const indice = coluna
          ? [...coluna].reduce((soma, letra) => soma * 26 + (letra.charCodeAt(0) - 64), 0) - 1
          : celulas.length;

        const tipo = celula.match(/\bt="([^"]*)"/)?.[1];
        let valor = '';
        if (tipo === 'inlineStr') {
          valor = [...celula.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((m) => decodificarEntidadesXml(m[1]))
            .join('');
        } else {
          const bruto = celula.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
          if (bruto !== undefined) {
            valor = tipo === 's' ? (compartilhadas[Number(bruto)] ?? '') : decodificarEntidadesXml(bruto);
          }
        }

        while (celulas.length < indice) celulas.push('');
        celulas[indice] = valor;
      }
      linhas.push(celulas);
    }
    planilhas.push({ nome: nomes[i], linhas });
  }
  return planilhas;
}

/**
 * Planilha para PDF: cada aba vira uma seção, com as colunas em largura fixa.
 * Fórmula entra com o resultado que o Excel gravou; gráfico, imagem, cor e
 * célula mesclada não atravessam.
 */
export async function excelToPdf(ctx: RunContext): Promise<RunResult> {
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Só o conteúdo das células atravessa. Gráficos, imagens, cores e células mescladas não são preservados.',
    'Fórmula entra com o último resultado que o Excel gravou no arquivo, porque nada é recalculado aqui.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const planilhas = await lerPlanilha(source.bytes);
    const paragrafos: ParagrafoDocx[] = [];
    let algumaCelula = false;

    for (const planilha of planilhas) {
      if (planilhas.length > 1) {
        paragrafos.push({ runs: [{ texto: planilha.nome, negrito: true }] });
        paragrafos.push({ runs: [] });
      }
      for (const linha of planilha.linhas) {
        if (linha.some((celula) => celula.trim())) algumaCelula = true;
        // Largura fixa por coluna mantém a leitura em tabela sem desenhar
        // grade; o corte evita que uma célula longa empurre o resto da linha.
        paragrafos.push({
          runs: [{ texto: linha.map((celula) => celula.slice(0, 28).padEnd(18)).join(' '), negrito: false }],
        });
      }
      paragrafos.push({ runs: [] });
    }

    const { doc } = await pdfDeParagrafos(paragrafos, 8);
    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    if (!algumaCelula) notes.push(`${source.name}: não encontramos células preenchidas.`);
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}

/**
 * Apresentação para PDF: uma seção por slide, com o texto na ordem em que
 * aparece no XML. Cada <a:p> é um parágrafo dentro de uma caixa de texto.
 */
export async function powerpointToPdf(ctx: RunContext): Promise<RunResult> {
  const JSZip = (await import('jszip')).default;
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  const notes: string[] = [
    'Sai o texto dos slides. Layout, imagens, cores, animações e notas do apresentador ficam de fora.',
  ];

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const zip = await JSZip.loadAsync(source.bytes);
    // slide2 antes de slide10: ordenação numérica, não alfabética.
    const arquivos = Object.keys(zip.files)
      .filter((nome) => /^ppt\/slides\/slide\d+\.xml$/.test(nome))
      .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));

    if (!arquivos.length) {
      throw new Error('Não encontramos slides dentro do arquivo: ele não parece ser um .pptx válido.');
    }

    const paragrafos: ParagrafoDocx[] = [];
    let algumTexto = false;

    for (let s = 0; s < arquivos.length; s += 1) {
      const xml = await zip.file(arquivos[s])!.async('string');
      paragrafos.push({ runs: [{ texto: `Slide ${s + 1}`, negrito: true }] });

      for (const bloco of xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? []) {
        const texto = [...bloco.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
          .map((m) => decodificarEntidadesXml(m[1]))
          .join('');
        if (!texto.trim()) continue;
        algumTexto = true;
        paragrafos.push({ runs: [{ texto, negrito: false }] });
      }

      paragrafos.push({ runs: [] });
      await respirar(ctx);
    }

    // Apresentação é deitada, como o slide na tela.
    const { doc } = await pdfDeParagrafos(paragrafos, 11, true);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });

    notes.push(
      algumTexto
        ? `${source.name}: ${arquivos.length} slide(s) lidos.`
        : `${source.name}: os slides não têm texto, só imagens.`,
    );
  }

  ctx.onProgress(1);
  return { files: outputs, inputBytes, outputBytes, notes };
}

/** Cada linha do .txt vira um parágrafo; o resto é o mesmo do .docx. */
export async function textToPdf(ctx: RunContext): Promise<RunResult> {
  const tamanhoFonte = Math.max(7, Math.min(18, Number(ctx.options.size ?? 11)));
  const outputs: OutputFile[] = [];
  let inputBytes = 0;
  let outputBytes = 0;

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    ctx.onProgress(f / ctx.files.length, `Lendo ${source.name}`);

    const texto = new TextDecoder('utf-8').decode(source.bytes).replace(/\r\n?/g, '\n');
    const paragrafos: ParagrafoDocx[] = texto
      .split('\n')
      .map((linha) => ({ runs: linha.trim() ? [{ texto: linha, negrito: false }] : [] }));

    const { doc } = await pdfDeParagrafos(paragrafos, tamanhoFonte);
    await respirar(ctx);
    const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
    outputBytes += blob.size;
    outputs.push({ name: replaceExtension(source.name, 'pdf'), blob, pages: doc.getPageCount() });
  }

  ctx.onProgress(1);
  return {
    files: outputs,
    inputBytes,
    outputBytes,
    notes: ['O texto entra em Helvetica, com quebra de linha automática. Acentuação é preservada.'],
  };
}

export async function extractImages(ctx: RunContext): Promise<RunResult> {
  const pdfjs = await loadPdfJs();
  const source = ctx.files[0];
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const minSize = Number(ctx.options.minSize ?? 64);
  const format = String(ctx.options.format ?? 'png');
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  const canvas = document.createElement('canvas');
  const scratch = document.createElement('canvas');
  const seen = new Set<string>();
  const images: { name: string; blob: Blob }[] = [];
  let skipped = 0;

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Vasculhando a página ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    // O pdf.js só materializa os XObjects de imagem quando a página é
    // rasterizada. Sem esta renderização descartável em miniatura, o
    // objs.get() abaixo espera por um objeto que nunca chega.
    await renderPageToCanvas(page, 12, scratch);
    const ops = await page.getOperatorList();

    for (let op = 0; op < ops.fnArray.length; op += 1) {
      const isXObject = ops.fnArray[op] === pdfjs.OPS.paintImageXObject;
      const isInline = ops.fnArray[op] === pdfjs.OPS.paintInlineImageXObject;
      if (!isXObject && !isInline) continue;

      try {
        const arg = ops.argsArray[op][0];
        let image;
        if (isInline) {
          image = arg;
        } else {
          // Imagens repetidas em várias páginas vivem em commonObjs; as
          // exclusivas da página, em objs. Pedir na loja errada trava.
          const id = String(arg);
          const store = page.commonObjs.has(id) ? page.commonObjs : page.objs;
          // Rede de segurança: um objeto que nunca resolve não pode travar a ferramenta.
          image = await Promise.race([
            new Promise((resolve) => store.get(id, resolve)),
            new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
        }
        if (!image || image.width < minSize || image.height < minSize) {
          skipped += 1;
          continue;
        }
        if (!drawPdfImage(image, canvas)) {
          skipped += 1;
          continue;
        }

        const blob = await canvasToBlob(canvas, mime, format === 'jpeg' ? 0.9 : undefined);
        // A mesma imagem costuma ser referenciada por várias páginas com ids
        // diferentes; dimensões + tamanho do arquivo separam as repetições.
        const fingerprint = `${image.width}x${image.height}:${blob.size}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        images.push({
          name: `${source.name.replace(/\.[^.]+$/, '')}-img-${String(images.length + 1).padStart(3, '0')}.${ext}`,
          blob,
        });
      } catch {
        skipped += 1;
      }
      await respirar(ctx);
    }
    page.cleanup();
  }
  await doc.destroy();

  if (!images.length) {
    throw new Error(
      skipped > 0
        ? 'As imagens deste PDF estão em formatos que não conseguimos extrair.'
        : 'Nenhuma imagem encontrada neste PDF.',
    );
  }

  const notes = skipped > 0 ? [`${skipped} imagem(ns) ignorada(s) por serem pequenas ou ilegíveis.`] : [];
  if (images.length === 1) {
    ctx.onProgress(1);
    return { files: images, inputBytes: source.size, outputBytes: images[0].blob.size, notes };
  }

  ctx.onProgress(0.95, 'Compactando em .zip');
  const zip = await zipFiles(images);
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(source.name, 'zip'), blob: zip, pages: images.length }],
    inputBytes: source.size,
    outputBytes: zip.size,
    notes: [`${images.length} imagens extraídas.`, ...notes],
  };
}
