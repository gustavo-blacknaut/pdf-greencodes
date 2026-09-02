import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { runOperation, type LoadedFile, type RunContext } from './engine';

/**
 * Monta um .xlsx do jeito que o Excel monta: texto vai para sharedStrings e a
 * célula guarda só o índice; número fica direto no <v>.
 */
async function xlsxDeTeste(): Promise<ArrayBuffer> {
  const compartilhadas = ['Produto', 'Quantidade', 'Parafuso', 'Porca'];
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">${compartilhadas
    .map((texto) => `<si><t>${texto}</t></si>`)
    .join('')}</sst>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Estoque" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>150</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3"><v>42</v></c></row>
</sheetData></worksheet>`;

  const zip = new JSZip();
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/sharedStrings.xml', sharedStrings);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer as ArrayBuffer;
}

async function pptxDeTeste(): Promise<ArrayBuffer> {
  const slide = (titulo: string, corpo: string) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>${titulo}</a:t></a:r></a:p><a:p><a:r><a:t>${corpo}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

  const zip = new JSZip();
  // Fora de ordem de propósito: slide10 não pode vir antes de slide2.
  zip.file('ppt/slides/slide10.xml', slide('Decimo slide', 'ultimo'));
  zip.file('ppt/slides/slide1.xml', slide('Abertura', 'primeiro'));
  zip.file('ppt/slides/slide2.xml', slide('Segundo slide', 'meio'));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer as ArrayBuffer;
}

function contexto(nome: string, bytes: ArrayBuffer): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: nome,
    size: bytes.byteLength,
    type: '',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options: {}, onProgress: () => {} };
}

async function textoDoPdf(blob: Blob): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    paginas.push(conteudo.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await doc.destroy();
  return paginas;
}

describe('Excel para PDF', () => {
  it('resolve as strings compartilhadas e mantém os números', async () => {
    const bytes = await xlsxDeTeste();
    const r = await runOperation('excel-to-pdf', contexto('estoque.xlsx', bytes));

    expect(r.files[0].name).toBe('estoque.pdf');
    const texto = (await textoDoPdf(r.files[0].blob)).join(' ');
    expect(texto).toContain('Produto');
    expect(texto).toContain('Quantidade');
    expect(texto).toContain('Parafuso');
    expect(texto).toContain('150');
  });

  it('não desloca a linha quando a planilha pula uma coluna', async () => {
    const bytes = await xlsxDeTeste();
    const r = await runOperation('excel-to-pdf', contexto('estoque.xlsx', bytes));
    const texto = (await textoDoPdf(r.files[0].blob)).join(' ');

    // A linha 3 tem A3 e C3, sem B3: o 42 é da coluna C e não pode encostar
    // no "Porca", que está em A.
    const posPorca = texto.indexOf('Porca');
    const pos42 = texto.indexOf('42');
    expect(posPorca).toBeGreaterThanOrEqual(0);
    expect(pos42).toBeGreaterThan(posPorca);
  });

  it('recusa um zip que não é planilha', async () => {
    const zip = new JSZip();
    zip.file('leiame.txt', 'nada aqui');
    const bytes = (await zip.generateAsync({ type: 'uint8array' })).buffer as ArrayBuffer;

    await expect(runOperation('excel-to-pdf', contexto('falso.xlsx', bytes as ArrayBuffer))).rejects.toThrow(
      'workbook.xml',
    );
  });
});

describe('PowerPoint para PDF', () => {
  it('lê os slides em ordem numérica, e não alfabética', async () => {
    const bytes = await pptxDeTeste();
    const r = await runOperation('powerpoint-to-pdf', contexto('palestra.pptx', bytes));

    expect(r.files[0].name).toBe('palestra.pdf');
    const texto = (await textoDoPdf(r.files[0].blob)).join(' ');

    const posAbertura = texto.indexOf('Abertura');
    const posSegundo = texto.indexOf('Segundo');
    const posDecimo = texto.indexOf('Decimo');
    expect(posAbertura).toBeGreaterThanOrEqual(0);
    expect(posSegundo).toBeGreaterThan(posAbertura);
    expect(posDecimo).toBeGreaterThan(posSegundo);
  });

  it('recusa um zip sem slides dentro', async () => {
    const zip = new JSZip();
    zip.file('leiame.txt', 'nada aqui');
    const bytes = (await zip.generateAsync({ type: 'uint8array' })).buffer as ArrayBuffer;

    await expect(runOperation('powerpoint-to-pdf', contexto('falso.pptx', bytes))).rejects.toThrow('slides');
  });
});
