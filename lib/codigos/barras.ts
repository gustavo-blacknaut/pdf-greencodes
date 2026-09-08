/**
 * Códigos de barras lineares, dos módulos para cima.
 *
 * Cada simbologia vira uma sequência de módulos — `1` é barra escura, `0` é
 * espaço — e quem desenha decide quanto vale um módulo em milímetros. Separar
 * assim é o que permite o mesmo código sair em PNG na tela e em vetor no PDF
 * sem nenhum arredondamento pelo caminho.
 *
 * O código foi escrito aqui em vez de vir de um pacote pronto por um motivo
 * prático: na gráfica o que decide se o leitor bipa não é o desenho, é a
 * largura do módulo, a zona de silêncio e o dígito verificador. Pacote de
 * barras normalmente desenha em pixels e deixa esses três por conta de quem
 * usa — e é exatamente onde a etiqueta impressa falha no caixa do mercado.
 *
 * As tabelas abaixo são conferidas por invariantes no teste, e não só pela
 * leitura: em Code 128 toda letra soma 11 módulos e a soma das barras é par;
 * em Code 39 toda letra tem exatamente três elementos largos. Uma tabela
 * copiada com um dígito trocado quebra alguma dessas regras.
 */

export type Simbologia = 'ean13' | 'ean8' | 'code128' | 'code39' | 'itf';

export type CodigoDeBarras = {
  simbologia: Simbologia;
  /** `1` é barra escura e `0` é espaço. Não inclui a zona de silêncio. */
  modulos: string;
  /** O que vai escrito embaixo, já com o dígito verificador quando existe. */
  legenda: string;
  /** Quanto de branco a norma exige de cada lado, em módulos. */
  silencio: number;
  /** Quantas vezes o módulo largo é maior que o estreito (só nas de duas larguras). */
  razao?: number;
};

export const SIMBOLOGIAS: Record<Simbologia, { nome: string; sobre: string; exemplo: string }> = {
  ean13: {
    nome: 'EAN-13',
    sobre: 'O código de produto do mundo todo. 12 dígitos — o 13º é calculado.',
    exemplo: '789100031595',
  },
  ean8: {
    nome: 'EAN-8',
    sobre: 'A versão curta, para embalagem pequena. 7 dígitos — o 8º é calculado.',
    exemplo: '7891234',
  },
  code128: {
    nome: 'Code 128',
    sobre: 'Aceita letras, números e pontuação. É o mais usado em etiqueta interna e logística.',
    exemplo: 'GRAFICA-001',
  },
  code39: {
    nome: 'Code 39',
    sobre: 'Antigo e simples. Só maiúsculas, números e alguns sinais. Ainda pedido por sistema legado.',
    exemplo: 'PEDIDO 1234',
  },
  itf: {
    nome: 'ITF / ITF-14',
    sobre: 'Só números, sempre em quantidade par. É o código impresso na caixa de transporte.',
    exemplo: '1789100031595',
  },
};

// ------------------------------------------------------------------ EAN ---

/** Ímpar (L): o alfabeto da metade esquerda. */
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** Direita (R): o complemento do L — barra onde havia espaço. */
const EAN_R = EAN_L.map((padrao) => [...padrao].map((bit) => (bit === '0' ? '1' : '0')).join(''));

/** Par (G): o R lido de trás para frente. */
const EAN_G = EAN_R.map((padrao) => [...padrao].reverse().join(''));

/**
 * Como o primeiro dígito é gravado.
 *
 * O EAN-13 desenha só doze dígitos: o primeiro não tem barras próprias. Ele
 * aparece na *mistura* de L e G da metade esquerda — é por isso que dá para
 * ler um EAN-13 de cabeça para baixo sem confundir com outro código.
 */
const EAN13_PARIDADE = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** Verificador do EAN: pesos 1 e 3 alternados, contados da direita. */
export function digitoEan(digitos: string): number {
  let soma = 0;
  const invertido = [...digitos].reverse();
  for (let i = 0; i < invertido.length; i += 1) {
    soma += Number(invertido[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10;
}

function somenteDigitos(valor: string): string {
  return valor.replace(/\D+/g, '');
}

function ean13(entrada: string): CodigoDeBarras {
  let digitos = somenteDigitos(entrada);
  if (digitos.length === 13) digitos = digitos.slice(0, 12);
  if (digitos.length !== 12) {
    throw new Error(`O EAN-13 precisa de 12 dígitos (o 13º é calculado). Vieram ${digitos.length}.`);
  }

  const completo = digitos + digitoEan(digitos);
  const paridade = EAN13_PARIDADE[Number(completo[0])];

  let modulos = '101';
  for (let i = 0; i < 6; i += 1) {
    const valor = Number(completo[i + 1]);
    modulos += paridade[i] === 'L' ? EAN_L[valor] : EAN_G[valor];
  }
  modulos += '01010';
  for (let i = 7; i < 13; i += 1) modulos += EAN_R[Number(completo[i])];
  modulos += '101';

  return { simbologia: 'ean13', modulos, legenda: completo, silencio: 11 };
}

function ean8(entrada: string): CodigoDeBarras {
  let digitos = somenteDigitos(entrada);
  if (digitos.length === 8) digitos = digitos.slice(0, 7);
  if (digitos.length !== 7) {
    throw new Error(`O EAN-8 precisa de 7 dígitos (o 8º é calculado). Vieram ${digitos.length}.`);
  }

  const completo = digitos + digitoEan(digitos);

  let modulos = '101';
  for (let i = 0; i < 4; i += 1) modulos += EAN_L[Number(completo[i])];
  modulos += '01010';
  for (let i = 4; i < 8; i += 1) modulos += EAN_R[Number(completo[i])];
  modulos += '101';

  return { simbologia: 'ean8', modulos, legenda: completo, silencio: 7 };
}

// ------------------------------------------------------------ Code 128 ---

/**
 * As 107 letras do Code 128, cada uma em larguras de elemento.
 *
 * Seis números por letra, começando por barra e alternando: `212222` é barra
 * de 2, espaço de 1, barra de 2, espaço de 2, barra de 2, espaço de 2. Todas
 * somam 11 módulos; a última, a de parada, tem sete elementos e soma 13.
 */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const CODE128_B = 104;
const CODE128_C = 105;
const CODE128_PARADA = 106;

/** Larguras alternando barra/espaço viram módulos `1`/`0`. */
function larguraParaModulos(larguras: string): string {
  let saida = '';
  for (let i = 0; i < larguras.length; i += 1) {
    saida += (i % 2 === 0 ? '1' : '0').repeat(Number(larguras[i]));
  }
  return saida;
}

/**
 * Só dois conjuntos, e a escolha é uma regra só.
 *
 * Número par de dígitos vai em C, que grava dois dígitos por letra e sai com
 * metade da largura. Todo o resto vai em B. Um otimizador que troca de
 * conjunto no meio da palavra economizaria mais alguns milímetros em casos
 * raros, ao custo de um caminho de código que ninguém consegue conferir de
 * cabeça olhando a etiqueta. Numa gráfica, previsível vale mais.
 */
function code128(entrada: string): CodigoDeBarras {
  const texto = entrada.trim();
  if (!texto) throw new Error('Escreva o que vai dentro do código.');

  const soDigitos = /^\d+$/.test(texto);
  const modoC = soDigitos && texto.length % 2 === 0 && texto.length >= 4;

  const valores: number[] = [];
  if (modoC) {
    valores.push(CODE128_C);
    for (let i = 0; i < texto.length; i += 2) valores.push(Number(texto.slice(i, i + 2)));
  } else {
    const foraDaFaixa = [...texto].find((letra) => letra.charCodeAt(0) < 32 || letra.charCodeAt(0) > 126);
    if (foraDaFaixa) {
      throw new Error(
        `O Code 128 não aceita "${foraDaFaixa}". Ele grava letras sem acento, números e pontuação comum.`,
      );
    }
    valores.push(CODE128_B);
    for (const letra of texto) valores.push(letra.charCodeAt(0) - 32);
  }

  // Verificador: a letra de início pesa 1, e cada letra seguinte pesa a sua
  // posição. Sem ele o leitor aceita qualquer borrão como código válido.
  let soma = valores[0];
  for (let i = 1; i < valores.length; i += 1) soma += valores[i] * i;
  valores.push(soma % 103);
  valores.push(CODE128_PARADA);

  return {
    simbologia: 'code128',
    modulos: valores.map((valor) => larguraParaModulos(CODE128[valor])).join(''),
    legenda: texto,
    silencio: 10,
  };
}

// ------------------------------------------------------------- Code 39 ---

/**
 * As letras do Code 39, em nove elementos cada.
 *
 * `n` é estreito e `w` é largo, começando por barra e alternando. Toda letra
 * tem exatamente três elementos largos — daí o nome "3 de 9".
 */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

/**
 * Quantas vezes o largo é maior que o estreito.
 *
 * A norma aceita de 2 para 1 até 3 para 1. Impresso em papel, 3 para 1 lê
 * muito melhor: a tinta espalha um pouco no papel e engorda a barra, e a
 * diferença de 2 para 1 é a primeira a sumir.
 */
const RAZAO_CODE39 = 3;

function code39(entrada: string): CodigoDeBarras {
  const texto = entrada.toUpperCase().trim();
  if (!texto) throw new Error('Escreva o que vai dentro do código.');

  const desconhecido = [...texto].find((letra) => !(letra in CODE39) || letra === '*');
  if (desconhecido) {
    throw new Error(
      `O Code 39 não aceita "${desconhecido}". Ele grava A-Z, 0-9, espaço e os sinais - . $ / + %.`,
    );
  }

  // O asterisco delimita o código dos dois lados. Não é conteúdo: é o que
  // diz ao leitor onde começa e onde termina.
  const letras = ['*', ...texto, '*'];
  const partes = letras.map((letra) =>
    [...CODE39[letra]]
      .map((elemento, i) => (i % 2 === 0 ? '1' : '0').repeat(elemento === 'w' ? RAZAO_CODE39 : 1))
      .join(''),
  );

  // Entre uma letra e outra vai um espaço estreito.
  return {
    simbologia: 'code39',
    modulos: partes.join('0'),
    legenda: texto,
    silencio: 10,
    razao: RAZAO_CODE39,
  };
}

// ----------------------------------------------------------------- ITF ---

/** Cinco elementos por dígito, dois deles largos. */
const ITF: string[] = [
  'nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw',
  'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn',
];

const RAZAO_ITF = 3;

/**
 * Intercalado 2 de 5: dois dígitos ocupam o mesmo espaço.
 *
 * O primeiro dígito do par vira as barras e o segundo vira os espaços entre
 * elas. É o que torna o ITF o código mais compacto que existe para número
 * puro — e o motivo de ele só aceitar quantidade par de dígitos.
 */
function itf(entrada: string): CodigoDeBarras {
  let digitos = somenteDigitos(entrada);
  if (!digitos) throw new Error('O ITF só grava números.');

  // ITF-14 tem verificador. Com 13 dígitos o mais provável é que a pessoa
  // tenha o código da caixa sem o último dígito, então ele é calculado.
  if (digitos.length === 13) digitos += digitoEan(digitos);
  if (digitos.length % 2 !== 0) {
    throw new Error(
      `O ITF grava os dígitos aos pares, então precisa de quantidade par. Vieram ${digitos.length}. ` +
        'Um zero na frente resolve.',
    );
  }

  const largo = (escura: boolean, elemento: string) =>
    (escura ? '1' : '0').repeat(elemento === 'w' ? RAZAO_ITF : 1);

  let modulos = '1010'; // início: barra, espaço, barra, espaço, todos estreitos
  for (let i = 0; i < digitos.length; i += 2) {
    const barras = ITF[Number(digitos[i])];
    const espacos = ITF[Number(digitos[i + 1])];
    for (let e = 0; e < 5; e += 1) {
      modulos += largo(true, barras[e]);
      modulos += largo(false, espacos[e]);
    }
  }
  modulos += `${'1'.repeat(RAZAO_ITF)}01`; // parada: barra larga, espaço estreito, barra estreita

  return { simbologia: 'itf', modulos, legenda: digitos, silencio: 10, razao: RAZAO_ITF };
}

// --------------------------------------------------------------- porta ---

export function gerarCodigo(simbologia: Simbologia, conteudo: string): CodigoDeBarras {
  switch (simbologia) {
    case 'ean13':
      return ean13(conteudo);
    case 'ean8':
      return ean8(conteudo);
    case 'code39':
      return code39(conteudo);
    case 'itf':
      return itf(conteudo);
    default:
      return code128(conteudo);
  }
}

export function simbologiaValida(valor: unknown): Simbologia {
  const texto = String(valor ?? 'code128');
  return texto in SIMBOLOGIAS ? (texto as Simbologia) : 'code128';
}

/** Os módulos viram faixas, para desenhar retângulo em vez de pixel a pixel. */
export function faixasEscuras(modulos: string): { inicio: number; largura: number }[] {
  const faixas: { inicio: number; largura: number }[] = [];
  let i = 0;
  while (i < modulos.length) {
    if (modulos[i] === '0') {
      i += 1;
      continue;
    }
    const inicio = i;
    while (i < modulos.length && modulos[i] === '1') i += 1;
    faixas.push({ inicio, largura: i - inicio });
  }
  return faixas;
}

/**
 * Onde as barras do EAN descem além da legenda.
 *
 * As barras de início, meio e fim são mais compridas de propósito: é o que
 * separa visualmente os grupos de dígitos e dá ao leitor a referência de
 * altura. Fora do EAN não existe essa distinção.
 */
export function barrasCompridas(simbologia: Simbologia, total: number): (inicio: number) => boolean {
  if (simbologia === 'ean13') {
    return (inicio) => inicio < 3 || (inicio >= 45 && inicio < 50) || inicio >= total - 3;
  }
  if (simbologia === 'ean8') {
    return (inicio) => inicio < 3 || (inicio >= 31 && inicio < 36) || inicio >= total - 3;
  }
  return () => false;
}
