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
import { decodificarImagem, type Decodificada } from '../../imagem/decodificar';
import { realcar, recortar, redimensionar, type Bitmap } from '../../imagem/lanczos';
import { canvasToBlob, zipFiles } from '../nucleo';
import type { OutputFile, RunContext, RunResult } from '../tipos';
import { replaceExtension, yieldToBrowser } from '../../utils';

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

    const imagem = await decodificarImagem(arquivo);
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

  const ehHeic = (nome: string, tipo: string) =>
    /\.(heic|heif)$/i.test(nome) || tipo === 'image/heic' || tipo === 'image/heif';
  const nenhumHeic = ctx.files.every((a) => !ehHeic(a.name, a.type));
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

// ------------------------------------------------- ampliar e recortar ---

/**
 * Teto de pixels na saída.
 *
 * Uma foto de 4000x3000 ampliada quatro vezes vira 192 milhões de pixels, e
 * cada um ocupa quatro bytes: 768 MB só do resultado, sem contar a passagem
 * intermediária. Nas máquinas da loja isso não é lentidão, é a aba morrendo.
 */
const MAX_PIXELS = 40_000_000;

/** Do bitmap do navegador para os pixels crus, e de volta. */
async function pixelsDe(imagem: Decodificada): Promise<Bitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = imagem.largura;
  canvas.height = imagem.altura;
  const pincel = canvas.getContext('2d', { willReadFrequently: true });
  if (!pincel) throw new Error('O navegador não deixou ler os pixels da imagem.');
  pincel.drawImage(imagem.bitmap, 0, 0);
  const dados = pincel.getImageData(0, 0, imagem.largura, imagem.altura);
  return { dados: dados.data, largura: imagem.largura, altura: imagem.altura };
}

async function gravarPixels(mapa: Bitmap, formato: FormatoDeSaida, qualidade: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = mapa.largura;
  canvas.height = mapa.altura;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');

  // Monta o ImageData pelo contexto, e não pelo construtor: assim o array
  // de pixels entra sem depender de qual versão do lib do TypeScript está
  // tipando o construtor.
  const quadro = pincel.createImageData(mapa.largura, mapa.altura);
  quadro.data.set(mapa.dados);

  if (FORMATOS_DE_SAIDA[formato].temTransparencia) {
    pincel.putImageData(quadro, 0, 0);
    const alvoTransparente = FORMATOS_DE_SAIDA[formato];
    return canvasToBlob(canvas, alvoTransparente.mime, alvoTransparente.temQualidade ? qualidade : undefined);
  }

  // Sem transparência: o branco vai por baixo, senão o que era transparente
  // sai preto. putImageData ignora o que já está desenhado, então os pixels
  // passam por um canvas intermediário e voltam com drawImage.
  const porBaixo = document.createElement('canvas');
  porBaixo.width = mapa.largura;
  porBaixo.height = mapa.altura;
  porBaixo.getContext('2d')!.putImageData(quadro, 0, 0);

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, canvas.width, canvas.height);
  pincel.drawImage(porBaixo, 0, 0);

  const alvo = FORMATOS_DE_SAIDA[formato];
  return canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined);
}

/**
 * Amplia com Lanczos e realça a borda.
 *
 * O `drawImage` do canvas interpola em bilinear, que é rápida e mole. O
 * Lanczos pesa uma janela maior com lóbulos negativos, e é isso que devolve
 * borda definida em vez de borrão.
 *
 * O que ele **não** faz é inventar detalhe: o detalhe não está no arquivo.
 * Quem promete "melhorar" uma foto de 300 px para um banner está falando de
 * um modelo de IA, que é outra conversa e outros oitenta megabytes.
 */
export async function enhanceImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato ?? 'png');
  const qualidade = Math.min(1, Math.max(0.3, Number(ctx.options.qualidade ?? 95) / 100));
  const escala = Math.min(8, Math.max(1, Number(ctx.options.escala ?? 2)));
  const nitidez = Math.min(2, Math.max(0, Number(ctx.options.nitidez ?? 0.6)));

  let reduziu = false;

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    let alvoL = Math.round(imagem.largura * escala);
    let alvoA = Math.round(imagem.altura * escala);

    if (alvoL * alvoA > MAX_PIXELS) {
      const fator = Math.sqrt(MAX_PIXELS / (alvoL * alvoA));
      alvoL = Math.round(alvoL * fator);
      alvoA = Math.round(alvoA * fator);
      reduziu = true;
    }

    const origem = await pixelsDe(imagem);
    const ampliada = redimensionar(origem, alvoL, alvoA);
    const pronta = realcar(ampliada, nitidez);

    return { name: nomeNoFormato(arquivo.name, formato), blob: await gravarPixels(pronta, formato, qualidade) };
  });

  const notas = [
    `Ampliadas ${escala}x com Lanczos, e realçadas em ${Math.round(nitidez * 100)}%.`,
    'Ampliar não cria detalhe que não está no arquivo: o Lanczos entrega a borda mais definida que ' +
      'a matemática permite, e o realce aumenta o contraste dela. Uma foto de 300 px não vira um banner.',
  ];
  if (reduziu) {
    notas.push(
      'Alguma ampliação passaria de 40 milhões de pixels e foi limitada — acima disso a memória do navegador não aguenta.',
    );
  }
  if (formato === 'jpeg') {
    notas.push('Salvar em PNG evita perder no JPG justamente o que a ampliação acabou de ganhar.');
  }

  return entregar(ctx, saidas, 'imagens-ampliadas', notas);
}

/**
 * Recorta sem a perda que o Paint cobra.
 *
 * Copiar um pedaço é exato — nenhum pixel é interpolado. A perda que aparece
 * ao recortar no Paint não vem do corte: vem de gravar de novo em JPEG, que
 * recomprime a imagem inteira e cobra o preço em cima do que já tinha sido
 * cobrado quando a foto foi tirada. Por isso o padrão aqui é PNG, que é sem
 * perda; quem escolher JPG recebe o aviso.
 */
export async function cropImage(ctx: RunContext): Promise<RunResult> {
  const formato = formatoValido(ctx.options.formato ?? 'png');
  const qualidade = Math.min(1, Math.max(0.3, Number(ctx.options.qualidade ?? 95) / 100));
  const modo = String(ctx.options.modo ?? 'margens');

  const pct = (chave: string, padrao: number) => Math.min(45, Math.max(0, Number(ctx.options[chave] ?? padrao))) / 100;
  const [esquerda, direita, topo, base] = [
    pct('esquerda', 0),
    pct('direita', 0),
    pct('topo', 0),
    pct('base', 0),
  ];
  const proporcao = String(ctx.options.proporcao ?? '3x4');

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const origem = await pixelsDe(imagem);
    let pedaco;

    if (modo === 'proporcao') {
      const [pl, pa] = proporcao.split('x').map(Number);
      const alvo = pl / pa;
      const atual = origem.largura / origem.altura;
      // Aparar pelo centro: o assunto da foto quase sempre está no meio.
      const largura = atual > alvo ? origem.altura * alvo : origem.largura;
      const altura = atual > alvo ? origem.altura : origem.largura / alvo;
      pedaco = recortar(origem, (origem.largura - largura) / 2, (origem.altura - altura) / 2, largura, altura);
    } else {
      pedaco = recortar(
        origem,
        origem.largura * esquerda,
        origem.altura * topo,
        origem.largura * (1 - esquerda - direita),
        origem.altura * (1 - topo - base),
      );
    }

    return { name: nomeNoFormato(arquivo.name, formato), blob: await gravarPixels(pedaco, formato, qualidade) };
  });

  const notas =
    modo === 'proporcao'
      ? [`Aparadas pelo centro até a proporção ${proporcao.replace('x', ':')}.`]
      : ['Aparadas pelas margens que você informou.'];

  notas.push(
    'O corte em si não perde nada: é cópia de pixel, sem interpolação. A perda que aparece no Paint ' +
      'vem de gravar de novo em JPEG, que recomprime a imagem inteira.',
  );
  if (formato === 'jpeg') {
    notas.push('Você escolheu JPG, então há uma recompressão. Em PNG o recorte sai idêntico ao original.');
  }

  return entregar(ctx, saidas, 'imagens-recortadas', notas);
}
