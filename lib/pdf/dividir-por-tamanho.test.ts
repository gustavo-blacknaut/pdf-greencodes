/**
 * Dividir por tamanho tem que entregar partes que cabem no tamanho.
 *
 * O caso veio de uma tela: limite de 1 MB por parte, e entre as seis partes
 * uma de 3,9 MB e outra de 1,1 MB. A divisão não estava errada — uma página
 * sozinha não tem como ser dividida de novo. O que estava errado era o
 * programa escrever "1 MB" e entregar 3,9 sem dizer nada.
 *
 * Aqui o teste roda o caminho inteiro pelo motor de verdade, como o aplicativo
 * roda. Sem `motor/runtime` no checkout ele se pula sozinho.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { opcoesDoMotor, temMotorPython } from './motor-python';
import { PonteDeTeste } from './ponte-de-teste';
import { substituirMotorParaTeste, type MotorPython } from '../desktop';

const RAIZ = process.cwd();
const TEM_MOTOR = existsSync(path.join(RAIZ, 'motor', 'runtime', 'python.exe'));
const comMotor = TEM_MOTOR ? describe : describe.skip;

if (!TEM_MOTOR) {
  console.warn('[dividir-por-tamanho] motor/runtime nao esta neste checkout: pulado.');
}

const UM_MB = 1024 * 1024;

let ponte: PonteDeTeste;

beforeAll(() => {
  if (!TEM_MOTOR) return;
  ponte = new PonteDeTeste(RAIZ);
});

afterAll(() => {
  substituirMotorParaTeste(null);
  ponte?.desligar();
});

async function comPython<T>(trabalho: () => Promise<T>): Promise<T> {
  substituirMotorParaTeste(ponte.api as unknown as MotorPython);
  try {
    return await trabalho();
  } finally {
    substituirMotorParaTeste(null);
  }
}

/**
 * Um documento como o que chega no balcão: páginas leves de texto e uma
 * pesada de digitalização, que sozinha estoura qualquer limite razoável.
 *
 * O peso vem de ruído, e não de uma cor chapada: imagem lisa some no deflate
 * e caberia em qualquer limite antes de qualquer encolhimento — o teste
 * passaria sem testar nada.
 */
async function documentoMisto(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();

  for (let i = 0; i < 3; i += 1) {
    doc.addPage([595, 842]).drawText(`Pagina leve numero ${i + 1}`, { x: 60, y: 760, size: 14 });
  }

  // Um JPEG de ruído, montado à mão. 1400x1980 já pesa o suficiente para
  // passar de 1 MB depois de comprimido.
  const largura = 1400;
  const altura = 1980;
  const pixels = new Uint8Array(largura * altura * 3);

  /*
   * Ruído de verdade, em aritmética de 32 bits.
   *
   * A primeira versão usava a multiplicação comum do JavaScript e degenerou:
   * acima de 2^53 o número deixa de ser exato, a sequência vira quase
   * constante, e a imagem "de ruído" comprimia para 68 KB. O teste passava
   * sem testar nada — a página nunca chegava a estourar o limite.
   *
   * `Math.imul` faz a multiplicação truncada em 32 bits, que é o que um
   * gerador linear precisa.
   */
  let semente = 7;
  for (let i = 0; i < pixels.length; i += 1) {
    semente ^= semente << 13;
    semente ^= semente >>> 17;
    semente ^= semente << 5;
    semente = Math.imul(semente, 1) | 0;
    pixels[i] = 120 + (Math.abs(semente) % 136);
  }

  const pagina = doc.addPage([595, 842]);
  const png = await doc.embedPng(pngDe(pixels, largura, altura));
  pagina.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  pagina.drawText('TEXTO SOBRE A DIGITALIZACAO', { x: 60, y: 780, size: 16 });

  return (await doc.save()).buffer as ArrayBuffer;
}

/** Um PNG sem compressão, que é o formato mais simples de montar à mão. */
function pngDe(rgb: Uint8Array, largura: number, altura: number): Uint8Array {
  const crcTabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTabela[n] = c >>> 0;
  }
  const crc = (dados: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of dados) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const pedaco = (tipo: string, corpo: Uint8Array) => {
    const nome = new TextEncoder().encode(tipo);
    const inteiro = new Uint8Array(nome.length + corpo.length);
    inteiro.set(nome, 0);
    inteiro.set(corpo, nome.length);
    const saida = new Uint8Array(12 + corpo.length);
    const vista = new DataView(saida.buffer);
    vista.setUint32(0, corpo.length);
    saida.set(inteiro, 4);
    vista.setUint32(8 + corpo.length, crc(inteiro));
    return saida;
  };

  const ihdr = new Uint8Array(13);
  const cabecalho = new DataView(ihdr.buffer);
  cabecalho.setUint32(0, largura);
  cabecalho.setUint32(4, altura);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  const bruto = new Uint8Array(altura * (1 + largura * 3));
  for (let y = 0; y < altura; y += 1) {
    bruto[y * (1 + largura * 3)] = 0; // sem filtro
    bruto.set(rgb.subarray(y * largura * 3, (y + 1) * largura * 3), y * (1 + largura * 3) + 1);
  }

  // zlib "armazenado": nenhum ganho de tamanho, e é exatamente o que se quer
  // aqui — o peso do arquivo é o assunto do teste.
  const blocos: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const MAX = 65535;
  for (let inicio = 0; inicio < bruto.length; inicio += MAX) {
    const pedacoDados = bruto.subarray(inicio, Math.min(inicio + MAX, bruto.length));
    const ultimo = inicio + MAX >= bruto.length ? 1 : 0;
    const cabeca = new Uint8Array(5);
    cabeca[0] = ultimo;
    cabeca[1] = pedacoDados.length & 0xff;
    cabeca[2] = pedacoDados.length >>> 8;
    cabeca[3] = ~pedacoDados.length & 0xff;
    cabeca[4] = (~pedacoDados.length >>> 8) & 0xff;
    blocos.push(cabeca, pedacoDados);
  }
  let a = 1;
  let b = 0;
  for (const byte of bruto) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  blocos.push(adler);

  const idat = new Uint8Array(blocos.reduce((total, p) => total + p.length, 0));
  let onde = 0;
  for (const p of blocos) {
    idat.set(p, onde);
    onde += p.length;
  }

  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', idat),
    pedaco('IEND', new Uint8Array(0)),
  ];
  const arquivo = new Uint8Array(partes.reduce((total, p) => total + p.length, 0));
  let posicao = 0;
  for (const p of partes) {
    arquivo.set(p, posicao);
    posicao += p.length;
  }
  return arquivo;
}

function contexto(bytes: ArrayBuffer, options: Record<string, string | number | boolean>): RunContext {
  const files: LoadedFile[] = [
    {
      id: 'f0',
      name: 'documento.pdf',
      size: bytes.byteLength,
      type: 'application/pdf',
      bytes,
      pageCount: null,
      thumbnail: null,
    },
  ];
  return { files, options, onProgress: () => {} };
}

comMotor('dividir por tamanho, pelo motor', () => {
  it('o documento de teste é mesmo pesado o bastante', async () => {
    // Guarda contra o próprio teste: se a página "pesada" couber no limite,
    // todos os testes abaixo passam sem exercitar nada.
    const bytes = await documentoMisto();
    expect(bytes.byteLength, 'o documento tem que passar de 1 MB').toBeGreaterThan(UM_MB);
  }, 180_000);

  it('nenhuma parte passa do limite pedido', async () => {
    const bytes = await documentoMisto();

    const resultado = await comPython(async () => {
      const pedido = contexto(bytes.slice(0), { mode: 'size', maxSize: 1, reduzir: true });
      expect(temMotorPython('split', pedido), 'o modo por tamanho tem que descer para o motor').toBe(true);
      return runOperation('split', pedido);
    });

    expect(resultado.files.length).toBeGreaterThan(1);
    for (const arquivo of resultado.files) {
      expect(arquivo.blob.size, `${arquivo.name} passou do limite`).toBeLessThanOrEqual(UM_MB);
    }
  }, 180_000);

  it('o texto sobrevive na parte que foi encolhida', async () => {
    /*
     * É a diferença entre encolher e redesenhar a página como foto. O motor
     * reduz só as imagens embutidas; se um dia alguém trocar isso por
     * rasterizar a página, este teste é o que percebe.
     */
    const bytes = await documentoMisto();

    const resultado = await comPython(async () =>
      runOperation('split', contexto(bytes.slice(0), { mode: 'size', maxSize: 1, reduzir: true })),
    );

    let achouTexto = false;
    for (const arquivo of resultado.files) {
      const doc = await PDFDocument.load(await arquivo.blob.arrayBuffer());
      // O pdf-lib não lê texto, então a prova é indireta e honesta: a página
      // pesada continua tendo o tamanho de página original, e não virou uma
      // folha de imagem com medidas de pixel.
      for (const pagina of doc.getPages()) {
        const { width, height } = pagina.getSize();
        expect(Math.round(width)).toBe(595);
        expect(Math.round(height)).toBe(842);
      }
      if (doc.getPageCount() === 1) achouTexto = true;
    }
    expect(achouTexto, 'a página pesada tinha que sair sozinha numa parte').toBe(true);
  }, 180_000);

  it('desligando a redução, a parte grande volta a passar', async () => {
    // Prova que o encolhimento é o que resolve, e não outra coisa no caminho.
    const bytes = await documentoMisto();

    const resultado = await comPython(async () =>
      runOperation('split', contexto(bytes.slice(0), { mode: 'size', maxSize: 1, reduzir: false })),
    );

    const passou = resultado.files.some((arquivo) => arquivo.blob.size > UM_MB);
    expect(passou, 'sem reduzir, a página pesada tinha que estourar o limite').toBe(true);
    expect(resultado.notes.join(' ')).toMatch(/não couberam|nao couberam/);
  }, 180_000);

  it('conta o que encolheu, em vez de encolher calado', async () => {
    const bytes = await documentoMisto();
    const resultado = await comPython(async () =>
      runOperation('split', contexto(bytes.slice(0), { mode: 'size', maxSize: 1, reduzir: true })),
    );
    expect(resultado.notes.join(' ')).toMatch(/encolhida/);
  }, 180_000);

  it('a conversão de MB para bytes não erra por mil', () => {
    expect(opcoesDoMotor('split', { mode: 'size', maxSize: 2 }).limiteBytes).toBe(2 * 1024 * 1024);
  });
});

comMotor('repetir páginas, pelo motor', () => {
  it('a mesma foto repetida não entra no arquivo uma vez por cópia', async () => {
    // O pdf-lib copia a imagem de novo a cada cópia: quatro repetições do
    // documento saíam com quatro digitalizações de 1 MB dentro. Compactado,
    // fica uma só, e as outras páginas apontam para ela.
    const bytes = await documentoMisto();
    const resultado = await comPython(async () =>
      runOperation('repeat-pages', contexto(bytes.slice(0), { vezes: 4, modo: 'documento-inteiro' })),
    );
    expect(resultado.files[0].pages).toBe(16);
    expect(resultado.outputBytes, 'quatro cópias da mesma digitalização ficaram no arquivo').toBeLessThan(
      bytes.byteLength * 1.5,
    );
  }, 180_000);
});
