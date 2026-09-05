/**
 * Imagem sem rótulo do sistema.
 *
 * Um PNG escolhido pelo diálogo do Windows chega com `File.type` vazio. Três
 * pontos do programa decidiam "isto é imagem" olhando só esse rótulo, e o
 * resultado era um PNG recusado com "Formato não suportado" — no juntar, no
 * imprimir, e ao arrastar para qualquer ferramenta.
 *
 * O portão agora aceita pelo nome também, e a prova continua sendo o
 * conteúdo: nome mente, assinatura não.
 */
import { describe, expect, it } from 'vitest';
import { pareceMesmoImagem, pareceSerImagem } from './guards';

/** Os primeiros bytes de cada formato, que é o que a assinatura confere. */
const ASSINATURAS: Record<string, number[]> = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  bmp: [0x42, 0x4d, 0x00, 0x00],
};

function comBytes(cabecalho: number[]): ArrayBuffer {
  const bytes = new Uint8Array(32);
  bytes.set(cabecalho, 0);
  return bytes.buffer;
}

/** WEBP, AVIF e HEIC têm a marca deslocada, não no começo. */
function comMarca(posicao: number, marca: string, prefixo: number[] = []): ArrayBuffer {
  const bytes = new Uint8Array(32);
  bytes.set(prefixo, 0);
  for (let i = 0; i < marca.length; i += 1) bytes[posicao + i] = marca.charCodeAt(i);
  return bytes.buffer;
}

describe('o portão: pelo nome ou pelo rótulo', () => {
  it('aceita o PNG que chega sem rótulo nenhum', () => {
    // Exatamente o caso relatado: BACKDOOR.png recusado no juntar.
    expect(pareceSerImagem('BACKDOOR.png', '')).toBe(true);
    expect(pareceSerImagem('BACKDOOR.png')).toBe(true);
  });

  it('aceita pelo rótulo quando o nome não tem extensão', () => {
    expect(pareceSerImagem('foto sem extensao', 'image/png')).toBe(true);
  });

  it.each(['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.avif', 'a.gif', 'a.bmp', 'a.heic', 'a.heif'])(
    'reconhece %s pela extensão, em qualquer caixa',
    (nome) => {
      expect(pareceSerImagem(nome, '')).toBe(true);
    },
  );

  it('não confunde documento com imagem', () => {
    for (const nome of ['contrato.pdf', 'planilha.xlsx', 'nota.txt', 'programa.exe', 'sem-extensao']) {
      expect(pareceSerImagem(nome, ''), nome).toBe(false);
    }
  });

  it('".png" no meio do nome não vale: só a extensão conta', () => {
    expect(pareceSerImagem('foto.png.pdf', '')).toBe(false);
  });
});

describe('a prova: o conteúdo', () => {
  it.each(Object.keys(ASSINATURAS))('reconhece %s pela assinatura', (formato) => {
    expect(pareceMesmoImagem(comBytes(ASSINATURAS[formato]))).toBe(true);
  });

  it('reconhece WEBP, que tem a marca depois do tamanho', () => {
    expect(pareceMesmoImagem(comMarca(8, 'WEBP', [0x52, 0x49, 0x46, 0x46]))).toBe(true);
  });

  it.each([
    ['AVIF', 'avif'],
    ['HEIC', 'heic'],
    ['HEIF', 'mif1'],
  ])('reconhece %s, que compartilha o contêiner ISO-BMFF', (_nome, marca) => {
    // "ftyp" na posição 4, a variante logo depois.
    const bytes = new Uint8Array(comMarca(4, 'ftyp'));
    for (let i = 0; i < marca.length; i += 1) bytes[8 + i] = marca.charCodeAt(i);
    expect(pareceMesmoImagem(bytes.buffer)).toBe(true);
  });

  it('nome de imagem com conteúdo de outra coisa é recusado', () => {
    // É o motivo de a assinatura existir: o nome não prova nada.
    const executavel = comBytes([0x4d, 0x5a, 0x90, 0x00]);
    expect(pareceSerImagem('virus.png', '')).toBe(true);
    expect(pareceMesmoImagem(executavel)).toBe(false);
  });

  it('arquivo curto demais não estoura', () => {
    expect(pareceMesmoImagem(new Uint8Array(2).buffer)).toBe(false);
    expect(pareceMesmoImagem(new ArrayBuffer(0))).toBe(false);
  });
});
