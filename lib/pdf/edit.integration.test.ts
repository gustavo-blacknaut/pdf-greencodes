/**
 * Fecha o contrato de coordenadas do editor de ponta a ponta.
 *
 * Os testes de `layout.test.ts` provam a fórmula isoladamente. Aqui a conta
 * atravessa o pdf-lib de verdade, gera um PDF e é lida de volta pelo pdf.js:
 * se algum dia alguém "consertar" a inversão do eixo vertical, ou trocar a
 * âncora do texto, este teste cai. É a diferença entre a matemática estar certa
 * e a assinatura cair no lugar certo.
 */
import { describe, expect, it } from 'vitest';
import { paraCoordenadasPdf, type Retangulo } from './layout';

const A4 = { largura: 595.28, altura: 841.89 };
const TEXTO = 'MARCADOR';
const TAMANHO = 14;

async function gerarPdfCom(retangulo: Retangulo): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([A4.largura, A4.altura]);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);

  const caixa = paraCoordenadasPdf(retangulo, A4.largura, A4.altura);
  // Mesma âncora usada pela operação `edit`: a linha de base fica no topo da
  // caixa, descontando o tamanho da fonte.
  pagina.drawText(TEXTO, {
    x: caixa.x,
    y: caixa.y + caixa.altura - TAMANHO,
    size: TAMANHO,
    font: fonte,
    color: rgb(0, 0, 0),
  });

  return doc.save();
}

async function lerPosicaoDoTexto(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    // Fora do navegador o pdf.js não acha as fontes padrão sozinho e enche a
    // saída do teste de avisos.
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;
  const pagina = await doc.getPage(1);
  const conteudo = await pagina.getTextContent();

  const item = conteudo.items.find(
    (i): i is typeof i & { str: string; transform: number[] } => 'str' in i && i.str.includes(TEXTO),
  );
  await doc.destroy();
  if (!item) throw new Error('O texto não foi encontrado no PDF gerado.');

  // Na matriz de texto do PDF, os dois últimos números são x e y da linha de base.
  return { x: item.transform[4], y: item.transform[5] };
}

describe('posicionamento do editor dentro do PDF', () => {
  it('coloca no alto da página o que foi posicionado no alto da tela', async () => {
    const noTopo = { x: 0.1, y: 0.05, largura: 0.5, altura: 0.05 };
    const posicao = await lerPosicaoDoTexto(await gerarPdfCom(noTopo));

    expect(posicao.x).toBeCloseTo(A4.largura * 0.1, 1);
    // Perto do topo, e não perto da base: é aqui que a inversão do eixo aparece.
    expect(posicao.y).toBeGreaterThan(A4.altura * 0.85);
  });

  it('coloca embaixo o que foi posicionado embaixo', async () => {
    const embaixo = { x: 0.1, y: 0.9, largura: 0.5, altura: 0.05 };
    const posicao = await lerPosicaoDoTexto(await gerarPdfCom(embaixo));

    expect(posicao.y).toBeLessThan(A4.altura * 0.12);
    expect(posicao.y).toBeGreaterThanOrEqual(0);
  });

  it('descer na tela é descer no papel, não o contrário', async () => {
    const alto = await lerPosicaoDoTexto(await gerarPdfCom({ x: 0.1, y: 0.2, largura: 0.4, altura: 0.05 }));
    const baixo = await lerPosicaoDoTexto(await gerarPdfCom({ x: 0.1, y: 0.7, largura: 0.4, altura: 0.05 }));

    expect(alto.y).toBeGreaterThan(baixo.y);
  });

  it('mover para a direita na tela move para a direita no papel', async () => {
    const esquerda = await lerPosicaoDoTexto(await gerarPdfCom({ x: 0.05, y: 0.3, largura: 0.3, altura: 0.05 }));
    const direita = await lerPosicaoDoTexto(await gerarPdfCom({ x: 0.55, y: 0.3, largura: 0.3, altura: 0.05 }));

    expect(direita.x).toBeGreaterThan(esquerda.x);
    expect(direita.x).toBeCloseTo(A4.largura * 0.55, 1);
  });
});
