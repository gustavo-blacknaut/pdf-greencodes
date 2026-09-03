'use client';

/**
 * A ponte entre as ferramentas da tela e o motor de PDF em Python.
 *
 * Existe por causa de uma medição: no mesmo arquivo de 141 páginas, na mesma
 * máquina, mesmo DPI e mesma qualidade de JPEG, o pdf.js levou 1189 ms por
 * página e o PyMuPDF 277 ms — 2min48s contra 39s. Toda ferramenta que
 * rasteriza página sente essa diferença.
 *
 * As que só mexem na estrutura do PDF (juntar, dividir, girar) já eram
 * rápidas no TypeScript, então continuam lá: trocar por trocar só somaria
 * risco de mudar comportamento sem ganho nenhum. O mapa `NO_PYTHON` é a lista
 * explícita do que atravessa.
 *
 * No site nada disso existe: `window.greenpdf` não está lá, `temMotorPython`
 * devolve falso e o motor de TypeScript atende tudo, como sempre atendeu.
 */

import { motorPython } from '../desktop';
import type { OutputFile, RunContext, RunResult } from './tipos';

type Opcoes = Record<string, string | number | boolean>;

type Traducao = {
  /** O nome da ação do lado do Python. */
  acao: string;
  /** Traduz os campos da tela para o que o motor espera. */
  opcoes?: (o: Opcoes) => Record<string, unknown>;
  /**
   * Quando devolve falso, a operação fica no motor de TypeScript. Serve para
   * os casos que o Python ainda não cobre — como comprimir juntando vários
   * arquivos num só.
   */
  aceita?: (ctx: RunContext) => boolean;
  /** O que a ferramenta faz, para a barra de andamento ter texto. */
  rotulo: string;
};

function numero(valor: unknown, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

/**
 * As ferramentas que passaram para o Python.
 *
 * Todas rasterizam página — é onde o ganho existe. As de cor ganham também
 * uma coisa que o TypeScript não conseguia fazer de jeito nenhum: gravar
 * DeviceCMYK de verdade, para o K100 chegar na chapa como K100.
 */
const NO_PYTHON: Record<string, Traducao> = {
  compress: {
    acao: 'comprimir',
    rotulo: 'Comprimindo',
    // Comprimir juntando vários num só é coisa que o motor Python não faz;
    // nesse caso o TypeScript continua respondendo.
    aceita: (ctx) => ctx.files.length === 1 && ctx.options.juntar !== true,
    opcoes: (o) => {
      const nivel = String(o.level ?? 'sem-perda');
      if (nivel === 'sem-perda') return { redesenhar: false };
      return { redesenhar: true, nivel: nivel === 'maxima' ? 'muito' : 'medio' };
    },
  },

  grayscale: {
    acao: 'tons-de-cinza',
    rotulo: 'Convertendo para cinza',
    opcoes: (o) => ({ dpi: numero(o.dpi, 150) }),
  },

  'invert-colors': {
    acao: 'inverter-cor',
    rotulo: 'Invertendo',
    opcoes: (o) => ({ dpi: numero(o.dpi, 150) }),
  },

  'black-tones': {
    acao: 'tons-de-preto',
    rotulo: 'Escurecendo',
    opcoes: (o) => ({
      dpi: numero(o.dpi, 150),
      limite: numero(o.limite, 180),
      tinta: String(o.tinta ?? 'rgb'),
    }),
  },

  'rgb-to-cmyk': {
    acao: 'rgb-para-cmyk',
    rotulo: 'Separando a cor',
    opcoes: (o) => ({
      preto: String(o.preto ?? 'rico'),
      ajustarPreto: o.ajustarPreto !== false,
      marcarDevice: o.marcarDevice !== false,
    }),
  },

  'pdf-to-images': {
    acao: 'pdf-para-imagem',
    rotulo: 'Desenhando as páginas',
    opcoes: (o) => ({
      dpi: numero(o.dpi, 200),
      formato: String(o.formato ?? o.format ?? 'jpeg') === 'png' ? 'png' : 'jpeg',
      qualidade: numero(o.qualidade ?? o.quality, 90),
      paginas: String(o.paginas ?? o.pages ?? ''),
    }),
  },
};

/** Se esta operação, com estes arquivos, deve ir para o Python. */
export function temMotorPython(id: string, ctx: RunContext): boolean {
  const traducao = NO_PYTHON[id];
  if (!traducao || !motorPython()) return false;
  return traducao.aceita ? traducao.aceita(ctx) : true;
}

/**
 * Roda a operação no Python e devolve o resultado no formato que a tela já
 * entende.
 *
 * O caminho de ida e volta passa pelo disco porque a tela trabalha com bytes
 * na memória e o motor com arquivo. A gravação temporária custa alguns
 * milissegundos e o desenho economiza segundos, então a conta fecha com
 * folga — e é a mesma pasta temporária que o Windows limpa sozinho.
 */
export async function rodarNoPython(id: string, ctx: RunContext): Promise<RunResult> {
  const motor = motorPython();
  const traducao = NO_PYTHON[id];
  if (!motor || !traducao) throw new Error(`Ferramenta sem motor Python: ${id}`);

  const pasta = await motor.pastaTemporaria();
  const desligarAndamento = motor.aoAndar((passo) => {
    ctx.onProgress(0.1 + passo.fracao * 0.8, passo.mensagem || traducao.rotulo);
  });

  // Cancelar mata o processo do motor: ele atende um trabalho de cada vez, e
  // é o único jeito de parar um desenho de mil páginas na hora.
  const aoCancelar = () => void motor.cancelar();
  ctx.signal?.addEventListener('abort', aoCancelar);

  try {
    ctx.onProgress(0.02, 'Preparando o arquivo');

    const caminhos: string[] = [];
    for (const arquivo of ctx.files) {
      caminhos.push(await motor.gravarEntrada(pasta, arquivo.name, arquivo.bytes));
    }

    // Sem `saida`, o motor nomeia sozinho ao lado da entrada — que é esta
    // pasta temporária. Sai `contrato-comprimido.pdf` em vez de um "saida"
    // sem extensão, e vale tanto para quem gera um arquivo quanto para quem
    // gera uma pasta com vários.
    const dados = (await motor.executar(traducao.acao, {
      arquivos: caminhos,
      opcoes: traducao.opcoes ? traducao.opcoes(ctx.options) : {},
      senhas: ctx.files.map((arquivo) => arquivo.senha ?? ''),
    })) as Record<string, unknown>;

    ctx.onProgress(0.92, 'Lendo o resultado');

    const files = await lerSaidas(motor, dados);
    const outputBytes = files.reduce((total, arquivo) => total + arquivo.blob.size, 0);

    ctx.onProgress(1);
    return {
      files,
      inputBytes: ctx.files.reduce((total, arquivo) => total + arquivo.size, 0),
      outputBytes,
      notes: Array.isArray(dados.notas) ? (dados.notas as string[]) : [],
      highlightSavings: id === 'compress',
    };
  } finally {
    ctx.signal?.removeEventListener('abort', aoCancelar);
    desligarAndamento();
    await motor.limpar(pasta).catch(() => {});
  }
}

/** O motor devolve `arquivo` (um) ou `arquivos` (vários); os dois viram Blob. */
async function lerSaidas(
  motor: NonNullable<ReturnType<typeof motorPython>>,
  dados: Record<string, unknown>,
): Promise<OutputFile[]> {
  const lista = Array.isArray(dados.arquivos)
    ? (dados.arquivos as { arquivo: string; paginas?: number }[])
    : typeof dados.arquivo === 'string'
      ? [{ arquivo: dados.arquivo, paginas: dados.paginas as number | undefined }]
      : [];

  if (lista.length === 0) throw new Error('O motor terminou sem gerar arquivo nenhum.');

  const saidas: OutputFile[] = [];
  for (const item of lista) {
    const lido = await motor.lerSaida(item.arquivo);
    saidas.push({ name: lido.nome, blob: new Blob([lido.bytes]), pages: item.paginas });
  }
  return saidas;
}
