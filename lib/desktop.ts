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

/** O que o diálogo devolve antes de ler: barato, e chega na hora. */
export type ArquivoEscolhido = { nome: string; caminho: string; tamanho: number };

type Ponte = {
  ehAplicativo: true;
  versao: () => Promise<string>;
  salvarArquivo: (nome: string, bytes: ArrayBuffer) => Promise<ResultadoSalvar>;
  salvarVarios: (arquivos: { nome: string; bytes: ArrayBuffer }[]) => Promise<ResultadoSalvarVarios>;
  salvarNumerado: (nome: string, bytes: ArrayBuffer) => Promise<ResultadoSalvar>;
  abrir: (caminho: string) => Promise<ResultadoSalvar>;
  abrirAqui: (caminho: string) => Promise<ResultadoSalvar>;
  abrirNoNavegador: (caminho: string) => Promise<ResultadoSalvar>;
  escolherArquivos: (extensoes?: string[]) => Promise<ArquivoEscolhido[]>;
  lerArquivo: (caminho: string) => Promise<{ ok: boolean; nome?: string; bytes?: ArrayBuffer; erro?: string }>;
  aoLerArquivo: (callback: (dados: { caminho: string; lidos: number; total: number }) => void) => () => void;
  revelar: (caminho: string) => Promise<boolean>;
  abrirPastaDosResultados: () => Promise<ResultadoSalvar>;
  motor: {
    executar: (acao: string, pedido: PedidoDoMotor) => Promise<Record<string, unknown>>;
    cancelar: () => Promise<boolean>;
    pastaTemporaria: () => Promise<string>;
    gravarEntrada: (pasta: string, nome: string, bytes: ArrayBuffer) => Promise<string>;
    lerSaida: (caminho: string) => Promise<{ nome: string; bytes: ArrayBuffer }>;
    limpar: (pasta: string) => Promise<void>;
    aoAndar: (callback: (passo: PassoDoMotor) => void) => () => void;
  };
  impressao: {
    preparar: () => Promise<{ ok: boolean; id?: string; erro?: string }>;
    pagina: (id: string, indice: number, bytes: ArrayBuffer) => Promise<{ ok: boolean; erro?: string }>;
    enviar: (id: string, opcoes?: OpcoesImpressao, nome?: string) => Promise<ResultadoSalvar>;
    descartar: (id: string) => Promise<{ ok: boolean }>;
  };
  listarImpressoras: () => Promise<Impressora[]>;
  preferenciasDaImpressora: (impressora: string) => Promise<ResultadoSalvar>;
  aoAbrirDoSistema: (callback: (arquivos: ArquivoDoSistema[]) => void) => () => void;
  menuDeContexto: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
  inicioAutomatico: { consultar: () => Promise<boolean>; definir: (ligado: boolean) => Promise<boolean> };
};

export type Impressora = { nome: string; apelido: string; descricao: string; padrao: boolean };

/** O que o motor Python recebe. Caminhos em disco, nunca bytes. */
export type PedidoDoMotor = {
  arquivos: string[];
  opcoes?: Record<string, unknown>;
  senhas?: string[];
  saida?: string;
};

export type PassoDoMotor = { id: string; fracao: number; mensagem?: string };

/** Abre no Explorador a pasta onde os resultados sao salvos. */
export async function abrirPastaDosResultados(): Promise<boolean> {
  return Boolean((await ponte()?.abrirPastaDosResultados())?.ok);
}

/** O motor Python, ou nada quando estamos no site. */
export function motorPython() {
  return ponte()?.motor ?? null;
}

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
  /** Margem em milímetros. Nos lados e em cima/embaixo, separadas. */
  margemLadosMm?: number;
  margemCimaMm?: number;
  /** Como a página se encaixa na folha. */
  ajuste?: 'pagina' | 'preencher' | 'original';
  /**
   * Abre o diálogo do Windows em vez de mandar direto.
   *
   * É o único caminho garantido para os ajustes do driver — tipo de papel,
   * padrão fino ou grosso, melhor qualidade de imagem. A impressão silenciosa
   * monta os ajustes por conta própria e pode ignorar o que está salvo lá.
   */
  usarDialogo?: boolean;
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

/** Abre numa janela do próprio programa. */
export async function abrirNoAplicativo(caminho: string): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.abrirAqui(caminho);
}

/** Abre no navegador padrão do sistema. */
export async function abrirNoNavegador(caminho: string): Promise<ResultadoSalvar> {
  const api = ponte();
  if (!api) return { ok: false, erro: 'Fora do aplicativo.' };
  return api.abrirNoNavegador(caminho);
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

/**
 * Abre o diálogo e devolve o que foi escolhido, sem ler o conteúdo.
 *
 * Ler aqui era o que deixava a tela muda: com 400 MB, entre fechar o diálogo
 * e o arquivo aparecer passavam dezenas de segundos sem nada acontecendo.
 */
export async function escolherArquivos(extensoes?: string[]): Promise<ArquivoEscolhido[]> {
  return (await ponte()?.escolherArquivos(extensoes)) ?? [];
}

/** Lê um arquivo já escolhido e entrega como File. */
export async function lerArquivoEscolhido(escolhido: ArquivoEscolhido): Promise<File> {
  const api = ponte();
  if (!api) throw new Error('Fora do aplicativo.');

  const r = await api.lerArquivo(escolhido.caminho);
  if (!r.ok || !r.bytes) throw new Error(r.erro ?? 'Não foi possível ler o arquivo.');
  return new File([r.bytes], r.nome ?? escolhido.nome);
}

/** Progresso da leitura. Devolve a função de cancelar a inscrição. */
export function aoLerArquivo(
  callback: (dados: { caminho: string; lidos: number; total: number }) => void,
): () => void {
  return ponte()?.aoLerArquivo(callback) ?? (() => {});
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
      return await api.impressao.enviar(sessao.id, opcoes, nome);
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
