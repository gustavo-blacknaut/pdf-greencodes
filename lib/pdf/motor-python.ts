'use client';

/**
 * A ponte entre as ferramentas da tela e o motor de PDF em Python.
 *
 * Existe por causa de uma medição: no mesmo arquivo de 141 páginas, na mesma
 * máquina, mesmo DPI e mesma qualidade de JPEG, o pdf.js levou 1189 ms por
 * página e o PyMuPDF 277 ms — 2min48s contra 39s. Toda ferramenta que
 * rasteriza página sente essa diferença.
 *
 * Por muito tempo as que só mexem na estrutura do PDF ficaram de fora daqui,
 * porque "já eram rápidas". **Não eram, e a medição desmentiu.** O custo
 * nunca esteve na operação: está no pdf-lib abrir e gravar o arquivo. Só
 * abrir e gravar um documento de 300 páginas, sem fazer trabalho nenhum,
 * custa 7,0 s — 1,4 s para abrir e 5,6 s para gravar. O PyMuPDF entrega o
 * serviço completo, ida e volta ao disco incluída, em menos de 1 s.
 *
 * O que continua no TypeScript não é o que é rápido: é o que o motor não
 * sabe fazer. Proteger com permissões de impressão e cópia, dividir por
 * tamanho, marca d'água ladrilhada, o editor e o OCR. Cada caso desses tem
 * um `aceita` explicando, e o mapa `NO_PYTHON` é a lista do que atravessa.
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

/** Os nomes de papel como o motor os conhece. */
const PAPEIS_DO_MOTOR: Record<string, string> = { a3: 'A3', a4: 'A4', a5: 'A5', carta: 'carta', oficio: 'oficio' };
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

  // --- as que só mexem na estrutura do PDF ---
  //
  // Estavam em JavaScript por uma suposição que a medição desmentiu: elas
  // "já eram rápidas". Não eram. O custo nunca esteve na operação, e sim no
  // pdf-lib abrir e gravar o arquivo — num documento de 300 páginas isso é
  // 7,0 s de piso, sem fazer trabalho nenhum. O PyMuPDF faz o serviço
  // inteiro, ida e volta ao disco incluída, em menos de 1 s.

  merge: {
    acao: 'juntar',
    rotulo: 'Juntando',
    // Juntar aceita imagem misturada com PDF, e desenhar a imagem numa página
    // é serviço do lado de cá. Só a fila 100% PDF desce para o Python.
    aceita: (ctx) => ctx.files.every((f) => f.name.toLowerCase().endsWith('.pdf')),
  },
  reverse: { acao: 'inverter-paginas', rotulo: 'Invertendo a ordem' },
  booklet: { acao: 'livreto', rotulo: 'Montando o livreto' },
  'odd-even': { acao: 'separar-pares-impares', rotulo: 'Separando' },
  repair: { acao: 'reparar', rotulo: 'Reparando' },
  'strip-metadata': { acao: 'limpar-metadados', rotulo: 'Limpando os dados' },
  'set-metadata': {
    acao: 'definir-metadados',
    rotulo: 'Gravando os dados',
    opcoes: (o) => ({
      title: String(o.title ?? ''),
      author: String(o.author ?? ''),
      subject: String(o.subject ?? ''),
      keywords: String(o.keywords ?? ''),
    }),
  },
  crop: {
    acao: 'cortar',
    rotulo: 'Aparando',
    opcoes: (o) => ({
      topo: numero(o.top, 0),
      base: numero(o.bottom, 0),
      esquerda: numero(o.left, 0),
      direita: numero(o.right, 0),
    }),
  },
  'split-pages': {
    acao: 'dividir-paginas',
    rotulo: 'Cortando ao meio',
    opcoes: (o) => ({ sentido: String(o.mode ?? 'vertical') }),
  },
  interleave: {
    acao: 'intercalar',
    rotulo: 'Intercalando',
    opcoes: (o) => ({ inverterSegundo: o.reverseSecond === true || o.reverseSecond === 'true' }),
  },
  'n-up': {
    acao: 'varias-por-folha',
    rotulo: 'Montando as folhas',
    opcoes: (o) => ({
      porFolha: numero(o.perSheet, 2),
      espaco: numero(o.espacamentoMm, 0),
      margem: numero(o.margemMm, 0),
      borda: o.border === true || o.border === 'true',
    }),
  },
  'header-footer': {
    acao: 'cabecalho-rodape',
    rotulo: 'Escrevendo',
    opcoes: (o) => ({
      cabecalho: String(o.header ?? ''),
      rodape: String(o.footer ?? ''),
      alinhamento: String(o.align ?? 'centro'),
      tamanho: numero(o.size, 10),
    }),
  },
  'page-numbers': {
    acao: 'numerar',
    rotulo: 'Numerando',
    opcoes: (o) => ({
      posicao: String(o.position ?? 'rodape-centro'),
      formato: String(o.format ?? '{n}'),
      comecarEm: numero(o.startAt, 1),
      tamanho: numero(o.size, 11),
    }),
  },
  watermark: {
    acao: 'marca-dagua',
    rotulo: 'Carimbando',
    // `tile` repete a marca pela página inteira, e o motor Python só sabe
    // carimbar uma vez no meio. Ladrilhado continua do lado de cá.
    aceita: (ctx) => ctx.options.tile !== true && ctx.options.tile !== 'true',
    opcoes: (o) => ({
      texto: String(o.text ?? ''),
      tamanho: numero(o.size, 48),
      opacidade: numero(o.opacity, 0.18),
      giro: numero(o.angle, 45),
    }),
  },
  resize: {
    acao: 'redimensionar',
    rotulo: 'Redimensionando',
    // "Escala" e medida livre não existem no motor; papel conhecido, sim.
    aceita: (ctx) => ['a3', 'a4', 'a5', 'carta', 'oficio'].includes(String(ctx.options.target ?? 'a4')),
    opcoes: (o) => ({ papel: PAPEIS_DO_MOTOR[String(o.target ?? 'a4')] ?? 'A4' }),
  },
  split: {
    acao: 'dividir',
    rotulo: 'Dividindo',
    // Dos quatro modos da ferramenta, o motor faz um: N páginas por arquivo.
    aceita: (ctx) => String(ctx.options.mode ?? 'every') === 'every',
    opcoes: (o) => ({ porArquivo: numero(o.every, 1) }),
  },

  'separate-plates': {
    acao: 'separar-chapas',
    rotulo: 'Separando as chapas',
    opcoes: (o) => ({ dpi: numero(o.dpi, 150), chapas: String(o.chapas ?? 'cmyk') }),
  },
  'ink-coverage': {
    acao: 'cobertura-de-tinta',
    rotulo: 'Medindo a tinta',
    opcoes: (o) => ({
      dpi: numero(o.dpi, 150),
      papel: String(o.papel ?? 'offset'),
      limite: numero(o.limite, 300),
    }),
  },
  'photo-sheet': {
    acao: 'folha-de-fotos',
    rotulo: 'Montando a folha',
    opcoes: (o) => ({
      modelo: String(o.modelo ?? '3x4'),
      papel: String(o.papelFoto ?? '10x15'),
      paisagem: o.paisagem === true || o.paisagem === 'true',
      margem: numero(o.margemMm, 0),
      espaco: numero(o.espacoMm, 0),
      marcas: o.marcas !== false,
      deitar: o.deitar === true,
      esticar: o.esticar === true,
      // Zero quer dizer "quantas couberem", que é o padrão do motor.
      quantidade: numero(o.quantidade, 0),
      dpi: numero(o.dpi, 300),
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
