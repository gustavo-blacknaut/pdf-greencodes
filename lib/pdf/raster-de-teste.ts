/**
 * Rasterizar um PDF dentro do teste, para conferir o que foi desenhado.
 *
 * Existe porque medida de página não prova desenho: uma página em branco tem
 * o tamanho certo, o número certo de páginas e passa em qualquer asserção de
 * geometria. Já custou caro neste projeto — uma rotação que devolvia páginas
 * do tamanho exato e completamente vazias passou por todos os testes.
 *
 * A rasterização usa o PyMuPDF do próprio motor, que já está no projeto.
 * Quem não tem `motor/runtime` no checkout — são 40 MB que o git ignora —
 * pula os testes que dependem disto, e `TEM_RASTERIZADOR` diz se dá.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PYTHON = path.join(process.cwd(), 'motor', 'runtime', 'python.exe');

export const TEM_RASTERIZADOR = existsSync(PYTHON);

export type Rasterizada = {
  largura: number;
  altura: number;
  /** `escuro[linha][coluna]`, com corte no meio da escala de cinza. */
  escuro: boolean[][];
};

/**
 * Desenha a página e devolve os pixels escuros.
 *
 * O corte padrão é no meio da escala, que serve para o que este projeto mais
 * desenha: retângulo chapado sobre branco.
 *
 * Para linha fina ele não serve, e isso já enganou um teste aqui. Uma linha
 * de 0,4 ponto a 200 pontos por polegada tem pouco mais de um pixel de
 * largura: quando ela cai bem em cima de um pixel, sai preta; quando cai
 * entre dois, o antisserrilhado divide a tinta e os dois saem em cinza-claro,
 * acima do corte. O teste então via uma marca de dobra onde havia duas — e o
 * defeito era da medição, não do desenho. Nesses casos passe um `limiar`
 * alto, perto do branco: aí qualquer tinta conta.
 */
export function rasterizar(pdf: Uint8Array, dpi: number, pagina = 0, limiar = 128): Rasterizada {
  const pasta = mkdtempSync(path.join(tmpdir(), 'raster-'));
  try {
    const entrada = path.join(pasta, 'entrada.pdf');
    const saida = path.join(pasta, 'saida.json');
    const script = path.join(pasta, 'ler.py');
    writeFileSync(entrada, pdf);
    writeFileSync(
      script,
      [
        'import json, sys, pymupdf',
        'doc = pymupdf.open(sys.argv[1])',
        'mapa = doc[int(sys.argv[4])].get_pixmap(dpi=int(sys.argv[3]), colorspace=pymupdf.csGRAY)',
        'linhas = []',
        'for y in range(mapa.height):',
        '    inicio = y * mapa.stride',
        '    linhas.append([1 if v < int(sys.argv[5]) else 0 for v in mapa.samples[inicio:inicio + mapa.width]])',
        'json.dump({"largura": mapa.width, "altura": mapa.height, "linhas": linhas}, open(sys.argv[2], "w"))',
      ].join('\n'),
      'utf8',
    );

    execFileSync(PYTHON, [script, entrada, saida, String(dpi), String(pagina), String(limiar)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lido = JSON.parse(readFileSync(saida, 'utf8')) as {
      largura: number;
      altura: number;
      linhas: number[][];
    };
    return {
      largura: lido.largura,
      altura: lido.altura,
      escuro: lido.linhas.map((linha) => linha.map((valor) => valor === 1)),
    };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** As faixas escuras de uma linha, em pixels. */
export function faixasDaLinha(linha: boolean[]): { inicio: number; largura: number }[] {
  const faixas: { inicio: number; largura: number }[] = [];
  let x = 0;
  while (x < linha.length) {
    if (!linha[x]) {
      x += 1;
      continue;
    }
    const inicio = x;
    while (x < linha.length && linha[x]) x += 1;
    faixas.push({ inicio, largura: x - inicio });
  }
  return faixas;
}

/** Quanto de um retângulo da imagem está escuro, de 0 a 1. */
export function tintaEm(
  imagem: Rasterizada,
  regiao: { x: number; y: number; largura: number; altura: number },
): number {
  let escuros = 0;
  let total = 0;
  const ateY = Math.min(imagem.altura, regiao.y + regiao.altura);
  const ateX = Math.min(imagem.largura, regiao.x + regiao.largura);

  for (let y = Math.max(0, regiao.y); y < ateY; y += 1) {
    for (let x = Math.max(0, regiao.x); x < ateX; x += 1) {
      if (imagem.escuro[y][x]) escuros += 1;
      total += 1;
    }
  }
  return total ? escuros / total : 0;
}
