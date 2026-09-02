'use client';

/**
 * Ponte com o aplicativo de desktop.
 *
 * A mesma interface roda nos dois lugares. No site o resultado vira download e
 * expira; no app vai para o disco, onde a pessoa escolher.
 *
 * Sem `window.greenpdf` — o caso do site — tudo aqui devolve vazio em silêncio,
 * então nenhuma tela precisa saber onde está rodando.
 */

export type ArquivoDoSistema = { nome: string; bytes: ArrayBuffer };

type Ponte = {
  ehAplicativo: true;
  versao: () => Promise<string>;
  salvarArquivo: (nome: string, bytes: ArrayBuffer) => Promise<ResultadoSalvar>;
  salvarVarios: (arquivos: { nome: string; bytes: ArrayBuffer }[]) => Promise<ResultadoSalvarVarios>;
  salvarNumerado: (nome: string, bytes: ArrayBuffer) => Promise<ResultadoSalvar>;
  abrir: (caminho: string) => Promise<ResultadoSalvar>;
  escolherArquivos: (extensoes?: string[]) => Promise<ArquivoDoSistema[]>;
  revelar: (caminho: string) => Promise<boolean>;
  impressao: {
    preparar: () => Promise<{ ok: boolean; id?: string; erro?: string }>;
    pagina: (id: string, indice: number, bytes: ArrayBuffer) => Promise<{ ok: boolean; erro?: string }>;
    enviar: (id: string, opcoes?: OpcoesImpressao) => Promise<ResultadoSalvar>;
    descartar: (id: string) => Promise<{ ok: boolean }>;
  };
  listarImpressoras: () => Promise<Impressora[]>;
  preferenciasDaImpressora: (impressora: string) => Promise<ResultadoSalvar>;
  aoAbrirDoSistema: (callback: (arquivos: ArquivoDoSistema[]) => void) => () => void;
  menuDeContexto: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
  inicioAutomatico: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
};

export type Impressora = { nome: string; apelido: string; descricao: string; padrao: boolean };

/**
 * O que o Chromium aceita configurar sem abrir a caixa do Windows.
 *
 * Espessura e tipo de papel (comum, fotográfico, cartão) ficam de fora: essa
 * escolha é do driver da impressora, não do sistema de impressão, e só existe
 * dentro das Preferências do próprio fabricante.
 */
export type OpcoesImpressao = {
  impressora?: string;
  copias?: number;
  colorido?: boolean;
  paisagem?: boolean;
  duplex?: 'simplex' | 'shortEdge' | 'longEdge';
  papel?: 'A3' | 'A4' | 'A5' | 'Legal' | 'Letter' | 'Tabloid';
  dpi?: number;
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

/** Versão do executável. No site não há o que perguntar, então volta vazio. */
export async function versaoDoAplicativo(): Promise<string> {
  return (await ponte()?.versao()) ?? '';
}

export async function salvarArquivo(nome: string, blob: Blob): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.salvarArquivo(nome, await blob.arrayBuffer());
}

/**
 * Grava em Documentos/PDF.GreenCodes com o primeiro número livre: 1.pdf,
 * 2.pdf, 3.pdf. Sem diálogo e sem sobrescrever nada.
 */
export async function salvarNumerado(nome: string, blob: Blob): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.salvarNumerado(nome, await blob.arrayBuffer());
}

/** Abre o arquivo já salvo no programa padrão do sistema. */
export async function abrirNoSistema(caminho: string): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.abrir(caminho);
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

/**
 * Manda o arquivo para a impressora.
 *
 * No aplicativo as páginas são desenhadas uma a uma e enviadas ao processo
 * principal, que monta e imprime — o porquê está em lib/pdf/impressao.ts.
 *
 * No site isso não existe: o jeito é pôr o PDF num iframe escondido e pedir
 * print() por ele, que é o que o próprio leitor do navegador faria.
 */
export async function imprimirArquivo(
  nome: string,
  blob: Blob,
  opcoes?: OpcoesImpressao,
  onProgresso?: (feitas: number, total: number) => void,
): Promise<ResultadoSalvar> {
  const api = ponte();

  if (api) {
    const sessao = await api.impressao.preparar();
    if (!sessao.ok || !sessao.id) return { ok: false, erro: sessao.erro ?? 'Não foi possível preparar a impressão.' };

    try {
      const { prepararParaImpressao } = await import('./pdf/impressao');
      await prepararParaImpressao(
        blob,
        opcoes?.dpi ?? 300,
        (indice, bytes) => api.impressao.pagina(sessao.id!, indice, bytes),
        onProgresso,
      );
      return await api.impressao.enviar(sessao.id, opcoes);
    } catch (erro) {
      await api.impressao.descartar(sessao.id);
      return { ok: false, erro: erro instanceof Error ? erro.message : 'Falha ao preparar a impressão.' };
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const quadro = document.createElement('iframe');
    quadro.style.position = 'fixed';
    quadro.style.right = '0';
    quadro.style.bottom = '0';
    quadro.style.width = '0';
    quadro.style.height = '0';
    quadro.style.border = '0';
    quadro.src = url;

    // Não dá para saber quando a pessoa fecha o diálogo, então limpamos por
    // tempo: cedo demais cancela a impressão, tarde demais segura o blob.
    const limpar = () => {
      URL.revokeObjectURL(url);
      quadro.remove();
    };

    quadro.onload = () => {
      try {
        quadro.contentWindow?.focus();
        quadro.contentWindow?.print();
        resolve({ ok: true });
      } catch (erro) {
        resolve({ ok: false, erro: erro instanceof Error ? erro.message : 'Falha ao imprimir.' });
      }
      window.setTimeout(limpar, 60_000);
    };

    quadro.onerror = () => {
      limpar();
      resolve({ ok: false, erro: 'Não foi possível abrir o arquivo para impressão.' });
    };

    document.body.append(quadro);
  });
}

/**
 * Abre as Preferências de Impressão do driver, no Windows.
 *
 * É o único lugar onde existe tipo e espessura de papel: isso fica no
 * DEVMODE privado do driver e não passa pela API do sistema, que só entrega
 * tamanho, cor e duplex. O que for marcado lá vira padrão da impressora e
 * vale para o que a gente enviar depois.
 */
export async function abrirPreferenciasDaImpressora(impressora: string): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.preferenciasDaImpressora(impressora);
}

/** Lista as impressoras do sistema. Fora do aplicativo não há o que listar. */
export async function listarImpressoras(): Promise<Impressora[]> {
  return (await ponte()?.listarImpressoras()) ?? [];
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
