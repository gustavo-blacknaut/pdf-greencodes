/**
 * O desenho dos códigos, conferido rasterizando o PDF de volta.
 *
 * Testar que "o PDF tem uma página de 30 por 30 milímetros" não prova nada:
 * uma página em branco passa nesse teste. O que decide se o leitor bipa é
 * onde as barras caem e quanto cada uma mede — e isso só o desenho pronto
 * responde.
 *
 * Então aqui o PDF gerado é rasterizado com o PyMuPDF do motor e lido de
 * volta: a matriz do QR sai da imagem e é comparada com a matriz que a gerou;
 * as barras do código viram larguras medidas em pixel e são comparadas com os
 * módulos calculados. É o caminho inteiro, do texto até a tinta.
 *
 * Sem `motor/runtime` no checkout — são 40 MB que o git ignora — o arquivo se
 * pula sozinho.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gerarCodigoBarras, gerarQrCode } from './operacoes/codigos';
import { faixasEscuras, gerarCodigo } from '../codigos/barras';
import { BORDA_EM_MODULOS, matrizQr } from '../codigos/qr';
import type { RunContext } from './tipos';

const RAIZ = process.cwd();
const PYTHON = path.join(RAIZ, 'motor', 'runtime', 'python.exe');
const comMotor = existsSync(PYTHON) ? describe : describe.skip;

if (!existsSync(PYTHON)) {
  console.warn('[codigos-desenho] motor/runtime nao esta neste checkout: a conferencia do desenho foi pulada.');
}

function pedido(opcoes: Record<string, string | number | boolean>): RunContext {
  return { files: [], options: opcoes, onProgress: () => {} };
}

/**
 * Rasteriza a página e devolve, para cada linha, os pixels escuros.
 *
 * A leitura é feita em preto e branco com corte no meio da escala: o desenho
 * é retângulo preto chapado sobre branco, então não há meio-tom a interpretar
 * fora do serrilhado da borda.
 */
function rasterizar(pdf: Uint8Array, dpi: number): { largura: number; altura: number; escuro: boolean[][] } {
  const pasta = mkdtempSync(path.join(tmpdir(), 'codigos-'));
  try {
    const entrada = path.join(pasta, 'entrada.pdf');
    const saida = path.join(pasta, 'saida.json');
    writeFileSync(entrada, pdf);

    const script = [
      'import json, sys, pymupdf',
      'doc = pymupdf.open(sys.argv[1])',
      'pagina = doc[0]',
      'mapa = pagina.get_pixmap(dpi=int(sys.argv[3]), colorspace=pymupdf.csGRAY)',
      'linhas = []',
      'for y in range(mapa.height):',
      '    inicio = y * mapa.stride',
      '    faixa = mapa.samples[inicio:inicio + mapa.width]',
      '    linhas.append([1 if v < 128 else 0 for v in faixa])',
      'json.dump({"largura": mapa.width, "altura": mapa.height, "linhas": linhas}, open(sys.argv[2], "w"))',
    ].join('\n');

    const arquivoDoScript = path.join(pasta, 'ler.py');
    writeFileSync(arquivoDoScript, script, 'utf8');
    execFileSync(PYTHON, [arquivoDoScript, entrada, saida, String(dpi)], { stdio: ['ignore', 'pipe', 'pipe'] });

    const lido = JSON.parse(readFileSync(saida, 'utf8')) as {
      largura: number;
      altura: number;
      linhas: number[][];
    };
    return {
      largura: lido.largura,
      altura: lido.altura,
      escuro: lido.linhas.map((linha) => linha.map((v) => v === 1)),
    };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** As faixas escuras de uma linha da imagem, em pixels. */
function faixasDaLinha(linha: boolean[]): { inicio: number; largura: number }[] {
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

comMotor('o QR desenhado no PDF é o mesmo que a matriz diz', () => {
  it('cada módulo da imagem bate com a matriz, e a borda branca está lá', async () => {
    const conteudo = 'https://pdf.greencodes.com.br/gerar-qrcode';
    const resultado = await gerarQrCode(pedido({ conteudo, saida: 'pdf', correcao: 'M', ladoMm: 30 }));

    const bytes = new Uint8Array(await resultado.files[0].blob.arrayBuffer());
    // Resolução alta de propósito: com módulo de poucos pixels, a escadinha
    // da borda atrapalharia a leitura de volta.
    const imagem = rasterizar(bytes, 600);

    const matriz = matrizQr(conteudo, 'M');
    const comBorda = matriz.tamanho + BORDA_EM_MODULOS * 2;
    const modulo = imagem.largura / comBorda;

    expect(imagem.largura, 'a página tem que sair quadrada').toBe(imagem.altura);

    // A borda de quatro módulos é obrigatória, e é a que mais some na prática.
    const bordaEmPixels = Math.floor(BORDA_EM_MODULOS * modulo) - 1;
    for (let y = 0; y < bordaEmPixels; y += 1) {
      expect(imagem.escuro[y].some(Boolean), `linha ${y} da borda de cima devia estar em branco`).toBe(false);
    }

    // O centro de cada módulo, comparado com a matriz. Ler pelo centro evita
    // discutir o pixel exato onde um retângulo começa.
    let conferidos = 0;
    for (let linha = 0; linha < matriz.tamanho; linha += 1) {
      for (let coluna = 0; coluna < matriz.tamanho; coluna += 1) {
        const y = Math.round((BORDA_EM_MODULOS + linha + 0.5) * modulo);
        const x = Math.round((BORDA_EM_MODULOS + coluna + 0.5) * modulo);
        expect(imagem.escuro[y][x], `módulo ${linha},${coluna}`).toBe(matriz.escuro[linha][coluna]);
        conferidos += 1;
      }
    }
    expect(conferidos).toBe(matriz.tamanho * matriz.tamanho);
  }, 120_000);
});

comMotor('as barras desenhadas medem o que a norma manda', () => {
  it('as larguras na folha batem com os módulos calculados', async () => {
    const conteudo = '789100031595';
    const resultado = await gerarCodigoBarras(
      pedido({ conteudo, simbologia: 'ean13', saida: 'pdf', larguraMm: 50, alturaMm: 25, legenda: false }),
    );

    const bytes = new Uint8Array(await resultado.files[0].blob.arrayBuffer());
    const imagem = rasterizar(bytes, 600);

    const codigo = gerarCodigo('ean13', conteudo);
    const esperadas = faixasEscuras(codigo.modulos);

    // Uma linha no meio da altura, onde só há barra e nenhum texto.
    const medidas = faixasDaLinha(imagem.escuro[Math.floor(imagem.altura / 2)]);
    expect(medidas, 'quantidade de barras').toHaveLength(esperadas.length);

    const totalDeModulos = codigo.modulos.length + codigo.silencio * 2;
    const pixelsPorModulo = imagem.largura / totalDeModulos;

    for (let i = 0; i < esperadas.length; i += 1) {
      const emPixels = esperadas[i].largura * pixelsPorModulo;
      // Um pixel de folga: a borda do retângulo cai no meio de um pixel e o
      // rasterizador arredonda para um lado ou para o outro.
      expect(medidas[i].largura, `barra ${i}`).toBeGreaterThanOrEqual(Math.floor(emPixels) - 1);
      expect(medidas[i].largura, `barra ${i}`).toBeLessThanOrEqual(Math.ceil(emPixels) + 1);
    }
  }, 120_000);

  it('a zona de silêncio fica branca dos dois lados', async () => {
    // É a parte que some quando alguém "aproveita o espaço" da etiqueta, e a
    // que faz o código parar de ler encostado em outro elemento.
    const resultado = await gerarCodigoBarras(
      pedido({ conteudo: '789100031595', simbologia: 'ean13', saida: 'pdf', larguraMm: 50, alturaMm: 25, legenda: false }),
    );
    const imagem = rasterizar(new Uint8Array(await resultado.files[0].blob.arrayBuffer()), 300);

    const codigo = gerarCodigo('ean13', '789100031595');
    const pixelsPorModulo = imagem.largura / (codigo.modulos.length + codigo.silencio * 2);
    const silencio = Math.floor(codigo.silencio * pixelsPorModulo) - 1;

    const meio = imagem.escuro[Math.floor(imagem.altura / 2)];
    expect(meio.slice(0, silencio).some(Boolean), 'silêncio da esquerda').toBe(false);
    expect(meio.slice(imagem.largura - silencio).some(Boolean), 'silêncio da direita').toBe(false);
  }, 120_000);

  it('as guardas do EAN descem abaixo das outras barras', async () => {
    // Com a legenda ligada, as três guardas passam por baixo dela. É a
    // referência visual que separa os grupos de dígitos.
    const resultado = await gerarCodigoBarras(
      pedido({ conteudo: '789100031595', simbologia: 'ean13', saida: 'pdf', larguraMm: 50, alturaMm: 25, legenda: true }),
    );
    const imagem = rasterizar(new Uint8Array(await resultado.files[0].blob.arrayBuffer()), 300);

    const noMeio = faixasDaLinha(imagem.escuro[Math.floor(imagem.altura * 0.4)]).length;
    // Bem embaixo, na faixa da legenda, sobram só as guardas — seis barras —
    // mais o que a legenda escreve.
    const embaixo = faixasDaLinha(imagem.escuro[Math.floor(imagem.altura * 0.93)]).length;

    expect(noMeio).toBeGreaterThan(20);
    expect(embaixo).toBeLessThan(noMeio);
    expect(embaixo).toBeGreaterThan(0);
  }, 120_000);
});

comMotor('a folha de etiquetas', () => {
  it('repete o código na grade, e cabe o que promete', async () => {
    const resultado = await gerarQrCode(
      pedido({
        conteudo: 'A\nB\nC',
        saida: 'folha',
        ladoMm: 30,
        papel: 'a4',
        margemMm: 8,
        espacoMm: 3,
        repetir: 4,
      }),
    );

    expect(resultado.files[0].name).toBe('etiquetas-qrcode.pdf');
    const imagem = rasterizar(new Uint8Array(await resultado.files[0].blob.arrayBuffer()), 100);

    // Doze etiquetas (três códigos, quatro de cada) numa A4 de 30 mm cabem
    // numa folha só; a nota diz quantas por folha.
    expect(resultado.notes[0]).toMatch(/códigos por folha/);
    expect(imagem.escuro.some((linha) => linha.some(Boolean)), 'a folha não pode sair em branco').toBe(true);
  }, 120_000);
});
