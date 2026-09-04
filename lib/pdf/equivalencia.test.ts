/**
 * Os dois motores têm que entregar a mesma coisa.
 *
 * Ligar uma ferramenta no Python é trocar a implementação por baixo de quem
 * está usando. Isso só é honesto se a saída for a mesma — e "a mesma" não é
 * "não deu erro": é o mesmo número de arquivos, o mesmo número de páginas e a
 * mesma medida de página. Opção mal traduzida não quebra, entrega um
 * resultado diferente em silêncio, e é isso que este teste pega.
 *
 * O teste roda o motor Python de verdade, pelo mesmo `principal.py` que o
 * aplicativo roda, através da ponte de teste.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { runOperation, type LoadedFile, type OperationId, type RunContext } from './engine';
import { temMotorPython } from './motor-python';
import { PonteDeTeste } from './ponte-de-teste';

const RAIZ = process.cwd();

let ponte: PonteDeTeste;
let janelaAntes: unknown;

beforeAll(() => {
  ponte = new PonteDeTeste(RAIZ);
  janelaAntes = (globalThis as { window?: unknown }).window;
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = janelaAntes;
  ponte?.desligar();
});

/** Liga a ponte só durante a chamada, para o outro lado rodar em JavaScript. */
async function comPython<T>(trabalho: () => Promise<T>): Promise<T> {
  (globalThis as { window?: unknown }).window = { greenpdf: { ehAplicativo: true, motor: ponte.api } };
  try {
    return await trabalho();
  } finally {
    (globalThis as { window?: unknown }).window = undefined;
  }
}

async function pdfDe(paginas: number, largura = 595, altura = 842): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([largura, altura]).drawText(`P${i + 1}`, { x: 30, y: 30, size: 14 });
  return (await doc.save()).buffer as ArrayBuffer;
}

function ctx(bytes: ArrayBuffer[], options: Record<string, string | number | boolean>): RunContext {
  const files: LoadedFile[] = bytes.map((b, i) => ({
    id: `f${i}`,
    name: `doc${i}.pdf`,
    size: b.byteLength,
    type: 'application/pdf',
    bytes: b,
    pageCount: null,
    thumbnail: null,
  }));
  return { files, options, onProgress: () => {} };
}

/** O que precisa bater entre os dois motores. */
async function forma(blobs: { name: string; blob: Blob }[]) {
  const arquivos = [];
  for (const f of blobs) {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      arquivos.push({ paginas: null, medidas: null });
      continue;
    }
    const doc = await PDFDocument.load(await f.blob.arrayBuffer());
    arquivos.push({
      paginas: doc.getPageCount(),
      medidas: doc.getPages().map((p) => {
        const { width, height } = p.getSize();
        return `${Math.round(width)}x${Math.round(height)}`;
      }),
    });
  }
  return { quantos: blobs.length, arquivos };
}

type Caso = {
  op: OperationId;
  nome: string;
  opcoes: Record<string, string | number | boolean>;
  entradas?: number;
  paginas?: number;
};

const CASOS: Caso[] = [
  { op: 'n-up', nome: 'várias por folha', opcoes: { perSheet: 4 }, paginas: 12 },
  { op: 'reverse', nome: 'inverter páginas', opcoes: {}, paginas: 8 },
  { op: 'booklet', nome: 'livreto', opcoes: {}, paginas: 8 },
  { op: 'odd-even', nome: 'separar pares e ímpares', opcoes: {}, paginas: 9 },
  { op: 'crop', nome: 'cortar', opcoes: { top: 10, bottom: 10, left: 5, right: 5 }, paginas: 4 },
  { op: 'split-pages', nome: 'dividir páginas ao meio', opcoes: { mode: 'vertical' }, paginas: 4 },
  { op: 'interleave', nome: 'intercalar', opcoes: {}, entradas: 2, paginas: 4 },
  { op: 'repair', nome: 'reparar', opcoes: {}, paginas: 5 },
  { op: 'strip-metadata', nome: 'limpar metadados', opcoes: {}, paginas: 3 },
  { op: 'header-footer', nome: 'cabeçalho e rodapé', opcoes: { header: 'Topo', footer: 'Base', size: 10 }, paginas: 4 },
  { op: 'page-numbers', nome: 'numerar páginas', opcoes: { startAt: 1, size: 11 }, paginas: 6 },
  { op: 'watermark', nome: 'marca d’água', opcoes: { text: 'RASCUNHO', size: 40, opacity: 0.2 }, paginas: 4 },
  { op: 'resize', nome: 'redimensionar', opcoes: { target: 'a4' }, paginas: 4 },
  { op: 'split', nome: 'dividir', opcoes: { mode: 'every', every: 5 }, paginas: 12 },
];

describe('o Python entrega o mesmo que o JavaScript', () => {
  for (const caso of CASOS) {
    it(`${caso.nome}`, async () => {
      const entradas = await Promise.all(
        Array.from({ length: caso.entradas ?? 1 }, () => pdfDe(caso.paginas ?? 6)),
      );

      const emJs = await runOperation(caso.op, ctx(entradas.map((b) => b.slice(0)), caso.opcoes));

      const emPython = await comPython(async () => {
        const pedido = ctx(
          entradas.map((b) => b.slice(0)),
          caso.opcoes,
        );
        expect(temMotorPython(caso.op, pedido), `${caso.op} não está roteada para o Python`).toBe(true);
        return runOperation(caso.op, pedido);
      });

      expect(await forma(emPython.files)).toEqual(await forma(emJs.files));
    }, 120_000);
  }
});

/**
 * Juntar nao entra na comparacao acima: o caminho de JavaScript desenha as
 * imagens num canvas, e canvas nao existe em Node. Entao aqui a saida do
 * Python e conferida contra o que se sabe que ela tem que ser.
 */
describe('juntar, so no Python', () => {
  it('empilha as paginas dos tres arquivos, na ordem', async () => {
    const entradas = await Promise.all([pdfDe(2), pdfDe(3), pdfDe(4)]);

    const resultado = await comPython(async () => {
      const pedido = ctx(entradas, {});
      expect(temMotorPython('merge', pedido)).toBe(true);
      return runOperation('merge', pedido);
    });

    expect(resultado.files).toHaveLength(1);
    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(9);
  }, 120_000);

  it('fila com imagem no meio nao desce para o Python', async () => {
    const pedido = ctx([await pdfDe(2)], {});
    pedido.files.push({ ...pedido.files[0], id: 'img', name: 'foto.jpg', type: 'image/jpeg' });
    await comPython(async () => {
      expect(temMotorPython('merge', pedido), 'imagem tem que ficar no JavaScript').toBe(false);
    });
  });
});
