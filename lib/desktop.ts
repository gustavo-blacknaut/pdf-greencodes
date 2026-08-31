'use client';

/**
 * Ponte com o aplicativo de desktop.
 *
 * O mesmo código de interface roda no site e no app. A diferença é o que
 * acontece com o resultado: no site ele vira um download e some da memória por
 * prazo; no app ele vai para o disco, no lugar que a pessoa escolher, e fica lá.
 *
 * Tudo aqui degrada em silêncio quando `window.greenpdf` não existe, que é o
 * caso do site. Nenhuma tela precisa saber onde está rodando.
 */

export type ArquivoDoSistema = { nome: string; bytes: ArrayBuffer };

type Ponte = {
  ehAplicativo: true;
  versao: () => Promise<string>;
  salvarArquivo: (nome: string, bytes: ArrayBuffer) => Promise<ResultadoSalvar>;
  salvarVarios: (arquivos: { nome: string; bytes: ArrayBuffer }[]) => Promise<ResultadoSalvarVarios>;
  escolherArquivos: (extensoes?: string[]) => Promise<ArquivoDoSistema[]>;
  revelar: (caminho: string) => Promise<boolean>;
  aoAbrirDoSistema: (callback: (arquivos: ArquivoDoSistema[]) => void) => () => void;
  menuDeContexto: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
  inicioAutomatico: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
};

export type ResultadoSalvar = { ok: boolean; caminho?: string; cancelado?: boolean; erro?: string };
export type ResultadoSalvarVarios = { ok: boolean; pasta?: string; quantidade?: number; cancelado?: boolean; erro?: string };

function ponte(): Ponte | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { greenpdf?: Ponte }).greenpdf ?? null;
}

export function estaNoAplicativo(): boolean {
  return ponte() !== null;
}

export async function salvarArquivo(nome: string, blob: Blob): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.salvarArquivo(nome, await blob.arrayBuffer());
}

export async function salvarVarios(arquivos: { nome: string; blob: Blob }[]): Promise<ResultadoSalvarVarios> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  const convertidos = await Promise.all(
    arquivos.map(async (arquivo) => ({ nome: arquivo.nome, bytes: await arquivo.blob.arrayBuffer() })),
  );
  return api.salvarVarios(convertidos);
}

export async function escolherArquivos(extensoes?: string[]): Promise<File[]> {
  const api = ponte();
  if (!api) return [];
  const escolhidos = await api.escolherArquivos(extensoes);
  return escolhidos.map((arquivo) => new File([arquivo.bytes], arquivo.nome));
}

export function revelarNoExplorador(caminho: string): void {
  void ponte()?.revelar(caminho);
}

/**
 * Arquivos abertos pelo sistema operacional: clique duplo, "Abrir com" ou o
 * menu do botão direito. Devolve a função de cancelar a inscrição.
 */
export function aoReceberArquivosDoSistema(callback: (arquivos: File[]) => void): () => void {
  const api = ponte();
  if (!api) return () => {};
  return api.aoAbrirDoSistema((arquivos) => {
    callback(arquivos.map((arquivo) => new File([arquivo.bytes], arquivo.nome)));
  });
}

export const integracaoDoSistema = {
  menuDeContexto: {
    consultar: () => ponte()?.menuDeContexto.consultar() ?? Promise.resolve(false),
    definir: (ligado: boolean) => ponte()?.menuDeContexto.definir(ligado) ?? Promise.resolve(false),
  },
  inicioAutomatico: {
    consultar: () => ponte()?.inicioAutomatico.consultar() ?? Promise.resolve(false),
    definir: (ligado: boolean) => ponte()?.inicioAutomatico.definir(ligado) ?? Promise.resolve(false),
  },
};
