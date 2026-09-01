import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';

/** PDF com um marcador diferente em cada página, para conferir a ordem depois. */
async function pdfMarcado(marcadores: string[]): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const marcador of marcadores) {
    doc.addPage([300, 400]).drawText(marcador, { x: 40, y: 200, size: 24, font: fonte });
  }
  const bytes = await doc.save();
  return bytes.buffer as ArrayBuffer;
}

function arquivo(nome: string, bytes: ArrayBuffer, tipo = 'application/pdf'): LoadedFile {
  return { id: nome, name: nome, size: bytes.byteLength, type: tipo, bytes, pageCount: null, thumbnail: null };
}

function contexto(files: LoadedFile[], options: RunContext['options'] = {}): RunContext {
  return { files, options, onProgress: () => {} };
}

/** Lê o marcador de cada página, na ordem em que estão no documento. */
async function marcadoresDe(blob: Blob): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;

  const marcadores: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    marcadores.push(
      conteudo.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim(),
    );
  }
  await doc.destroy();
  return marcadores;
}

describe('inverter páginas', () => {
  it('devolve o documento de trás para frente', async () => {
    const bytes = await pdfMarcado(['A', 'B', 'C', 'D']);
    const resultado = await runOperation('reverse', contexto([arquivo('doc.pdf', bytes)]));

    expect(resultado.files).toHaveLength(1);
    expect(await marcadoresDe(resultado.files[0].blob)).toEqual(['D', 'C', 'B', 'A']);
  });
});

describe('intercalar PDF', () => {
  it('alterna as páginas invertendo o segundo arquivo, que é o caso do escâner sem duplex', async () => {
    const frentes = await pdfMarcado(['F1', 'F2', 'F3']);
    // A pilha virada sai com o verso da última folha primeiro.
    const versos = await pdfMarcado(['V3', 'V2', 'V1']);

    const resultado = await runOperation(
      'interleave',
      contexto([arquivo('frentes.pdf', frentes), arquivo('versos.pdf', versos)], { reverseSecond: true }),
    );

    expect(await marcadoresDe(resultado.files[0].blob)).toEqual(['F1', 'V1', 'F2', 'V2', 'F3', 'V3']);
  });

  it('mantém a ordem do segundo arquivo quando a inversão está desligada', async () => {
    const a = await pdfMarcado(['A1', 'A2']);
    const b = await pdfMarcado(['B1', 'B2']);

    const resultado = await runOperation(
      'interleave',
      contexto([arquivo('a.pdf', a), arquivo('b.pdf', b)], { reverseSecond: false }),
    );

    expect(await marcadoresDe(resultado.files[0].blob)).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('avisa e joga o excedente para o fim quando um arquivo tem mais páginas', async () => {
    const a = await pdfMarcado(['A1', 'A2', 'A3']);
    const b = await pdfMarcado(['B1']);

    const resultado = await runOperation(
      'interleave',
      contexto([arquivo('a.pdf', a), arquivo('b.pdf', b)], { reverseSecond: false }),
    );

    expect(await marcadoresDe(resultado.files[0].blob)).toEqual(['A1', 'B1', 'A2', 'A3']);
    expect(resultado.notes.join(' ')).toContain('3 e 1');
  });

  it('recusa quando veio um arquivo só', async () => {
    const a = await pdfMarcado(['A1']);
    await expect(runOperation('interleave', contexto([arquivo('a.pdf', a)]))).rejects.toThrow('dois arquivos');
  });
});

describe('texto para PDF', () => {
  it('monta um PDF com o conteúdo do .txt', async () => {
    const texto = new TextEncoder().encode('Primeira linha\n\nSegunda linha com acento: coração');
    const resultado = await runOperation(
      'text-to-pdf',
      contexto([arquivo('notas.txt', texto.buffer as ArrayBuffer, 'text/plain')], { size: 11 }),
    );

    expect(resultado.files[0].name).toBe('notas.pdf');
    const lido = (await marcadoresDe(resultado.files[0].blob)).join(' ');
    expect(lido).toContain('Primeira');
    expect(lido).toContain('Segunda');
    expect(lido).toContain('coração');
  });
});

describe('cabeçalho e rodapé', () => {
  it('carimba os dois textos em todas as páginas', async () => {
    const bytes = await pdfMarcado(['P1', 'P2']);
    const resultado = await runOperation(
      'header-footer',
      contexto([arquivo('doc.pdf', bytes)], { header: 'CONFIDENCIAL', footer: 'Processo 123', align: 'centro' }),
    );

    const paginas = await marcadoresDe(resultado.files[0].blob);
    expect(paginas).toHaveLength(2);
    for (const pagina of paginas) {
      expect(pagina).toContain('CONFIDENCIAL');
      expect(pagina).toContain('Processo 123');
    }
  });

  it('recusa quando os dois campos estão vazios', async () => {
    const bytes = await pdfMarcado(['P1']);
    await expect(
      runOperation('header-footer', contexto([arquivo('doc.pdf', bytes)], { header: '', footer: '  ' })),
    ).rejects.toThrow('cabeçalho ou o rodapé');
  });
});

describe('definir metadados', () => {
  it('grava título, autor e palavras-chave no arquivo', async () => {
    const bytes = await pdfMarcado(['P1']);
    const resultado = await runOperation(
      'set-metadata',
      contexto([arquivo('doc.pdf', bytes)], {
        title: 'Relatório anual',
        author: 'Fulano',
        subject: 'Fechamento',
        keywords: 'contrato, 2026',
      }),
    );

    const { PDFDocument } = await loadPdfLib();
    const lido = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(lido.getTitle()).toBe('Relatório anual');
    expect(lido.getAuthor()).toBe('Fulano');
    expect(lido.getSubject()).toBe('Fechamento');
    expect(lido.getKeywords()).toContain('contrato');
  });
});

describe('achatar formulário', () => {
  it('avisa quando o PDF não tem campo nenhum, em vez de falhar', async () => {
    const bytes = await pdfMarcado(['P1']);
    const resultado = await runOperation('flatten', contexto([arquivo('doc.pdf', bytes)]));

    expect(resultado.files).toHaveLength(1);
    expect(resultado.notes.join(' ')).toContain('não tem campos');
  });

  it('achata os campos preenchidos de um formulário de verdade', async () => {
    const { PDFDocument, StandardFonts } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([300, 200]);
    const formulario = doc.getForm();
    const campo = formulario.createTextField('nome');
    campo.setText('Fulano de Tal');
    campo.addToPage(pagina, { x: 20, y: 100, width: 200, height: 24 });
    campo.updateAppearances(await doc.embedFont(StandardFonts.Helvetica));
    const bytes = (await doc.save()).buffer as ArrayBuffer;

    const resultado = await runOperation('flatten', contexto([arquivo('form.pdf', bytes)]));
    expect(resultado.notes.join(' ')).toContain('1 campo');

    const depois = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(depois.getForm().getFields()).toHaveLength(0);
    expect((await marcadoresDe(resultado.files[0].blob)).join(' ')).toContain('Fulano de Tal');
  });
});
