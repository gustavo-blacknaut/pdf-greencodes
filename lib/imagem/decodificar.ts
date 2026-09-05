'use client';

/**
 * Abrir qualquer imagem que o programa aceite, seja lá de onde ela veio.
 *
 * Fica num módulo próprio porque duas partes bem diferentes precisam da mesma
 * coisa: as ferramentas de imagem e o `juntar`, que transforma foto em página
 * de PDF. Antes cada uma abria do seu jeito, e o `juntar` abria só o que o
 * sistema tivesse rotulado como imagem — o que deixava um PNG de fora sempre
 * que o rótulo vinha vazio.
 */

/** Uma imagem decodificada, pronta para desenhar. */
export type Decodificada = { bitmap: ImageBitmap; largura: number; altura: number };

const HEIC = /\.(heic|heif)$/i;

/**
 * Decodifica o arquivo, seja lá o que ele for.
 *
 * HEIC é o formato que o iPhone grava desde 2017, e nem o navegador nem o
 * MuPDF abrem: precisa do libheif, que são quase 3 MB. Por isso ele só é
 * baixado quando alguém realmente manda um HEIC — quem junta um JPG não paga
 * nada por essa possibilidade.
 */
export async function decodificarImagem(arquivo: {
  name: string;
  bytes: ArrayBuffer;
  type?: string;
}): Promise<Decodificada> {
  // Uma cópia dos bytes: o Blob passa a ser dono do buffer, e o original
  // ainda é usado depois — no `juntar`, o mesmo arquivo pode ser desenhado
  // mais de uma vez.
  const copia = arquivo.bytes.slice(0);
  let dados: Blob = new Blob([copia], { type: arquivo.type || 'application/octet-stream' });

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
