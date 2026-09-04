/**
 * As contas de imagem, sem canvas no meio.
 *
 * Ficam separadas porque canvas só existe no navegador, e conta errada aqui
 * não quebra nada: entrega uma imagem bonita na medida errada, que só aparece
 * depois de impressa. Sendo função pura, dá para provar cada uma.
 */

export const POLEGADA_EM_MM = 25.4;

/** Um tamanho em pixels. */
export type Medida = { largura: number; altura: number };

/**
 * Quantos pixels uma medida em milímetros precisa ter para imprimir num
 * determinado DPI.
 *
 * É a conta que decide se a foto do cliente serve. Uma foto de 800 px numa
 * faixa de 1 metro dá 20 DPI, e nenhum ajuste conserta isso.
 */
export function pixelsParaImprimir(milimetros: number, dpi: number): number {
  return Math.round((milimetros / POLEGADA_EM_MM) * dpi);
}

/** O contrário: com quantos DPI esta imagem sai neste tamanho de papel. */
export function dpiNaImpressao(pixels: number, milimetros: number): number {
  if (milimetros <= 0) return 0;
  return Math.round(pixels / (milimetros / POLEGADA_EM_MM));
}

/**
 * A medida final, respeitando a proporção.
 *
 * `modo` decide o que a medida pedida significa:
 * - `cabe`: a imagem inteira entra no retângulo, e pode sobrar espaço.
 * - `preenche`: a imagem cobre o retângulo, e o que passa é aparado depois.
 * - `esticar`: usa a medida exata, deformando.
 */
export function encaixar(
  original: Medida,
  alvo: Partial<Medida>,
  modo: 'cabe' | 'preenche' | 'esticar' = 'cabe',
): Medida {
  const { largura: ol, altura: oa } = original;
  if (ol <= 0 || oa <= 0) return { largura: 0, altura: 0 };

  // Só um lado informado: o outro acompanha a proporção. É o caso mais comum
  // — "quero com 1200 de largura" — e nem precisa escolher modo.
  if (alvo.largura && !alvo.altura) {
    return { largura: Math.round(alvo.largura), altura: Math.round((alvo.largura / ol) * oa) };
  }
  if (alvo.altura && !alvo.largura) {
    return { largura: Math.round((alvo.altura / oa) * ol), altura: Math.round(alvo.altura) };
  }
  if (!alvo.largura || !alvo.altura) return { largura: ol, altura: oa };

  if (modo === 'esticar') {
    return { largura: Math.round(alvo.largura), altura: Math.round(alvo.altura) };
  }

  const proporcao =
    modo === 'preenche'
      ? Math.max(alvo.largura / ol, alvo.altura / oa)
      : Math.min(alvo.largura / ol, alvo.altura / oa);

  return { largura: Math.max(1, Math.round(ol * proporcao)), altura: Math.max(1, Math.round(oa * proporcao)) };
}

/**
 * Não aumenta imagem pequena.
 *
 * Esticar 800 px para 3000 não cria detalhe nenhum: entrega o mesmo borrão
 * num arquivo quatro vezes maior. Quem quiser aumentar tem que pedir.
 */
export function semAumentar(original: Medida, desejada: Medida): Medida {
  if (desejada.largura <= original.largura && desejada.altura <= original.altura) return desejada;
  return original;
}

/** Os formatos que o navegador grava. Fora desta lista, ninguém grava. */
export const FORMATOS_DE_SAIDA = {
  jpeg: { mime: 'image/jpeg', extensao: 'jpg', temQualidade: true, temTransparencia: false },
  png: { mime: 'image/png', extensao: 'png', temQualidade: false, temTransparencia: true },
  webp: { mime: 'image/webp', extensao: 'webp', temQualidade: true, temTransparencia: true },
} as const;

export type FormatoDeSaida = keyof typeof FORMATOS_DE_SAIDA;

export function formatoValido(nome: unknown): FormatoDeSaida {
  const chave = String(nome ?? 'jpeg').toLowerCase();
  if (chave === 'jpg') return 'jpeg';
  return chave in FORMATOS_DE_SAIDA ? (chave as FormatoDeSaida) : 'jpeg';
}

/** Troca a extensão do arquivo pela do formato de saída. */
export function nomeNoFormato(nome: string, formato: FormatoDeSaida): string {
  const base = nome.replace(/\.[^.\\/]+$/, '') || 'imagem';
  return `${base}.${FORMATOS_DE_SAIDA[formato].extensao}`;
}

/**
 * O próximo palpite de qualidade para chegar perto de um peso alvo.
 *
 * Busca binária: em vez de tentar qualidade 90, 80, 70... a cada passo o
 * intervalo cai pela metade, e sete ou oito tentativas já chegam perto.
 * A função é pura e recebe o peso medido, então o teste consegue provar a
 * convergência sem gravar arquivo nenhum.
 */
export function proximaQualidade(
  faixa: { minima: number; maxima: number },
  atual: number,
  pesou: number,
  alvo: number,
): { qualidade: number; faixa: { minima: number; maxima: number } } {
  const nova = pesou > alvo ? { minima: faixa.minima, maxima: atual } : { minima: atual, maxima: faixa.maxima };
  return { qualidade: (nova.minima + nova.maxima) / 2, faixa: nova };
}

/** Lê um tamanho como "500 KB", "1,5 MB" ou "800000". */
export function bytesDoAlvo(texto: unknown): number | null {
  const bruto = String(texto ?? '').trim().toLowerCase().replace(',', '.');
  if (!bruto) return null;

  const partes = bruto.match(/^([\d.]+)\s*(kb|mb|k|m|b)?$/);
  if (!partes) return null;

  const numero = Number(partes[1]);
  if (!Number.isFinite(numero) || numero <= 0) return null;

  const unidade = partes[2] ?? 'kb';
  const fator = unidade === 'mb' || unidade === 'm' ? 1024 * 1024 : unidade === 'b' ? 1 : 1024;
  return Math.round(numero * fator);
}
