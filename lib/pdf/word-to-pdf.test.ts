import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { runOperation, type LoadedFile, type RunContext } from './engine';

async function lerTextoDoPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;
  const pagina = await doc.getPage(1);
  const conteudo = await pagina.getTextContent();
  const texto = conteudo.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  await doc.destroy();
  return texto;
}

async function criarDocxDeTeste(): Promise<ArrayBuffer> {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Ola mundo</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Negrito</w:t></w:r><w:r><w:t xml:space="preserve"> e normal</w:t></w:r></w:p>
<w:p><w:r><w:t>Linha um</w:t><w:br/><w:t>Linha dois</w:t></w:r></w:p>
</w:body></w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer as ArrayBuffer;
}

describe('Word para PDF', () => {
  it('converte parágrafos, negrito e quebra de linha manual do .docx num PDF com o mesmo texto', async () => {
    const docxBytes = await criarDocxDeTeste();
    const mockFile: LoadedFile = {
      id: 'test-docx',
      name: 'exemplo.docx',
      size: docxBytes.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docxBytes,
      pageCount: null,
      thumbnail: null,
    };

    const ctx: RunContext = {
      files: [mockFile],
      options: {},
      onProgress: () => {},
    };

    const result = await runOperation('word-to-pdf', ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('exemplo.pdf');

    const pdfBytes = new Uint8Array(await result.files[0].blob.arrayBuffer());
    const texto = await lerTextoDoPdf(pdfBytes);

    expect(texto).toContain('Ola');
    expect(texto).toContain('mundo');
    expect(texto).toContain('Negrito');
    expect(texto).toContain('normal');
    expect(texto).toContain('Linha');
  });

  it('acusa quando o zip não é um .docx (falta word/document.xml)', async () => {
    const zip = new JSZip();
    zip.file('oi.txt', 'nao é um docx');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const mockFile: LoadedFile = {
      id: 'test-invalido',
      name: 'invalido.docx',
      size: bytes.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: bytes.buffer as ArrayBuffer,
      pageCount: null,
      thumbnail: null,
    };

    const ctx: RunContext = {
      files: [mockFile],
      options: {},
      onProgress: () => {},
    };

    await expect(runOperation('word-to-pdf', ctx)).rejects.toThrow('word/document.xml');
  });
});
