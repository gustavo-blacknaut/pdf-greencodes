/**
 * O organizar deixou de trabalhar com um arquivo só.
 *
 * Antes a grade mostrava as páginas de um PDF e o plano era índice mais giro.
 * Agora a mesma grade recebe vários PDFs e aceita folha em branco no meio —
 * e arrastar uma página passou a mudar a ordem entre arquivos, sem precisar
 * de uma segunda ideia de "ordem dos arquivos".
 *
 * O que se testa aqui é o que o plano promete: cada página vem do arquivo
 * certo, a folha em branco nasce na medida da vizinha, e o plano antigo — sem
 * o campo de arquivo — continua funcionando.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { applyPlan } from './operacoes/organizar';
import type { LoadedFile, RunContext } from './tipos';

/**
 * Um PDF cujas páginas dá para reconhecer depois pela medida.
 *
 * Ler texto exigiria o pdf.js; a medida da página o pdf-lib entrega, e é
 * suficiente para saber de onde cada página veio.
 */
async function pdfDe(paginas: number, largura: number, altura: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) {
    const pagina = doc.addPage([largura, altura]);
    pagina.drawRectangle({ x: 5, y: 5, width: 20, height: 10 + i * 5, color: rgb(0, 0, 0) });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

function arquivo(bytes: ArrayBuffer, name: string): LoadedFile {
  return { id: name, name, size: bytes.byteLength, type: 'application/pdf', bytes, pageCount: null, thumbnail: null };
}

function pedido(arquivos: LoadedFile[], plan: unknown, board = 'organize'): RunContext {
  return {
    files: arquivos,
    options: { board, plan: JSON.stringify(plan) },
    onProgress: () => {},
  };
}

const medidas = async (blob: Blob) =>
  (await PDFDocument.load(await blob.arrayBuffer()))
    .getPages()
    .map((p) => `${Math.round(p.getSize().width)}x${Math.round(p.getSize().height)}`);

describe('plano com um arquivo só', () => {
  it('continua funcionando sem o campo de arquivo', async () => {
    // É o formato antigo. Quem tinha um plano na tela não pode perdê-lo.
    const a = await pdfDe(3, 200, 300);
    const resultado = await applyPlan(pedido([arquivo(a, 'a.pdf')], [{ i: 2, r: 0 }, { i: 0, r: 0 }]));

    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(2);
  });

  it('gira o que foi mandado girar', async () => {
    const a = await pdfDe(2, 200, 300);
    const resultado = await applyPlan(pedido([arquivo(a, 'a.pdf')], [{ i: 0, r: 90 }, { i: 1, r: 0 }]));

    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });
});

describe('plano com vários arquivos', () => {
  it('cada página vem do arquivo que o plano indicou', async () => {
    /*
     * As medidas identificam a origem: o primeiro arquivo é 200x300, o
     * segundo é 400x500. Um `f` ignorado traria tudo do primeiro, e a
     * sequência de medidas denuncia.
     */
    const a = await pdfDe(2, 200, 300);
    const b = await pdfDe(2, 400, 500);

    const resultado = await applyPlan(
      pedido(
        [arquivo(a, 'a.pdf'), arquivo(b, 'b.pdf')],
        [
          { f: 1, i: 0, r: 0 },
          { f: 0, i: 1, r: 0 },
          { f: 1, i: 1, r: 0 },
        ],
      ),
    );

    expect(await medidas(resultado.files[0].blob)).toEqual(['400x500', '200x300', '400x500']);
  });

  it('conta os arquivos na nota', async () => {
    const a = await pdfDe(1, 200, 300);
    const b = await pdfDe(1, 200, 300);
    const resultado = await applyPlan(
      pedido([arquivo(a, 'a.pdf'), arquivo(b, 'b.pdf')], [{ f: 0, i: 0, r: 0 }, { f: 1, i: 0, r: 0 }]),
    );
    expect(resultado.notes.join(' ')).toMatch(/2 arquivos/);
  });

  it('descarta a página que aponta para arquivo que não existe', async () => {
    // Plano velho apontando para uma fila que encolheu. Descartar é melhor
    // que estourar com a fila inteira já montada.
    const a = await pdfDe(2, 200, 300);
    const resultado = await applyPlan(
      pedido([arquivo(a, 'a.pdf')], [{ f: 0, i: 0, r: 0 }, { f: 5, i: 0, r: 0 }]),
    );
    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
  });

  it('não repete fonte nem imagem ao copiar do mesmo arquivo', async () => {
    /*
     * As páginas de um mesmo arquivo são copiadas numa chamada só. Copiando
     * uma a uma, cada chamada traz a sua cópia do que as páginas dividem, e
     * o arquivo incha — o que aparece no tamanho.
     */
    const a = await pdfDe(10, 200, 300);
    const plano = Array.from({ length: 10 }, (_, i) => ({ f: 0, i, r: 0 }));
    const resultado = await applyPlan(pedido([arquivo(a, 'a.pdf')], plano));

    // Sem deduplicação isto passaria bem de duas vezes o original.
    expect(resultado.outputBytes).toBeLessThan(a.byteLength * 2);
  });
});

describe('folha em branco', () => {
  it('entra exatamente onde foi pedida', async () => {
    const a = await pdfDe(2, 200, 300);
    const resultado = await applyPlan(
      pedido(
        [arquivo(a, 'a.pdf')],
        [{ i: 0, r: 0 }, { branco: true, i: 0, r: 0 }, { i: 1, r: 0 }],
      ),
    );

    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(3);
  });

  it('nasce na medida da página vizinha, e não numa A4 fixa', async () => {
    // Uma A4 no meio de um documento ofício sairia com o tamanho trocado
    // bem no meio, e só se descobre no papel.
    const a = await pdfDe(2, 400, 500);
    const resultado = await applyPlan(
      pedido([arquivo(a, 'a.pdf')], [{ i: 0, r: 0 }, { branco: true, i: 0, r: 0 }]),
    );

    expect(await medidas(resultado.files[0].blob)).toEqual(['400x500', '400x500']);
  });

  it('abrindo o documento, copia a medida da página seguinte', async () => {
    // Sem vizinha antes, a de depois é a referência.
    const a = await pdfDe(1, 400, 500);
    const resultado = await applyPlan(
      pedido([arquivo(a, 'a.pdf')], [{ branco: true, i: 0, r: 0 }, { i: 0, r: 0 }]),
    );

    expect(await medidas(resultado.files[0].blob)).toEqual(['400x500', '400x500']);
  });

  it('cai em A4 quando não há nenhuma página de referência', async () => {
    const a = await pdfDe(1, 400, 500);
    const resultado = await applyPlan(pedido([arquivo(a, 'a.pdf')], [{ branco: true, i: 0, r: 0 }]));
    expect(await medidas(resultado.files[0].blob)).toEqual(['595x842']);
  });

  it('conta as folhas em branco na nota, e não como página removida', async () => {
    const a = await pdfDe(2, 200, 300);
    const resultado = await applyPlan(
      pedido([arquivo(a, 'a.pdf')], [{ i: 0, r: 0 }, { branco: true, i: 0, r: 0 }, { i: 1, r: 0 }]),
    );

    const notas = resultado.notes.join(' ');
    expect(notas).toMatch(/1 folha em branco inserida/);
    expect(notas).not.toMatch(/removida/);
  });

  it('só folha em branco não é documento vazio', async () => {
    const a = await pdfDe(2, 200, 300);
    const resultado = await applyPlan(pedido([arquivo(a, 'a.pdf')], [{ branco: true, i: 0, r: 0 }]));
    expect(resultado.files[0].pages).toBe(1);
  });
});

describe('o que continua sendo recusado', () => {
  it('plano vazio', async () => {
    const a = await pdfDe(2, 200, 300);
    await expect(applyPlan(pedido([arquivo(a, 'a.pdf')], []))).rejects.toThrow(/sem nenhuma página/);
  });

  it('remover sem marcar nada', async () => {
    const a = await pdfDe(2, 200, 300);
    await expect(
      applyPlan(pedido([arquivo(a, 'a.pdf')], [{ i: 0, r: 0 }, { i: 1, r: 0 }], 'remove')),
    ).rejects.toThrow(/devem sair/);
  });

  it('girar sem girar nada', async () => {
    const a = await pdfDe(2, 200, 300);
    await expect(
      applyPlan(pedido([arquivo(a, 'a.pdf')], [{ i: 0, r: 0 }, { i: 1, r: 0 }], 'rotate')),
    ).rejects.toThrow(/girá-la/);
  });

  it('plano que não é JSON', async () => {
    const a = await pdfDe(1, 200, 300);
    const ctx = pedido([arquivo(a, 'a.pdf')], []);
    ctx.options.plan = 'nao é json';
    await expect(applyPlan(ctx)).rejects.toThrow(/ler a seleção/);
  });
});
