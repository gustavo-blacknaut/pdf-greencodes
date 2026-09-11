'use client';

/**
 * O texto do PDF: extrair o que está escrito, reconhecer o que é imagem (OCR)
 * e montar um Word com isso.
 *
 * Mora separado de converter.ts porque é outro assunto: lá é entrar e sair do
 * formato PDF; aqui é o texto que está dentro dele, embutido ou fotografado.
 */

import { canvasToBlob, escapeXml, openWithPdfJs, renderPageToCanvas, respirar, salvarPdf, sanitizeText } from '../nucleo';
import { type RunContext, type RunResult } from '../tipos';
import { replaceExtension, suffixName, yieldToBrowser } from '../../utils';
import { abortarSePreciso } from '../guards';
import { type OcrLanguage, createOcrWorker } from '../ocr';
import { loadPdfLib } from '../lazy';

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
 * Converte o texto do PDF num .docx mínimo, montado à mão como zip de XML
 * porque é isso que o formato é. Só o texto atravessa: layout, colunas,
 * imagens e tabelas do PDF original não são preservados.
 *
 * O texto vem de dois lugares. O embutido é o que "PDF para texto" extrai, e
 * é exato. O de página digitalizada não existe no arquivo — é foto de papel —
 * e só sai por OCR. No modo automático cada página decide: tem texto, usa;
 * não tem, reconhece. Assim um contrato com o anexo escaneado sai inteiro.
 */
export async function pdfToWord(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  const modo = String(ctx.options.ocr ?? 'automatico') as 'automatico' | 'sempre' | 'nunca';
  const lang = String(ctx.options.language ?? 'por+eng') as OcrLanguage;
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const totalPaginas = doc.numPages;
  const paginasXml: string[] = [];
  let foundText = false;

  // O motor de OCR só sobe se alguma página precisar: são alguns megabytes e
  // alguns segundos, que um PDF com texto não deve pagar.
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let paginasReconhecidas = 0;
  let somaConfianca = 0;

  try {
    for (let i = 1; i <= totalPaginas; i += 1) {
      abortarSePreciso(ctx.signal);
      ctx.onProgress((i - 1) / totalPaginas, `Lendo o texto da página ${i}/${totalPaginas}`);
      const page = await doc.getPage(i);
      let texto = '';
      if (modo !== 'sempre') {
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!('str' in item)) continue;
          texto += item.str;
          if (item.hasEOL) texto += '\n';
          else if (!item.str.endsWith(' ')) texto += ' ';
        }
      }

      if (modo === 'sempre' || (modo === 'automatico' && !texto.trim())) {
        if (!worker) {
          ctx.onProgress((i - 1) / totalPaginas, 'Preparando o reconhecimento de texto (OCR)...');
          worker = await createOcrWorker(lang);
          canvas = document.createElement('canvas');
        }
        ctx.onProgress((i - 1) / totalPaginas, `Reconhecendo o texto da página ${i}/${totalPaginas} (OCR)`);
        await renderPageToCanvas(page, 200, canvas!);
        const { data } = await worker.recognize(canvas!);
        texto = data.text ?? '';
        paginasReconhecidas += 1;
        if (typeof data.confidence === 'number') somaConfianca += data.confidence;
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
  } finally {
    await worker?.terminate();
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
      ...(paginasReconhecidas > 0
        ? [
            `${paginasReconhecidas} de ${totalPaginas} página(s) passaram por OCR, com confiança média de ${Math.round(somaConfianca / paginasReconhecidas)}%. Confira nomes e números: OCR erra.`,
          ]
        : []),
      ...(foundText
        ? []
        : [
            modo === 'nunca'
              ? 'Nenhum texto encontrado. Este PDF parece digitalizado: rode de novo com o OCR ligado.'
              : 'Nem o OCR achou texto. A página pode ser só imagem, sem escrita, ou a digitalização está muito apagada.',
          ]),
    ],
  };
}
