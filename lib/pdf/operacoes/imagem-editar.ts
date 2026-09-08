'use client';

/**
 * Tratar a imagem: cor, giro, fundo, moldura, marca d'água e montagem.
 *
 * A vizinha `imagem.ts` mexe no formato e no tamanho do arquivo; aqui se
 * mexe no que está desenhado dentro dele. A conta de verdade mora em
 * `lib/imagem/pixels.ts`, testada em Node; o que sobra para este arquivo é
 * ler as opções da tela, atravessar a ponte do canvas e escrever a nota
 * honesta no fim.
 *
 * Tudo em JavaScript, como as outras de imagem — o motor Python não grava
 * webp e não tem como devolver transparência para o navegador desenhar.
 */

import { FORMATOS_DE_SAIDA, formatoValido, nomeNoFormato, type FormatoDeSaida } from '../../imagem/medidas';
import { decodificarImagem } from '../../imagem/decodificar';
import { canvasDe, gravarPixels, pixelsDe } from '../../imagem/canvas';
import {
  ajustar,
  corDoTexto,
  emoldurar,
  girar,
  limparDigitalizacao,
  removerFundo,
  trocarCor,
  type Giro,
  type ModoDeCor,
} from '../../imagem/pixels';
import { canvasToBlob } from '../nucleo';
import { entregar, porArquivo } from './imagem-fila';
import type { OutputFile, RunContext, RunResult } from '../tipos';
import { replaceExtension, yieldToBrowser } from '../../utils';

function numero(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const lido = Number(valor);
  if (!Number.isFinite(lido)) return padrao;
  return Math.min(Math.max(lido, minimo), maximo);
}

function ligado(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === true || valor === 'true';
}

/** Formato e qualidade, que toda ferramenta daqui oferece do mesmo jeito. */
function saidaEscolhida(ctx: RunContext, padrao: FormatoDeSaida) {
  return {
    formato: formatoValido(ctx.options.formato ?? padrao),
    qualidade: numero(ctx.options.qualidade, 30, 100, 92) / 100,
  };
}

// ------------------------------------------------------------- ajustar ---

export async function adjustImage(ctx: RunContext): Promise<RunResult> {
  const { formato, qualidade } = saidaEscolhida(ctx, 'jpeg');
  const modoDeCor = String(ctx.options.cor ?? 'nenhum');

  const ajustes = {
    brilho: numero(ctx.options.brilho, -100, 100, 0),
    contraste: numero(ctx.options.contraste, -100, 100, 0),
    saturacao: numero(ctx.options.saturacao, -100, 100, 0),
    gama: numero(ctx.options.gama, 0.2, 3, 1),
  };

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    let mapa = ajustar(await pixelsDe(imagem), ajustes);
    if (modoDeCor !== 'nenhum') mapa = trocarCor(mapa, modoDeCor as ModoDeCor);
    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await gravarPixels(mapa, formato, qualidade),
    };
  });

  const mudou: string[] = [];
  if (ajustes.brilho) mudou.push(`brilho ${ajustes.brilho > 0 ? '+' : ''}${ajustes.brilho}`);
  if (ajustes.contraste) mudou.push(`contraste ${ajustes.contraste > 0 ? '+' : ''}${ajustes.contraste}`);
  if (ajustes.saturacao) mudou.push(`saturação ${ajustes.saturacao > 0 ? '+' : ''}${ajustes.saturacao}`);
  if (ajustes.gama !== 1) mudou.push(`meio-tom ${ajustes.gama}`);
  if (modoDeCor !== 'nenhum') {
    mudou.push(
      { cinza: 'tons de cinza', sepia: 'sépia', pb: 'preto e branco', negativo: 'negativo' }[modoDeCor] ?? modoDeCor,
    );
  }

  const notas = [mudou.length ? `Aplicado: ${mudou.join(', ')}.` : 'Nenhum ajuste foi pedido: a imagem saiu como entrou.'];
  if (modoDeCor === 'pb') {
    notas.push(
      'O corte entre preto e branco foi escolhido pela própria imagem, pelo método de Otsu. ' +
        'É o que faz funcionar em digitalização de papel amarelado, onde um corte fixo no meio da escala erra.',
    );
  }
  notas.push(
    'Os quatro ajustes rodam numa passada só, em número quebrado. Aplicar um por vez, cada um arredondando ' +
      'no fim, é o que abre aquelas faixas visíveis no céu de uma foto.',
  );

  return entregar(ctx, saidas, 'imagens-ajustadas', notas);
}

// ---------------------------------------------------------------- girar ---

export async function rotateImage(ctx: RunContext): Promise<RunResult> {
  const { formato, qualidade } = saidaEscolhida(ctx, 'png');
  const graus = numero(ctx.options.graus, 0, 270, 90) as Giro;
  const espelho = String(ctx.options.espelho ?? 'nao') as 'nao' | 'horizontal' | 'vertical';
  const soDeitadas = ligado(ctx.options.soDeitadas, false);

  let puladas = 0;

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const original = await pixelsDe(imagem);

    // "Só as deitadas" endireita um lote misto do celular de uma vez: as que
    // já estão em pé passam intactas.
    const deitada = original.largura > original.altura;
    if (soDeitadas && !deitada) {
      puladas += 1;
      return { name: nomeNoFormato(arquivo.name, formato), blob: await gravarPixels(original, formato, qualidade) };
    }

    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await gravarPixels(girar(original, graus, espelho), formato, qualidade),
    };
  });

  const notas: string[] = [];
  if (graus) notas.push(`Giradas ${graus} graus no sentido do relógio.`);
  if (espelho !== 'nao') notas.push(`Espelhadas na ${espelho}.`);
  if (!graus && espelho === 'nao') notas.push('Nem giro nem espelho foi pedido: as imagens saíram como entraram.');
  if (puladas) notas.push(`${puladas} já estavam em pé e passaram sem girar.`);
  notas.push(
    'Giro de quarto de volta não reamostra nada: cada pixel vai parar exatamente em cima de outro, ' +
      'e o resultado é idêntico ao original. A perda que sobra, se houver, é só do formato escolhido.',
  );
  if (formato === 'jpeg') {
    notas.push('Você escolheu JPG, que recomprime tudo. Em PNG o giro sai sem perder um pixel sequer.');
  }

  return entregar(ctx, saidas, 'imagens-giradas', notas);
}

// -------------------------------------------------------- remover fundo ---

export async function removeBackground(ctx: RunContext): Promise<RunResult> {
  const tolerancia = numero(ctx.options.tolerancia, 0, 120, 32);
  const suavizar = ligado(ctx.options.suavizar, true);
  const trocar = ligado(ctx.options.trocar, false);
  const corNova = corDoTexto(ctx.options.corNova, [255, 255, 255, 255]);

  // Com fundo trocado não há transparência para guardar, e o JPG serve. Sem
  // trocar, sair em JPG jogaria fora exatamente o que a ferramenta fez.
  const formato: FormatoDeSaida = trocar ? formatoValido(ctx.options.formato ?? 'png') : 'png';
  const qualidade = numero(ctx.options.qualidade, 30, 100, 92) / 100;

  let apagouPouco = 0;

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const original = await pixelsDe(imagem);
    const { imagem: recortada, apagados } = removerFundo(original, { tolerancia, suavizar });

    const total = original.largura * original.altura;
    if (apagados / total < 0.02) apagouPouco += 1;

    if (!trocar) {
      return {
        name: replaceExtension(arquivo.name, 'png'),
        blob: await gravarPixels(recortada, 'png', qualidade),
      };
    }

    // O fundo novo entra por baixo com `drawImage`, que compõe respeitando o
    // alfa — inclusive o meio-tom da borda suavizada.
    const canvas = document.createElement('canvas');
    canvas.width = recortada.largura;
    canvas.height = recortada.altura;
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');
    pincel.fillStyle = `rgb(${corNova[0]}, ${corNova[1]}, ${corNova[2]})`;
    pincel.fillRect(0, 0, canvas.width, canvas.height);
    pincel.drawImage(canvasDe(recortada), 0, 0);

    const alvo = FORMATOS_DE_SAIDA[formato];
    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined),
    };
  });

  const notas = [
    trocar
      ? 'O fundo antigo saiu e o novo entrou por baixo, respeitando a borda suavizada.'
      : 'O fundo saiu e virou transparência. Por isso o resultado é PNG: JPG não guarda transparência.',
    'A varredura começa pelas bordas e só caminha por vizinhos parecidos. É o que preserva o branco de ' +
      'dentro de uma letra "O" ou do miolo de uma logo, que "apagar tudo que for branco" comeria junto.',
  ];
  if (apagouPouco) {
    notas.push(
      `Em ${apagouPouco} imagem(ns) quase nada saiu. Isso acontece quando o fundo não é de uma cor só — ` +
        'aumente a tolerância, ou fotografe contra uma parede lisa.',
    );
  }
  notas.push(
    'Cabelo, fumaça e vidro não têm como sair direito por aqui: nesses casos o fundo e o assunto dividem ' +
      'o mesmo pixel, e separar exige um modelo treinado, que são dezenas de megabytes.',
  );

  return entregar(ctx, saidas, 'imagens-sem-fundo', notas);
}

// -------------------------------------------------- limpar digitalização ---

export async function cleanScan(ctx: RunContext): Promise<RunResult> {
  const { formato, qualidade } = saidaEscolhida(ctx, 'jpeg');
  const forca = numero(ctx.options.forca, 0, 100, 85) / 100;
  const paraPB = ligado(ctx.options.paraPB, false);

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    let mapa = limparDigitalizacao(await pixelsDe(imagem), forca);
    if (paraPB) mapa = trocarCor(mapa, 'pb');
    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await gravarPixels(mapa, formato, qualidade),
    };
  });

  const notas = [
    'O papel foi levado para o branco e a tinta para o preto, cada canal de cor com o seu próprio ponto — ' +
      'é isso que tira o amarelado do papel velho, em vez de deixá-lo só mais claro.',
    'O ponto de branco sai do percentil, e não do pixel mais claro: um único reflexo do vidro do scanner ' +
      'colocaria o branco lá no alto e a correção não faria nada.',
  ];
  if (paraPB) {
    notas.push('Levado a preto e branco puro, com o corte escolhido pela própria imagem. Ideal para fotocópia.');
  } else {
    notas.push('Página em branco continua em branco: sem faixa de tom para esticar, a folha só é clareada.');
  }
  notas.push('Fundo branco de verdade também economiza toner: o que era cinza-claro deixa de ser impresso.');

  return entregar(ctx, saidas, 'digitalizacoes-limpas', notas);
}

// ------------------------------------------------------------- moldura ---

export async function borderImage(ctx: RunContext): Promise<RunResult> {
  const { formato, qualidade } = saidaEscolhida(ctx, 'jpeg');
  const modo = String(ctx.options.modo ?? 'porcento');
  const porcento = numero(ctx.options.porcento, 0, 50, 5);
  const pixels = numero(ctx.options.pixels, 0, 2000, 40);
  const cor = corDoTexto(ctx.options.cor, [255, 255, 255, 255]);
  const filete = numero(ctx.options.filete, 0, 40, 0);
  const corDoFilete = corDoTexto(ctx.options.corDoFilete, [0, 0, 0, 255]);

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const original = await pixelsDe(imagem);
    const menorLado = Math.min(original.largura, original.altura);
    const espessura = modo === 'porcento' ? Math.round((menorLado * porcento) / 100) : Math.round(pixels);

    // O filete é a linha fina entre a foto e a moldura, o mesmo truque do
    // passe-partout emoldurado: sem ele uma foto clara se dissolve numa
    // moldura branca e o quadro perde o limite.
    const comFilete = filete > 0 ? emoldurar(original, Math.round(filete), corDoFilete) : original;
    const pronta = emoldurar(comFilete, espessura, cor);

    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await gravarPixels(pronta, formato, qualidade),
    };
  });

  const notas = [
    modo === 'porcento'
      ? `Moldura de ${porcento}% do menor lado, então cada imagem recebe uma borda proporcional a ela.`
      : `Moldura de ${pixels} px em cada lado.`,
    'A imagem não foi reduzida para abrir espaço: a moldura vai por fora, e o arquivo fica maior. ' +
      'É o que preserva a resolução original para a impressão.',
  ];
  if (filete > 0) notas.push(`Com filete de ${filete} px entre a foto e a moldura.`);

  return entregar(ctx, saidas, 'imagens-com-moldura', notas);
}

// -------------------------------------------------------- marca d'água ---

export async function watermarkImage(ctx: RunContext): Promise<RunResult> {
  const { formato, qualidade } = saidaEscolhida(ctx, 'jpeg');
  const texto = String(ctx.options.texto ?? '').trim();
  if (!texto) throw new Error('Escreva o texto da marca d’água.');

  const opacidade = numero(ctx.options.opacidade, 5, 100, 35) / 100;
  const tamanho = numero(ctx.options.tamanho, 2, 40, 8) / 100;
  const posicao = String(ctx.options.posicao ?? 'diagonal');
  const cor = corDoTexto(ctx.options.cor, [255, 255, 255, 255]);

  const saidas = await porArquivo(ctx, async (imagem, arquivo) => {
    const canvas = document.createElement('canvas');
    canvas.width = imagem.largura;
    canvas.height = imagem.altura;
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new Error('O navegador não deixou desenhar a imagem.');

    if (!FORMATOS_DE_SAIDA[formato].temTransparencia) {
      pincel.fillStyle = '#ffffff';
      pincel.fillRect(0, 0, canvas.width, canvas.height);
    }
    pincel.drawImage(imagem.bitmap, 0, 0);

    // O corpo da letra sai do menor lado: assim a marca ocupa a mesma fatia
    // da imagem, seja ela um retrato ou uma paisagem panorâmica.
    const corpo = Math.max(10, Math.round(Math.min(imagem.largura, imagem.altura) * tamanho));
    pincel.font = `bold ${corpo}px system-ui, "Segoe UI", Arial, sans-serif`;
    pincel.fillStyle = `rgba(${cor[0]}, ${cor[1]}, ${cor[2]}, ${opacidade})`;
    pincel.textAlign = 'center';
    pincel.textBaseline = 'middle';

    // Um contorno escuro atrás: sem ele a marca branca some numa foto clara,
    // que é justamente a foto que alguém copiaria.
    pincel.strokeStyle = `rgba(0, 0, 0, ${opacidade * 0.5})`;
    pincel.lineWidth = Math.max(1, corpo / 24);

    const escrever = (x: number, y: number) => {
      pincel.strokeText(texto, x, y);
      pincel.fillText(texto, x, y);
    };

    if (posicao === 'repetida') {
      // Ladrilhada e inclinada, que é a que não dá para recortar fora.
      const largura = pincel.measureText(texto).width;
      const passoX = largura + corpo * 2;
      const passoY = corpo * 3;
      pincel.save();
      pincel.rotate(-Math.PI / 6);
      const alcance = canvas.width + canvas.height;
      for (let y = -alcance; y < alcance; y += passoY) {
        for (let x = -alcance; x < alcance; x += passoX) escrever(x, y);
      }
      pincel.restore();
    } else if (posicao === 'diagonal') {
      pincel.save();
      pincel.translate(canvas.width / 2, canvas.height / 2);
      pincel.rotate(-Math.atan2(canvas.height, canvas.width));
      escrever(0, 0);
      pincel.restore();
    } else {
      const margem = corpo * 0.7;
      const x = posicao.includes('esquerda')
        ? margem + pincel.measureText(texto).width / 2
        : canvas.width - margem - pincel.measureText(texto).width / 2;
      const y = posicao.includes('topo') ? margem + corpo / 2 : canvas.height - margem - corpo / 2;
      escrever(x, y);
    }

    const alvo = FORMATOS_DE_SAIDA[formato];
    return {
      name: nomeNoFormato(arquivo.name, formato),
      blob: await canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined),
    };
  });

  return entregar(ctx, saidas, 'imagens-com-marca', [
    `Marca "${texto}" a ${Math.round(opacidade * 100)}% de opacidade.`,
    'A marca é desenhada nos pixels: não tem como desligar depois, nem apagar num editor sem apagar a foto junto.',
    posicao === 'repetida'
      ? 'Ladrilhada e inclinada, que é a forma que não some com um recorte.'
      : 'Marca num ponto só: um recorte tira ela fora. Para proteger de verdade, use a repetida.',
  ]);
}

// -------------------------------------------------------------- juntar ---

/** Quanto pode crescer a montagem, para a memória do navegador aguentar. */
const MAX_PIXELS_DA_MONTAGEM = 40_000_000;

export async function joinImages(ctx: RunContext): Promise<RunResult> {
  if (ctx.files.length < 2) {
    throw new Error('Junte pelo menos duas imagens. Com uma só não há o que montar.');
  }

  const { formato, qualidade } = saidaEscolhida(ctx, 'jpeg');
  const modo = String(ctx.options.modo ?? 'vertical');
  const espaco = numero(ctx.options.espaco, 0, 500, 0);
  const fundo = corDoTexto(ctx.options.fundo, [255, 255, 255, 255]);
  const colunasPedidas = Math.round(numero(ctx.options.colunas, 1, 20, 2));

  // Todas de uma vez: a montagem precisa das medidas de todas antes de
  // decidir o tamanho da folha.
  const imagens = [];
  for (let i = 0; i < ctx.files.length; i += 1) {
    ctx.onProgress((i / ctx.files.length) * 0.6, `Abrindo ${ctx.files[i].name}`);
    imagens.push(await decodificarImagem(ctx.files[i]));
    await yieldToBrowser();
  }

  try {
    const colunas = modo === 'horizontal' ? imagens.length : modo === 'vertical' ? 1 : colunasPedidas;
    const linhas = Math.ceil(imagens.length / colunas);

    // Cada célula fica do tamanho da maior imagem, e as menores são
    // centralizadas dentro. Esticar para igualar deformaria umas e não
    // outras — e numa colagem isso salta aos olhos.
    const celulaL = Math.max(...imagens.map((imagem) => imagem.largura));
    const celulaA = Math.max(...imagens.map((imagem) => imagem.altura));

    let largura = colunas * celulaL + (colunas + 1) * espaco;
    let altura = linhas * celulaA + (linhas + 1) * espaco;
    let escala = 1;

    if (largura * altura > MAX_PIXELS_DA_MONTAGEM) {
      escala = Math.sqrt(MAX_PIXELS_DA_MONTAGEM / (largura * altura));
      largura = Math.round(largura * escala);
      altura = Math.round(altura * escala);
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, largura);
    canvas.height = Math.max(1, altura);
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new Error('O navegador não deixou desenhar a montagem.');

    pincel.fillStyle = `rgb(${fundo[0]}, ${fundo[1]}, ${fundo[2]})`;
    pincel.fillRect(0, 0, canvas.width, canvas.height);
    pincel.imageSmoothingQuality = 'high';

    imagens.forEach((imagem, i) => {
      ctx.onProgress(0.6 + (i / imagens.length) * 0.35, `Montando ${i + 1}/${imagens.length}`);
      const coluna = i % colunas;
      const linha = Math.floor(i / colunas);
      const celulaX = (espaco + coluna * (celulaL + espaco)) * escala;
      const celulaY = (espaco + linha * (celulaA + espaco)) * escala;
      const larguraFinal = imagem.largura * escala;
      const alturaFinal = imagem.altura * escala;

      pincel.drawImage(
        imagem.bitmap,
        celulaX + (celulaL * escala - larguraFinal) / 2,
        celulaY + (celulaA * escala - alturaFinal) / 2,
        larguraFinal,
        alturaFinal,
      );
    });

    const alvo = FORMATOS_DE_SAIDA[formato];
    const blob = await canvasToBlob(canvas, alvo.mime, alvo.temQualidade ? qualidade : undefined);
    const saida: OutputFile[] = [{ name: nomeNoFormato('montagem', formato), blob }];

    const notas = [
      modo === 'vertical'
        ? `${imagens.length} imagens empilhadas uma embaixo da outra.`
        : modo === 'horizontal'
          ? `${imagens.length} imagens lado a lado.`
          : `${imagens.length} imagens numa grade de ${colunas} coluna(s) por ${linhas} linha(s).`,
      'Cada vaga tem o tamanho da maior imagem, e as menores ficam centradas. Esticar para igualar ' +
        'deformaria umas e não outras.',
    ];
    if (escala < 1) {
      notas.push(
        `A montagem passaria de 40 milhões de pixels e foi reduzida a ${Math.round(escala * 100)}% — ` +
          'acima disso a memória do navegador não aguenta.',
      );
    }

    ctx.onProgress(1);
    return {
      files: saida,
      inputBytes: ctx.files.reduce((total, arquivo) => total + arquivo.size, 0),
      outputBytes: blob.size,
      notes: notas,
    };
  } finally {
    for (const imagem of imagens) imagem.bitmap.close();
  }
}
