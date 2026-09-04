'use client';

/**
 * Converter, redimensionar e comprimir imagem.
 *
 * Tudo aqui roda no navegador, e é de propósito: o motor Python grava só
 * `png, pnm, pgm, ppm, pbm, pam, psd, ps, jpg, jpeg` — **não grava webp**. O
 * Chromium grava, decodifica webp e avif, e não custa um byte de instalador.
 * É o inverso da história do PDF, onde o Python ganha de longe.
 *
 * Todas aceitam vários arquivos: no balcão nunca é uma foto só. Saindo mais
 * de uma, o resultado vem em .zip.
 */

import {
  FORMATOS_DE_SAIDA,
  encaixar,
  formatoValido,
  nomeNoFormato,
  pixelsParaImprimir,
  proximaQualidade,
  semAumentar,
  bytesDoAlvo,
  type FormatoDeSaida,
  type Medida,
} from '../../imagem/medidas';
import { canvasToBlob, zipFiles } from '../nucleo';
import type { OutputFile, RunContext, RunResult } from '../tipos';
import { replaceExtension, yieldToBrowser } from '../../utils';

/** Uma imagem decodificada, pronta para desenhar. */
type Decodificada = { bitmap: ImageBitmap; largura: number; altura: number };

const HEIC = /\.(heic|heif)$/i;

/**
 * Decodifica o arquivo, seja lá o que ele for.
 *
 * HEIC é o formato que o iPhone grava desde 2017, e nem o navegador nem o
 * MuPDF abrem: precisa do libheif, que são quase 3 MB. Por isso ele só é
 * baixado quando alguém realmente manda um HEIC — quem converte um JPG não
 * paga nada por essa possibilidade.
 */
async function decodificar(arquivo: { name: string; bytes: ArrayBuffer; type: string }): Promise<Decodificada> {
  let dados: Blob = new Blob([arquivo.bytes], { type: arquivo.type || 'application/octet-stream' });

  if (HEIC.test(arquivo.name) || arquivo.type === 'image/heic' || arquivo.type === 'image/heif') {
    const { heicTo } = await import('heic-to');
    dados = await heicTo({ blob: dados, type: 'image/png' });
  }

  try {
    const bitmap = await createImageBitmap(dados);
    return { bitmap, largura: bitmap.width, altura: bitmap.height };
  } catch {
    throw new Error(
      `Não consegui ler "${arquivo.name}". O navegador abre JPG, PNG, WEBP, GIF, BMP e AVIF; ` +
        'formato fora dessa lista precisa ser salvo como JPG antes.',
    );
  }
}

/** Desenha na medida pedida e grava no formato pedido. */
async function gravar(
  imagem: Decodificada,
  medida: Medida,
  formato: FormatoDeSaida,
  qualidade: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, medida.largura);
  canvas.height = Math.max(1, medida.altura);
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');

  // JPEG não tem transparência: sem o fundo branco, o que era transparente
  // sai preto, e uma logo em PNG vira um borrão escuro.
  if (!FORMATOS_DE_SAIDA[formato].temTransparencia) {
    pincel.fillStyle = '#ffffff';
    pincel.fillRect(0, 0, canvas.width, canvas.height);
  }

  pincel.imageSmoothingQuality = 'high';
  pincel.drawImage(imagem.bitmap, 0, 0, canvas.width, canvas.height);

  const alvo = FORMATOS_DE_SAIDA[formato];
  return canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined);
}

/** Um arquivo por entrada, ou um .zip quando sai mais de um. */
async function entregar(
  ctx: RunContext,
  saidas: OutputFile[],
  sufixoDoZip: string,
  notas: string[],
): Promise<RunResult> {
  const inputBytes = ctx.files.reduce((total, a) => total + a.size, 0);
  const outputBytes = saidas.reduce((total, a) => total + a.blob.size, 0);

  if (saidas.length === 1) {
    ctx.onProgress(1);
    return { files: saidas, inputBytes, outputBytes, notes: notas, highlightSavings: true };
  }

  ctx.onProgress(0.95, 'Compactando em .zip');
  const zip = await zipFiles(saidas.map((a) => ({ name: a.name, blob: a.blob })));
  ctx.onProgress(1);
  return {
    files: [{ name: replaceExtension(`${sufixoDoZip}.zip`, 'zip'), blob: zip, pages: saidas.length }],
    inputBytes,
    outputBytes: zip.size,
    notes: [`${saidas.length} imagens, entregues num .zip.`, ...notas],
    highlightSavings: true,
  };
}

/** Percorre a fila decodificando, desenhando e liberando cada imagem. */
async function porArquivo(
  ctx: RunContext,
  trabalho: (imagem: Decodificada, arquivo: RunContext['files'][number]) => Promise<OutputFile | null>,
): Promise<OutputFile[]> {
  const saidas: OutputFile[] = [];

  for (let i = 0; i < ctx.files.length; i += 1) {
    const arquivo = ctx.files[i];
    ctx.onProgress(i / ctx.files.length, `${arquivo.name} (${i + 1}/${ctx.files.length})`);

    const imagem = await decodificar(arquivo);
    try {
      const saida = await trabalho(imagem, arquivo);
      if (saida) saidas.push(saida);
    } finally {
      // Sem isto, uma fila de trinta fotos de celular segura trinta bitmaps
      // na memória ao mesmo tempo, e a máquina fraca da loja trava.
      imagem.bitmap.close();
    }
    await yieldToBrowser();
  }

  return saidas;
}

// ------------------------------------------------------------- converter ---

export async function convertImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato);
  const qualidade = Math.min(1, Math.max(0.3, Number(ctx.options.qualidade ?? 90) / 100));

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => ({
    name: nomeNoFormato(arquivo.name, formato),
    blob: await gravar(imagem, { largura: imagem.largura, altura: imagem.altura }, formato, qualidade),
  }));

  const notas = [`Convertidas para ${FORMATOS_DE_SAIDA[formato].extensao.toUpperCase()}.`];
  if (formato === 'jpeg') {
    notas.push('O JPG não guarda transparência: o que era transparente saiu branco.');
  }
  notas.push(
    'A conversão passa pelo navegador, que descarta o perfil de cor e os dados de câmera. ' +
      'Para fechar arquivo de impressão, converta a partir do original.',
  );

  return entregar(ctx, saidas, 'imagens-convertidas', notas);
}

// -------------------------------------------------------- redimensionar ---

export async function resizeImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato ?? 'jpeg');
  const qualidade = Math.min(1, Math.max(0.3, Number(ctx.options.qualidade ?? 90) / 100));
  const modo = String(ctx.options.modo ?? 'maior-lado');
  const aumentar = ctx.options.aumentar === true || ctx.options.aumentar === 'true';
  const ajuste = String(ctx.options.ajuste ?? 'cabe') as 'cabe' | 'preenche' | 'esticar';

  const dpi = Math.min(1200, Math.max(36, Number(ctx.options.dpi ?? 300)));
  const larguraMm = Math.max(1, Number(ctx.options.larguraMm ?? 100));
  const alturaMm = Math.max(1, Number(ctx.options.alturaMm ?? 150));
  const pixels = Math.max(16, Number(ctx.options.pixels ?? 1600));
  const porcento = Math.min(400, Math.max(1, Number(ctx.options.porcento ?? 50)));

  let aviso = '';

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const original = { largura: imagem.largura, altura: imagem.altura };

    let desejada: Medida;
    if (modo === 'impressao') {
      desejada = encaixar(
        original,
        { largura: pixelsParaImprimir(larguraMm, dpi), altura: pixelsParaImprimir(alturaMm, dpi) },
        ajuste,
      );
    } else if (modo === 'porcento') {
      desejada = {
        largura: Math.max(1, Math.round((original.largura * porcento) / 100)),
        altura: Math.max(1, Math.round((original.altura * porcento) / 100)),
      };
    } else {
      const deitada = original.largura >= original.altura;
      desejada = encaixar(original, deitada ? { largura: pixels } : { altura: pixels });
    }

    const final = aumentar ? desejada : semAumentar(original, desejada);
    if (!aumentar && final === original && desejada.largura > original.largura) {
      aviso =
        `Alguma imagem já era menor que a medida pedida e foi deixada como estava. ` +
        'Esticar não cria detalhe: entrega o mesmo borrão num arquivo maior. Marque "aumentar" se quiser mesmo assim.';
    }

    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await gravar(imagem, final, formato, qualidade),
      pages: undefined,
    };
  });

  const notas: string[] = [];
  if (modo === 'impressao') {
    notas.push(
      `Dimensionadas para ${larguraMm}x${alturaMm} mm a ${dpi} DPI ` +
        `(${pixelsParaImprimir(larguraMm, dpi)}x${pixelsParaImprimir(alturaMm, dpi)} px).`,
    );
  } else if (modo === 'porcento') {
    notas.push(`Redimensionadas para ${porcento}% do tamanho original.`);
  } else {
    notas.push(`O maior lado ficou com ${pixels} px, e o outro acompanhou a proporção.`);
  }
  if (aviso) notas.push(aviso);

  return entregar(ctx, saidas, 'imagens-redimensionadas', notas);
}

// ------------------------------------------------------------- comprimir ---

/** Quantas tentativas a busca binária faz antes de aceitar o que tem. */
const TENTATIVAS = 7;

export async function compressImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato ?? 'jpeg');
  const alvo = bytesDoAlvo(ctx.options.alvo);
  if (!alvo) {
    throw new Error('Diga o peso que você quer, como "500 KB" ou "1,5 MB".');
  }
  if (!FORMATOS_DE_SAIDA[formato].temQualidade) {
    throw new Error('O PNG não tem controle de qualidade. Escolha JPG ou WEBP para mirar um peso.');
  }

  let algumaFicouGrande = false;

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const medida = { largura: imagem.largura, altura: imagem.altura };

    // Começa no meio: a busca binária não precisa de chute bom, precisa de
    // intervalo. Cada passo corta o que sobrou pela metade.
    let faixa = { minima: 0.05, maxima: 0.97 };
    let qualidade = 0.7;
    let melhor: Blob | null = null;

    for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
      const saiu = await gravar(imagem, medida, formato, qualidade);
      // Guarda o maior arquivo que ainda cabe: é o de melhor qualidade
      // dentro do limite.
      if (saiu.size <= alvo && (!melhor || saiu.size > melhor.size)) melhor = saiu;

      const passo = proximaQualidade(faixa, qualidade, saiu.size, alvo);
      qualidade = passo.qualidade;
      faixa = passo.faixa;
      await yieldToBrowser();
    }

    if (!melhor) {
      // Nem na qualidade mínima coube. Entregar o menor possível é mais útil
      // que recusar, mas a nota tem que dizer o que aconteceu.
      melhor = await gravar(imagem, medida, formato, 0.05);
      algumaFicouGrande = true;
    }

    return { name: nomeNoFormato(arquivo.name, formato), blob: melhor };
  });

  const emKb = Math.round(alvo / 1024);
  const notas = [`Mirando ${emKb} KB por imagem, na melhor qualidade que coube.`];
  if (algumaFicouGrande) {
    notas.push(
      'Alguma não coube nem na qualidade mínima. Reduza a medida antes de comprimir: ' +
        'imagem grande demais não emagrece só apertando a qualidade.',
    );
  }

  return entregar(ctx, saidas, 'imagens-comprimidas', notas);
}

// ------------------------------------------------------------------ heic ---

export async function heicToImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato ?? 'jpeg');
  const qualidade = Math.min(1, Math.max(0.3, Number(ctx.options.qualidade ?? 92) / 100));

  const nenhumHeic = ctx.files.every((a) => !HEIC.test(a.name) && a.type !== 'image/heic' && a.type !== 'image/heif');
  if (nenhumHeic) {
    throw new Error(
      'Nenhum arquivo HEIC na fila. Esta ferramenta é para a foto que sai do iPhone; ' +
        'para os outros formatos, use "Converter imagem".',
    );
  }

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => ({
    name: nomeNoFormato(arquivo.name, formato),
    blob: await gravar(imagem, { largura: imagem.largura, altura: imagem.altura }, formato, qualidade),
  }));

  return entregar(ctx, saidas, 'fotos-convertidas', [
    `HEIC convertido para ${FORMATOS_DE_SAIDA[formato].extensao.toUpperCase()}, no tamanho original.`,
    'O HEIC é o formato que o iPhone grava desde 2017. Nem o navegador nem a maioria dos programas abrem — por isso a conversão.',
  ]);
}
