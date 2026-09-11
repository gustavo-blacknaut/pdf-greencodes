'use client';

/**
 * Ponte com o aplicativo de desktop.
 *
 * A mesma interface roda nos dois lugares. No site o resultado vira download e
 * expira; no app vai para o disco, onde a pessoa escolher.
 *
 * Fora do aplicativo — o caso do site — tudo aqui devolve vazio em silêncio,
 * então nenhuma tela precisa saber onde está rodando.
 *
 * Do outro lado é Rust, e não Node. Os bytes viajam como corpo cru da chamada,
 * que é o único jeito de passar 50 MB sem transformar em texto; o que não é
 * byte vai pelo cabeçalho, codificado, porque cabeçalho só aceita ASCII e nome
 * de arquivo em português não é ASCII.
 */

import { invoke as invokeDoTauri, isTauri, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * O invoke do Tauri, com o erro virando Error.
 *
 * Quando o Rust devolve Err, o Tauri rejeita com o texto puro, e não com um
 * Error. A tela só mostra a mensagem de quem é Error — todo o resto vira
 * "Algo deu errado ao processar o arquivo". Era assim que o motivo de
 * qualquer falha do motor sumia antes de chegar em quem estava usando.
 */
async function invoke<T>(comando: string, argumentos?: InvokeArgs, opcoes?: InvokeOptions): Promise<T> {
  try {
    return await invokeDoTauri<T>(comando, argumentos, opcoes);
  } catch (erro) {
    throw erro instanceof Error ? erro : new Error(typeof erro === 'string' ? erro : JSON.stringify(erro));
  }
}

import type { Montagem } from './impressao/folha';

export type ArquivoDoSistema = { nome: string; bytes: ArrayBuffer };

/** O que o diálogo devolve antes de ler: barato, e chega na hora. */
export type ArquivoEscolhido = { nome: string; caminho: string; tamanho: number };

export type Impressora = { nome: string; apelido: string; descricao: string; padrao: boolean };

/** O que o motor Python recebe. Caminhos em disco, nunca bytes. */
export type PedidoDoMotor = {
  arquivos: string[];
  opcoes?: Record<string, unknown>;
  senhas?: string[];
  saida?: string;
};

export type PassoDoMotor = { id: string; fracao: number; mensagem?: string };

export type ResultadoSalvar = { ok: boolean; caminho?: string; cancelado?: boolean; erro?: string };
export type ResultadoSalvarVarios = {
  ok: boolean;
  pasta?: string;
  quantidade?: number;
  cancelado?: boolean;
  erro?: string;
};

/**
 * O que a impressão aceita configurar.
 *
 * Espessura e tipo de papel (comum, fotográfico, cartão) ficam de fora da
 * lista silenciosa: essa escolha é do driver da impressora e só existe dentro
 * das Preferências do próprio fabricante — `usarDialogo` é o caminho até lá.
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

  /* A montagem de gráfica: escala, posição e marcas. */

  /** O mesmo que `ajuste`, mais a porcentagem. Substitui `ajuste` quando vem. */
  escala?: 'pagina' | 'preencher' | 'original' | 'porcento';
  /** 100 é o tamanho de verdade. Vale só no modo porcentagem. */
  escalaPorcento?: number;
  /** Deslocamento a partir do centro da folha, em milímetros. */
  deslocaXmm?: number;
  deslocaYmm?: number;
  /** Espelhar, para transfer e sublimação. */
  espelho?: 'nao' | 'horizontal' | 'vertical';
  /** Negativo, para fotolito. */
  negativo?: boolean;
  /** Os oito riscos que dizem onde cortar. Precisam de margem para caber. */
  marcasCorte?: boolean;
  /** Os alvos de alinhamento de chapa. Só servem em impressão de mais de uma cor. */
  marcasRegistro?: boolean;
  /** Grava num arquivo em vez de mandar para o papel, quando a impressora é virtual. */
  arquivo?: string;
  /**
   * Abre o diálogo do driver antes de enviar.
   *
   * É o único caminho garantido para os ajustes do fabricante — tipo de
   * papel, padrão fino ou grosso, melhor qualidade de imagem. O que for
   * escolhido ali volta e é o que o envio usa.
   */
  usarDialogo?: boolean;
};

/* ----------------------------------------------------------------- básico */

export function estaNoAplicativo(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Os bytes que o Rust devolveu, qualquer que seja o canal.
 *
 * Pelo canal normal chega um ArrayBuffer. Pelo reserva — que o Tauri usa
 * quando o normal falha — chega a lista de números do JSON, e `new File([lista])`
 * gravaria o texto "37,80,68..." no lugar do PDF, calado. Aqui os dois viram
 * a mesma coisa.
 */
export function comoBytes(valor: unknown): ArrayBuffer {
  if (valor instanceof ArrayBuffer) return valor;
  if (ArrayBuffer.isView(valor)) {
    return valor.buffer.slice(valor.byteOffset, valor.byteOffset + valor.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(valor)) return Uint8Array.from(valor as number[]).buffer;
  throw new Error('O aplicativo devolveu algo que não são bytes.');
}

/** Chama o outro lado, ou devolve o combinado quando estamos no site. */
async function pedir<T>(comando: string, argumentos?: Record<string, unknown>): Promise<T | null> {
  if (!estaNoAplicativo()) return null;
  return invoke<T>(comando, argumentos);
}

/**
 * Manda bytes, com o resto pelo cabeçalho.
 *
 * Cabeçalho só aceita ASCII, e nome de arquivo em português não é ASCII: por
 * isso cada valor vai codificado, e o outro lado desfaz.
 */
async function enviarBytes<T>(
  comando: string,
  bytes: ArrayBuffer,
  cabecalhos: Record<string, string>,
): Promise<T | null> {
  if (!estaNoAplicativo()) return null;
  const escapados: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(cabecalhos)) {
    escapados[chave] = encodeURIComponent(valor);
  }
  return invoke<T>(comando, bytes, { headers: escapados });
}

/**
 * Inscreve num aviso do outro lado e devolve como cancelar.
 *
 * A inscrição é assíncrona, mas quem chama está num `useEffect` e precisa de
 * uma função de limpeza agora — daí a promessa guardada e desfeita depois.
 */
function ouvir<T>(evento: string, callback: (dados: T) => void): () => void {
  if (!estaNoAplicativo()) return () => {};
  let vivo = true;
  const inscricao = listen<T>(evento, (aviso) => {
    if (vivo) callback(aviso.payload);
  });
  return () => {
    vivo = false;
    void inscricao.then((desligar) => desligar()).catch(() => {});
  };
}

const FORA = { ok: false, erro: 'Fora do aplicativo.' } as const;

/** Versão do executável. No site não há o que perguntar, então volta vazio. */
export async function versaoDoAplicativo(): Promise<string> {
  return (await pedir<string>('versao')) ?? '';
}

/* ---------------------------------------------------------------- salvar */

export async function salvarArquivo(nome: string, blob: Blob): Promise<ResultadoSalvar> {
  const r = await enviarBytes<ResultadoSalvar>('salvar_arquivo', await blob.arrayBuffer(), { nome });
  return r ?? FORA;
}

/**
 * Grava solto em Downloads, com nome de ID como os do Discord
 * (1289473829384756224.pdf): nunca repete, e o mais novo tem o maior número.
 *
 * Sem diálogo e sem sobrescrever nada. Quem processa dez documentos seguidos
 * quer o resultado no disco e pronto.
 *
 * `apagarEm1Dia` marca o arquivo para se apagar sozinho depois de 24 horas.
 * É opcional e por arquivo: o que não for marcado fica para sempre, porque é
 * arquivo da pessoa, no computador dela.
 */
export async function salvarNumerado(
  nome: string,
  blob: Blob,
  apagarEm1Dia = false,
): Promise<ResultadoSalvar> {
  const r = await enviarBytes<ResultadoSalvar>('salvar_numerado', await blob.arrayBuffer(), {
    nome,
    apagar: apagarEm1Dia ? '1' : '0',
  });
  return r ?? FORA;
}

/** Liga ou desliga a auto-exclusão de um arquivo que já foi salvo. */
export async function definirAutoExclusao(caminho: string, ligado: boolean): Promise<boolean> {
  const r = await pedir<ResultadoSalvar>('auto_exclusao', { caminho, ligado });
  return Boolean(r?.ok);
}

/**
 * Escolhe uma pasta e grava vários arquivos nela.
 *
 * A pasta é perguntada uma vez só, e cada arquivo vai numa chamada: mandar
 * trinta arquivos num pacote só significaria ter os trinta na memória ao mesmo
 * tempo, e é justamente quem separa um PDF em trinta páginas que usa isto.
 */
export async function salvarVarios(
  arquivos: { nome: string; blob: Blob }[],
): Promise<ResultadoSalvarVarios> {
  if (!estaNoAplicativo()) return FORA;
  if (arquivos.length === 0) return { ok: false, erro: 'Nada para salvar.' };

  const escolha = await invoke<ResultadoSalvar>('escolher_pasta');
  if (!escolha.ok || !escolha.caminho) return { ok: false, cancelado: true };

  const pasta = escolha.caminho;
  let quantidade = 0;
  for (const arquivo of arquivos) {
    const r = await enviarBytes<ResultadoSalvar>('gravar_em', await arquivo.blob.arrayBuffer(), {
      pasta,
      nome: arquivo.nome,
    });
    if (r?.ok) quantidade += 1;
    else if (r?.erro) return { ok: false, erro: r.erro };
  }
  return { ok: true, pasta, quantidade };
}

/* ------------------------------------------------------------------ abrir */

/**
 * Abre o diálogo e devolve o que foi escolhido, sem ler o conteúdo.
 *
 * Ler aqui era o que deixava a tela muda: com 400 MB, entre fechar o diálogo
 * e o arquivo aparecer passavam dezenas de segundos sem nada acontecendo.
 */
export async function escolherArquivos(extensoes?: string[]): Promise<ArquivoEscolhido[]> {
  return (await pedir<ArquivoEscolhido[]>('escolher_arquivos', { extensoes })) ?? [];
}

/**
 * A partir daqui, o PDF fica no disco e não entra na memória da janela.
 *
 * Um PDF de 2 GB lido inteiro passaria duas vezes pela janela — na ida e,
 * no motor, na volta —, e numa máquina de 4 GB de RAM isso não termina.
 * Acima deste tamanho o arquivo segue só pelo caminho: o motor Python abre
 * direto do disco e o resultado vai direto para Downloads.
 */
export const LIMIAR_EM_DISCO = 256 * 1024 * 1024;

/** Os arquivos que ficaram no disco, e onde estão. */
const noDisco = new WeakMap<File, { caminho: string; tamanho: number }>();

/** Onde está o arquivo que ficou no disco, ou nada se ele veio inteiro para a memória. */
export function arquivoNoDisco(arquivo: File): { caminho: string; tamanho: number } | null {
  return noDisco.get(arquivo) ?? null;
}

/** O tamanho de verdade: o `File` de um arquivo no disco não carrega os bytes, e diz 0. */
export function tamanhoDe(arquivo: File): number {
  return noDisco.get(arquivo)?.tamanho ?? arquivo.size;
}

/**
 * Lê um arquivo já escolhido e entrega como File.
 *
 * PDF grande vem vazio, marcado com o caminho: quem precisa dele pergunta a
 * `arquivoNoDisco`. Imagem e Office grandes ainda vêm inteiros — só o motor
 * de PDF sabe trabalhar direto do disco.
 */
export async function lerArquivoEscolhido(escolhido: ArquivoEscolhido): Promise<File> {
  if (!estaNoAplicativo()) throw new Error('Fora do aplicativo.');
  if (escolhido.tamanho > LIMIAR_EM_DISCO && escolhido.nome.toLowerCase().endsWith('.pdf')) {
    const vazio = new File([], escolhido.nome, { type: 'application/pdf' });
    noDisco.set(vazio, { caminho: escolhido.caminho, tamanho: escolhido.tamanho });
    return vazio;
  }
  return new File([await lerCaminho(escolhido.caminho)], escolhido.nome);
}

/**
 * O mesmo arquivo, com os bytes: para quem não sabe trabalhar pelo caminho,
 * como a prévia da impressão, que desenha a página na tela.
 */
export async function materializar(arquivo: File): Promise<File> {
  const emDisco = noDisco.get(arquivo);
  if (!emDisco) return arquivo;
  return new File([await lerCaminho(emDisco.caminho)], arquivo.name, { type: arquivo.type });
}

/** Os bytes de um arquivo entregue pela pessoa, lidos agora. */
export async function lerCaminho(caminho: string): Promise<ArrayBuffer> {
  if (!estaNoAplicativo()) throw new Error('Fora do aplicativo.');
  return comoBytes(await invoke<unknown>('ler_arquivo', { caminho }));
}

/**
 * Arquivos soltos na janela.
 *
 * O Tauri pega o arrastar antes da página: a página nunca recebe o arquivo, e
 * sem isto a área "Solte seu arquivo aqui" não fazia nada no aplicativo. Vem
 * o caminho, como no diálogo. Devolve a função de cancelar a inscrição.
 */
export function aoSoltarArquivos(callback: (lista: ArquivoEscolhido[]) => void): () => void {
  return ouvir('sistema:soltar-arquivos', callback);
}

/** Um arquivo está sendo arrastado por cima da janela (true) ou saiu dela (false). */
export function aoArrastar(callback: (arrastando: boolean) => void): () => void {
  return ouvir('sistema:arrastando', callback);
}

/** Progresso da leitura. Devolve a função de cancelar a inscrição. */
export function aoLerArquivo(
  callback: (dados: { caminho: string; lidos: number; total: number }) => void,
): () => void {
  return ouvir('arquivo:lendo', callback);
}

/** Abre o arquivo já salvo no programa padrão do sistema. */
export async function abrirNoSistema(caminho: string): Promise<ResultadoSalvar> {
  return (await pedir<ResultadoSalvar>('abrir', { caminho })) ?? FORA;
}

/** Abre numa janela do próprio programa. */
export async function abrirNoAplicativo(caminho: string): Promise<ResultadoSalvar> {
  return (await pedir<ResultadoSalvar>('abrir_aqui', { caminho })) ?? FORA;
}

/** Abre no navegador padrão do sistema. */
export async function abrirNoNavegador(caminho: string): Promise<ResultadoSalvar> {
  return (await pedir<ResultadoSalvar>('abrir_no_navegador', { caminho })) ?? FORA;
}

export function revelarNoExplorador(caminho: string): void {
  void pedir<boolean>('revelar', { caminho });
}

/** Abre no Explorador a pasta onde os resultados são salvos. */
export async function abrirPastaDosResultados(): Promise<boolean> {
  const r = await pedir<ResultadoSalvar>('abrir_pasta_dos_resultados');
  return Boolean(r?.ok);
}

/* ------------------------------------------------------------------ motor */

/**
 * O motor de PDF em Python (PyMuPDF).
 *
 * Existe porque desenhar página no pdf.js é lento: medido no mesmo arquivo de
 * 141 páginas, 1189 ms por página contra 277 do PyMuPDF. As ferramentas que
 * rasterizam passam por aqui; as que só mexem na estrutura do PDF continuam
 * rodando na própria janela, onde já eram rápidas.
 *
 * A interface trabalha com bytes e o motor com arquivo em disco, então a ponte
 * grava a entrada numa pasta temporária e lê a saída de volta.
 */
const MOTOR = {
  executar: (acao: string, pedido: PedidoDoMotor) =>
    invoke<Record<string, unknown>>('motor_executar', { acao, pedido }),

  cancelar: () => invoke<boolean>('motor_cancelar'),

  pastaTemporaria: () => invoke<string>('motor_pasta_temporaria'),

  gravarEntrada: async (pasta: string, nome: string, bytes: ArrayBuffer) =>
    (await enviarBytes<string>('motor_gravar_entrada', bytes, { pasta, nome })) ?? '',

  lerSaida: async (caminho: string) => {
    const bytes = comoBytes(await invoke<unknown>('motor_ler_saida', { caminho }));
    return { nome: caminho.split(/[\\/]/).pop() ?? 'arquivo', bytes };
  },

  /** Põe na pasta de trabalho um arquivo que ficou no disco, sem passar pela janela. */
  vincularEntrada: (pasta: string, caminho: string) =>
    invoke<string>('motor_vincular_entrada', { pasta, caminho }),

  /** Leva a saída do motor direto para Downloads. Devolve onde ela foi parar. */
  entregar: (caminho: string) =>
    invoke<{ ok: boolean; caminho?: string; tamanho?: number; erro?: string }>('motor_entregar', { caminho }),

  limpar: async (pasta: string) => {
    await invoke<boolean>('motor_limpar', { pasta });
  },

  /** Quanto já andou do trabalho atual. Devolve a função de desligar o aviso. */
  aoAndar: (callback: (passo: PassoDoMotor) => void) => ouvir('motor:andamento', callback),
};

export type MotorPython = typeof MOTOR;

/**
 * Um motor posto no lugar do Tauri, para o teste rodar o Python de verdade em
 * Node. Fora dos testes fica sempre vazio.
 */
let motorDeTeste: MotorPython | null = null;

export function substituirMotorParaTeste(motor: MotorPython | null): void {
  motorDeTeste = motor;
}

/** O motor Python, ou nada quando estamos no site. */
export function motorPython(): MotorPython | null {
  if (motorDeTeste) return motorDeTeste;
  return estaNoAplicativo() ? MOTOR : null;
}

/* -------------------------------------------------------------- impressão */

/** Lista as impressoras do sistema. Fora do aplicativo não há o que listar. */
export async function listarImpressoras(): Promise<Impressora[]> {
  const lista = await pedir<
    { nome: string; padrao?: boolean; descricao?: string }[]
  >('listar_impressoras');
  if (!lista) return [];
  return lista.map((impressora) => ({
    nome: impressora.nome,
    apelido: impressora.nome,
    descricao: impressora.descricao ?? '',
    padrao: Boolean(impressora.padrao),
  }));
}

/**
 * Abre as Preferências de Impressão do driver, no Windows.
 *
 * É o único lugar onde existe tipo e espessura de papel: isso fica no DEVMODE
 * privado do driver e não passa pela API do sistema, que só entrega tamanho,
 * cor e duplex. O que for marcado lá vira padrão da impressora e vale para o
 * que a gente enviar depois.
 */
export async function abrirPreferenciasDaImpressora(impressora: string): Promise<ResultadoSalvar> {
  return (await pedir<ResultadoSalvar>('preferencias_da_impressora', { impressora })) ?? FORA;
}

/** O que a folha precisa saber, a partir do que a tela pediu. */
function montagemDe(opcoes: OpcoesImpressao = {}): Montagem {
  return {
    papel: opcoes.papel ?? 'A4',
    paisagem: Boolean(opcoes.paisagem),
    dpi: opcoes.dpi ?? 300,
    escala: opcoes.escala ?? opcoes.ajuste ?? 'pagina',
    porcento: opcoes.escalaPorcento,
    deslocaX: opcoes.deslocaXmm,
    deslocaY: opcoes.deslocaYmm,
    margemLados: opcoes.margemLadosMm,
    margemCima: opcoes.margemCimaMm,
    espelho: opcoes.espelho,
    negativo: opcoes.negativo,
    marcasCorte: opcoes.marcasCorte,
    marcasRegistro: opcoes.marcasRegistro,
  };
}

/**
 * Manda o arquivo para a impressora.
 *
 * No aplicativo, cada página é montada aqui como uma folha inteira do tamanho
 * do papel — com escala, deslocamento, espelho e marcas já dentro dela — e vai
 * para o processo principal, que só diz ao Windows qual papel usar. O porquê
 * está em lib/impressao/folha.ts.
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
  if (estaNoAplicativo()) {
    const sessao = await invoke<{ ok: boolean; id?: string; erro?: string }>('impressao_preparar');
    if (!sessao.ok || !sessao.id) {
      return { ok: false, erro: sessao.erro ?? 'Não foi possível preparar a impressão.' };
    }

    const id = sessao.id;
    try {
      const { prepararParaImpressao } = await import('./pdf/impressao');
      await prepararParaImpressao(
        blob,
        montagemDe(opcoes),
        (indice, bytes) =>
          enviarBytes('impressao_pagina', bytes, { sessao: id, indice: String(indice) }),
        onProgresso,
      );

      return await invoke<ResultadoSalvar>('impressao_enviar', {
        id,
        nome,
        opcoes: {
          impressora: opcoes?.impressora,
          copias: opcoes?.copias,
          colorido: opcoes?.colorido,
          paisagem: opcoes?.paisagem,
          duplex: opcoes?.duplex,
          papel: opcoes?.papel ?? 'A4',
          arquivo: opcoes?.arquivo,
          usarDialogo: opcoes?.usarDialogo,
        },
      });
    } catch (erro) {
      await invoke('impressao_descartar', { id }).catch(() => {});
      return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
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

/* ------------------------------------------------------------- do sistema */

/**
 * Arquivos abertos pelo sistema operacional: clique duplo, "Abrir com" ou o
 * menu do botão direito. Devolve a função de cancelar a inscrição.
 *
 * O sistema entrega os caminhos antes de a página carregar, então os primeiros
 * ficam numa fila do outro lado — `sistema_pronto` é o aviso de que dá para
 * entregar. Os que chegarem depois vêm pelo evento.
 */
export function aoReceberArquivosDoSistema(callback: (arquivos: File[]) => void): () => void {
  if (!estaNoAplicativo()) return () => {};

  let vivo = true;
  const entregar = async (lista: ArquivoEscolhido[]) => {
    if (!vivo || lista.length === 0) return;
    const lidos: File[] = [];
    for (const item of lista) {
      try {
        lidos.push(await lerArquivoEscolhido(item));
      } catch {
        /* sumiu entre abrir e ler: seguimos com os que deram certo */
      }
    }
    if (vivo && lidos.length > 0) callback(lidos);
  };

  void invoke<ArquivoEscolhido[]>('sistema_pronto').then(entregar).catch(() => {});
  const desligar = ouvir<ArquivoEscolhido[]>('sistema:abrir-arquivos', (lista) => {
    void entregar(lista);
  });

  return () => {
    vivo = false;
    desligar();
  };
}

/* ------------------------------------------------------------------- uso */

/**
 * O que a pessoa já fez no programa, só em números.
 *
 * Nenhum nome de arquivo, nenhum conteúdo: o lado Rust recusa qualquer
 * identificador que não seja slug de ferramenta. Fica no computador.
 */
export type Uso = {
  desde: number;
  ferramentas: Record<string, number>;
  arquivosProcessados: number;
  paginasProcessadas: number;
  bytesProcessados: number;
  impressoes: number;
  folhasImpressas: number;
  arquivosSalvos: number;
};

export type EventoDeUso =
  | { tipo: 'ferramenta'; slug: string; arquivos: number; paginas: number; bytes: number }
  | { tipo: 'impressao'; folhas: number; copias: number };

/** Conta um uso. Falhar aqui nunca atrapalha o trabalho que acabou de dar certo. */
export function registrarUso(evento: EventoDeUso): void {
  if (!estaNoAplicativo()) return;
  void invoke('uso_registrar', { evento }).catch(() => {});
}

export async function lerUso(): Promise<Uso | null> {
  return pedir<Uso>('uso_ler');
}

export async function zerarUso(): Promise<Uso | null> {
  return pedir<Uso>('uso_zerar');
}

export const integracaoDoSistema = {
  menuDeContexto: {
    consultar: async () => (await pedir<boolean>('integracao_consultar')) ?? false,
    definir: async (ligado: boolean) =>
      (await pedir<boolean>('integracao_definir', { ligado })) ?? false,
  },
  inicioAutomatico: {
    consultar: async () => (await pedir<boolean>('inicio_consultar')) ?? false,
    definir: async (ligado: boolean) => (await pedir<boolean>('inicio_definir', { ligado })) ?? false,
  },
};
