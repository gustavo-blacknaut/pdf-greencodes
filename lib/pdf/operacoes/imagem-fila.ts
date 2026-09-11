'use client';

/**
 * A fila de imagens, que é igual em toda ferramenta de imagem.
 *
 * Abrir uma por vez, avisar o progresso, liberar a memória antes da seguinte,
 * e entregar um arquivo só ou um .zip conforme a quantidade. Nada disso é
 * decisão de nenhuma ferramenta em particular, e repetir esse laço em cada
 * uma é como um deles acaba esquecendo o `close` e derrubando a aba na
 * trigésima foto.
 */

import { decodificarImagem, type Decodificada } from '../../imagem/decodificar';
import { zipFiles } from '../nucleo';
import type { LoadedFile, OutputFile, RunContext, RunResult } from '../tipos';
import { replaceExtension, yieldToBrowser } from '../../utils';

/** Um arquivo por entrada, ou um .zip quando sai mais de um. */
export async function entregar(
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
    // Sem `pages`: a tela mostraria "3 páginas" para um zip de três fotos. A
    // quantidade de imagens já vai na nota logo abaixo.
    files: [{ name: replaceExtension(`${sufixoDoZip}.zip`, 'zip'), blob: zip }],
    inputBytes,
    outputBytes: zip.size,
    notes: [`${saidas.length} imagens, entregues num .zip.`, ...notas],
    highlightSavings: true,
  };
}

/** Percorre a fila decodificando, desenhando e liberando cada imagem. */
export async function porArquivo(
  ctx: RunContext,
  trabalho: (imagem: Decodificada, arquivo: LoadedFile) => Promise<OutputFile | null>,
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
