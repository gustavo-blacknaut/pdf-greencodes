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
      // Para foto, o que importa é em que formato gravar: PNG não guarda
      // CMYK, então a saída é JPG ou PSD.
      formatoImagem: String(o.formatoImagem ?? 'jpg'),
      qualidade: numero(o.qualidade, 92),
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
    /*
     * Dos quatro modos da ferramenta, o motor faz dois: N páginas por arquivo
     * e por tamanho máximo.
     *
     * O de tamanho vale a viagem por um motivo que não é velocidade: quando
     * uma parte de uma página só passa do limite, ela não tem como ser
     * dividida de novo — precisa encolher. O motor encolhe reduzindo só as
     * imagens embutidas, e o texto continua texto. No navegador a única saída
     * seria redesenhar a página como foto, que destrói o texto junto.
     */
    aceita: (ctx) => ['every', 'size'].includes(String(ctx.options.mode ?? 'every')),
    opcoes: (o) =>
      String(o.mode ?? 'every') === 'size'
        ? {
            limiteBytes: Math.max(1024, Math.round(numero(o.maxSize, 10) * 1024 * 1024)),
            reduzir: o.reduzir !== false && o.reduzir !== 'false',
          }
        : { porArquivo: numero(o.every, 1) },
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

/**
 * Compacta um PDF sem tocar em nada do que está desenhado.
 *
 * Deduplica os objetos repetidos, joga fora o que ninguém referencia e
 * recomprime os fluxos. Nenhum pixel muda, nenhuma cor muda, o texto continua
 * texto — o arquivo só fica menor.
 *
 * O ganho é grande justamente ao juntar. Medido aqui: cinco cópias do mesmo
 * PDF de 3 KB viram 13 KB quando os objetos repetidos ficam todos no arquivo,
 * e voltam a 3 KB depois da deduplicação. Quem junta trinta orçamentos com o
 * mesmo timbre paga trinta vezes pelo timbre sem isto.
 *
 * O pdf-lib não sabe fazer isso, então no site esta função devolve o arquivo
 * como veio. No aplicativo, o MuPDF faz.
 *
 * Devolve sempre o menor dos dois: compactar que engorda não é compactar, e
 * arquivo estranho pode sair maior depois de reescrito.
 */
export async function compactarSemPerda(blob: Blob, senha?: string): Promise<Blob> {
  const motor = motorPython();
  if (!motor) return blob;

  const pasta = await motor.pastaTemporaria();
  try {
    const entrada = await motor.gravarEntrada(pasta, 'juntar.pdf', await blob.arrayBuffer());
    const dados = (await motor.executar('reparar', {
      arquivos: [entrada],
      opcoes: {},
      senhas: senha ? [senha] : [],
      saida: `${pasta}\\compacto.pdf`,
    })) as { arquivo?: string };

    if (typeof dados.arquivo !== 'string') return blob;
    const saida = await motor.lerSaida(dados.arquivo);
    const compacto = new Blob([saida.bytes], { type: 'application/pdf' });
    return compacto.size > 0 && compacto.size < blob.size ? compacto : blob;
  } catch {
    // Compactar é um extra. Falhar aqui não pode custar o trabalho que já
    // ficou pronto: devolve o arquivo do jeito que estava.
    return blob;
  } finally {
    await motor.limpar(pasta).catch(() => {});
  }
}

/**
 * O que a tela manda vira o que o motor espera.
 *
 * Exportado para o teste poder conferir a tradução sem subir o motor. É onde
 * mora o engano silencioso: uma unidade trocada — MB por bytes, milímetro por
 * ponto — não estoura em lugar nenhum, e entrega um arquivo mil vezes errado
 * que "funcionou".
 */
export function opcoesDoMotor(id: string, opcoes: Opcoes): Record<string, unknown> {
  const traducao = NO_PYTHON[id];
  if (!traducao) throw new Error(`Ferramenta sem motor Python: ${id}`);
  return traducao.opcoes ? traducao.opcoes(opcoes) : {};
}

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

    // O arquivo que ficou no disco entra por link, sem atravessar a janela;
    // o que veio para a memória é gravado na pasta de trabalho.
    const caminhos: string[] = [];
    for (const arquivo of ctx.files) {
      caminhos.push(
        arquivo.caminho
          ? await motor.vincularEntrada(pasta, arquivo.caminho)
          : await motor.gravarEntrada(pasta, arquivo.name, arquivo.bytes),
      );
    }
    // Com entrada no disco, a saída também não volta para a memória: vai
    // direto para Downloads, e a tela recebe só onde ela está.
    const noDisco = ctx.files.some((arquivo) => arquivo.caminho);

    // Sem `saida`, o motor nomeia sozinho ao lado da entrada — que é esta
    // pasta temporária. Sai `contrato-comprimido.pdf` em vez de um "saida"
    // sem extensão, e vale tanto para quem gera um arquivo quanto para quem
    // gera uma pasta com vários.
    const dados = (await motor.executar(traducao.acao, {
      arquivos: caminhos,
      opcoes: traducao.opcoes ? traducao.opcoes(ctx.options) : {},
      senhas: ctx.files.map((arquivo) => arquivo.senha ?? ''),
    })) as Record<string, unknown>;

    ctx.onProgress(0.92, noDisco ? 'Levando o resultado para Downloads' : 'Lendo o resultado');

    const files = noDisco ? await entregarSaidas(motor, dados) : await lerSaidas(motor, dados);
    const outputBytes = files.reduce((total, arquivo) => total + (arquivo.tamanho ?? arquivo.blob.size), 0);

    ctx.onProgress(1);
    return {
      files,
      inputBytes: ctx.files.reduce((total, arquivo) => total + arquivo.size, 0),
      outputBytes,
      notes: notasDoMotor(dados.notas),
      highlightSavings: id === 'compress',
    };
  } finally {
    ctx.signal?.removeEventListener('abort', aoCancelar);
    desligarAndamento();
    await motor.limpar(pasta).catch(() => {});
  }
}

/**
 * Quantas páginas, só quando o motor mandou um número.
 *
 * Nem toda operação usa `paginas` para isso: a cobertura de tinta manda ali a
 * medição de cada página, e a tela escrevia "[object Object],[object Object]"
 * no lugar da contagem.
 */
function contagemDePaginas(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

/** As notas que são texto. Qualquer outra coisa não tem como aparecer na tela. */
export function notasDoMotor(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((nota): nota is string => typeof nota === 'string') : [];
}

type Motor = NonNullable<ReturnType<typeof motorPython>>;

/** O motor devolve `arquivo` (um) ou `arquivos` (vários). */
function saidasDoMotor(dados: Record<string, unknown>): { arquivo: string; paginas?: unknown }[] {
  const lista = Array.isArray(dados.arquivos)
    ? (dados.arquivos as { arquivo: string; paginas?: unknown }[])
    : typeof dados.arquivo === 'string'
      ? [{ arquivo: dados.arquivo, paginas: dados.paginas }]
      : [];
  if (lista.length === 0) throw new Error('O motor terminou sem gerar arquivo nenhum.');
  return lista;
}

const nomeDe = (caminho: string) => caminho.split(/[\\/]/).pop() ?? 'arquivo';

/** Traz cada saída para a memória, como Blob. */
async function lerSaidas(motor: Motor, dados: Record<string, unknown>): Promise<OutputFile[]> {
  const saidas: OutputFile[] = [];
  for (const item of saidasDoMotor(dados)) {
    const lido = await motor.lerSaida(item.arquivo);
    saidas.push({ name: lido.nome, blob: new Blob([lido.bytes]), pages: contagemDePaginas(item.paginas) });
  }
  return saidas;
}

/**
 * Leva cada saída direto para Downloads, sem ler.
 *
 * É o caminho do arquivo grande: 2 GB que o motor gravou só mudam de pasta.
 * A tela fica com o nome, o tamanho e onde o arquivo está — o suficiente para
 * abrir, mostrar na pasta e contar.
 */
async function entregarSaidas(motor: Motor, dados: Record<string, unknown>): Promise<OutputFile[]> {
  const saidas: OutputFile[] = [];
  for (const item of saidasDoMotor(dados)) {
    const entregue = await motor.entregar(item.arquivo);
    if (!entregue.ok || !entregue.caminho) {
      throw new Error(entregue.erro ?? 'Não foi possível levar o resultado para Downloads.');
    }
    saidas.push({
      name: nomeDe(item.arquivo),
      blob: new Blob([]),
      pages: contagemDePaginas(item.paginas),
      caminho: entregue.caminho,
      tamanho: entregue.tamanho ?? 0,
    });
  }
  return saidas;
}
