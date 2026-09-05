/**
 * Código de barras de boleto: ler, conferir e converter.
 *
 * Tudo aqui é aritmética em cima dos 44 dígitos — nada consulta banco nem
 * internet, porque **a informação já está dentro do próprio código**. Valor,
 * vencimento e banco estão escritos ali; o que não está (nome do sacado, o
 * que foi comprado) não existe no código e nenhuma ferramenta honesta
 * inventa.
 *
 * Dois padrões, e eles não se misturam:
 * - **Bancário** (conta de água virou boleto, duplicata, mensalidade): 44
 *   dígitos, linha digitável de 47.
 * - **Arrecadação** (concessionária, tributo, FGTS): começa com 8, 44
 *   dígitos, linha digitável de 48 em quatro blocos.
 */

export type TipoDeCodigo = 'bancario' | 'arrecadacao';

export type Leitura = {
  tipo: TipoDeCodigo;
  /** Os 44 dígitos, sempre. */
  codigo: string;
  /** 47 dígitos no bancário, 48 na arrecadação. */
  linha: string;
  /** Todos os dígitos verificadores conferem? */
  valido: boolean;
  /** O que não bateu, para a pessoa saber onde olhar. */
  problemas: string[];
  banco?: { codigo: string; nome: string };
  moeda?: string;
  /** Em reais. Zero quer dizer "o valor não vem no código". */
  valor: number;
  /** ISO, ou nulo quando o código não traz vencimento. */
  vencimento: string | null;
  fator?: number;
  segmento?: string;
};

/** Os bancos que mais aparecem no balcão. */
const BANCOS: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '070': 'BRB',
  '077': 'Banco Inter',
  '104': 'Caixa Econômica Federal',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nu Pagamentos',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '356': 'Banco Real',
  '389': 'Mercantil do Brasil',
  '399': 'HSBC',
  '422': 'Safra',
  '453': 'Banco Rural',
  '633': 'Rendimento',
  '652': 'Itaú Unibanco',
  '655': 'Votorantim',
  '745': 'Citibank',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

/** Os segmentos da arrecadação, pelo segundo dígito. */
const SEGMENTOS: Record<string, string> = {
  '1': 'Prefeitura',
  '2': 'Saneamento',
  '3': 'Energia elétrica ou gás',
  '4': 'Telecomunicações',
  '5': 'Órgão do governo',
  '6': 'Carnê ou assemelhado',
  '7': 'Multa de trânsito',
  '9': 'Uso exclusivo do banco',
};

export function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '');
}

/**
 * Dígito verificador módulo 10.
 *
 * Da direita para a esquerda, alterna peso 2 e 1. Produto acima de 9 tem os
 * algarismos somados — 14 vira 5 — e é justamente esse detalhe que a maioria
 * das implementações erradas esquece.
 */
export function mod10(bloco: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = bloco.length - 1; i >= 0; i -= 1) {
    const produto = Number(bloco[i]) * peso;
    soma += produto > 9 ? produto - 9 : produto;
    peso = peso === 2 ? 1 : 2;
  }

  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * Dígito verificador módulo 11 do boleto bancário.
 *
 * Pesos de 2 a 9, girando da direita para a esquerda. Resultado 0, 10 ou 11
 * vira 1 — é a regra da FEBRABAN, e não um arredondamento nosso.
 */
export function mod11Bancario(quarentaETres: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = quarentaETres.length - 1; i >= 0; i -= 1) {
    soma += Number(quarentaETres[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação, que tem regra própria para os restos 0 e 1. */
export function mod11Arrecadacao(bloco: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = bloco.length - 1; i >= 0; i -= 1) {
    soma += Number(bloco[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  if (resto === 0) return 0;
  if (resto === 1) return 0;
  return 11 - resto;
}

export function tipoDoCodigo(digitos: string): TipoDeCodigo {
  return digitos.startsWith('8') ? 'arrecadacao' : 'bancario';
}

// ------------------------------------------------------------ vencimento ---

/**
 * O fator de vencimento vira data.
 *
 * São dias contados desde 07/10/1997, que é o fator 1000. Em 21/02/2025 a
 * conta chegou em 9999 e a FEBRABAN reiniciou: a partir de 22/02/2025 o fator
 * 1000 vale de novo, agora contando dessa data.
 *
 * Isso quer dizer que um mesmo fator aponta para duas datas possíveis. Como
 * boleto do ciclo antigo já venceu há anos, o ciclo novo é o que responde —
 * mas a ferramenta diz qual dos dois usou, em vez de esconder a escolha.
 */
const BASE_ANTIGA = Date.UTC(1997, 9, 7);
const BASE_NOVA = Date.UTC(2025, 1, 22);
const UM_DIA = 86_400_000;

export function dataDoFator(fator: number, hoje = new Date()): { iso: string; ciclo: 'antigo' | 'novo' } | null {
  if (!Number.isFinite(fator) || fator < 1000 || fator > 9999) return null;

  const antiga = BASE_ANTIGA + (fator - 1000) * UM_DIA;
  const nova = BASE_NOVA + (fator - 1000) * UM_DIA;

  // Antes da virada só existia um ciclo, e não há o que escolher.
  if (hoje.getTime() < BASE_NOVA) {
    return { iso: new Date(antiga).toISOString().slice(0, 10), ciclo: 'antigo' };
  }

  // Depois dela, o mesmo fator aponta para duas datas — e a escolha não pode
  // ser "sempre a nova". O fator 8441 dá 2020 no ciclo antigo e 2045 no
  // novo: um boleto vencido há anos, ou um que vence daqui a vinte. A data
  // mais perto de hoje é a que corresponde a um boleto de verdade.
  const distancia = (quando: number) => Math.abs(quando - hoje.getTime());
  return distancia(antiga) <= distancia(nova)
    ? { iso: new Date(antiga).toISOString().slice(0, 10), ciclo: 'antigo' }
    : { iso: new Date(nova).toISOString().slice(0, 10), ciclo: 'novo' };
}

export function fatorDaData(iso: string): number | null {
  const alvo = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(alvo)) return null;
  const fator = Math.round((alvo - BASE_NOVA) / UM_DIA) + 1000;
  return fator >= 1000 && fator <= 9999 ? fator : null;
}

// ------------------------------------------------- código <-> linha digitável ---

/** Dos 44 dígitos para a linha que se digita no caixa eletrônico. */
export function codigoParaLinha(codigo: string): string {
  const digitos = somenteDigitos(codigo);
  if (digitos.length !== 44) throw new Error('O código de barras tem que ter 44 dígitos.');

  if (tipoDoCodigo(digitos) === 'arrecadacao') {
    // Quatro blocos de 11, cada um com o seu dígito. Qual módulo usar vem do
    // terceiro dígito: 6 e 7 usam módulo 10; 8 e 9, módulo 11.
    const porDez = digitos[2] === '6' || digitos[2] === '7';
    let linha = '';
    for (let i = 0; i < 4; i += 1) {
      const bloco = digitos.slice(i * 11, i * 11 + 11);
      linha += bloco + (porDez ? mod10(bloco) : mod11Arrecadacao(bloco));
    }
    return linha;
  }

  const campo1 = digitos.slice(0, 4) + digitos.slice(19, 24);
  const campo2 = digitos.slice(24, 34);
  const campo3 = digitos.slice(34, 44);

  return (
    campo1 +
    mod10(campo1) +
    campo2 +
    mod10(campo2) +
    campo3 +
    mod10(campo3) +
    digitos[4] +
    digitos.slice(5, 19)
  );
}

/** O caminho de volta: da linha digitável para os 44 dígitos. */
export function linhaParaCodigo(linha: string): string {
  const digitos = somenteDigitos(linha);

  if (digitos.length === 48) {
    // Tira o dígito do fim de cada bloco de 12.
    let codigo = '';
    for (let i = 0; i < 4; i += 1) codigo += digitos.slice(i * 12, i * 12 + 11);
    return codigo;
  }

  if (digitos.length !== 47) {
    throw new Error('A linha digitável tem 47 dígitos (banco) ou 48 (concessionária).');
  }

  const campo1 = digitos.slice(0, 9);
  const campo2 = digitos.slice(10, 20);
  const campo3 = digitos.slice(21, 31);
  const dvGeral = digitos[32];
  const fatorEValor = digitos.slice(33, 47);

  return campo1.slice(0, 4) + dvGeral + fatorEValor + campo1.slice(4) + campo2 + campo3;
}

// ------------------------------------------------------------------ ler ---

/** Aceita o código de barras ou a linha digitável, com ou sem pontuação. */
export function lerBoleto(entrada: string, hoje = new Date()): Leitura {
  const digitos = somenteDigitos(entrada);
  if (digitos.length !== 44 && digitos.length !== 47 && digitos.length !== 48) {
    throw new Error(
      `Contei ${digitos.length} dígitos. O código de barras tem 44; a linha digitável, 47 (banco) ou 48 (concessionária).`,
    );
  }

  const codigo = digitos.length === 44 ? digitos : linhaParaCodigo(digitos);
  const tipo = tipoDoCodigo(codigo);
  const problemas: string[] = [];

  if (tipo === 'arrecadacao') {
    const porDez = codigo[2] === '6' || codigo[2] === '7';
    const semDv = codigo.slice(0, 3) + codigo.slice(4);
    const esperado = porDez ? mod10(semDv) : mod11Arrecadacao(semDv);
    if (String(esperado) !== codigo[3]) {
      problemas.push(`O dígito verificador geral deveria ser ${esperado}, e está ${codigo[3]}.`);
    }

    // Nos códigos de valor 6 e 8 o valor é em reais; em 7 e 9 é referência,
    // e aí o campo não é dinheiro — dizer "R$ 0,00" seria mentira.
    const temValor = codigo[2] === '6' || codigo[2] === '8';
    return {
      tipo,
      codigo,
      linha: codigoParaLinha(codigo),
      valido: problemas.length === 0,
      problemas,
      segmento: SEGMENTOS[codigo[1]] ?? 'Não identificado',
      valor: temValor ? Number(codigo.slice(4, 15)) / 100 : 0,
      vencimento: null,
    };
  }

  const semDv = codigo.slice(0, 4) + codigo.slice(5);
  const esperado = mod11Bancario(semDv);
  if (String(esperado) !== codigo[4]) {
    problemas.push(`O dígito verificador geral deveria ser ${esperado}, e está ${codigo[4]}.`);
  }

  const fator = Number(codigo.slice(5, 9));
  const data = dataDoFator(fator, hoje);
  const moeda = codigo[3];
  if (moeda !== '9') {
    problemas.push(`O código de moeda deveria ser 9 (real), e está ${moeda}.`);
  }

  return {
    tipo,
    codigo,
    linha: codigoParaLinha(codigo),
    valido: problemas.length === 0,
    problemas,
    banco: { codigo: codigo.slice(0, 3), nome: BANCOS[codigo.slice(0, 3)] ?? 'Banco não identificado' },
    moeda: moeda === '9' ? 'Real' : moeda,
    valor: Number(codigo.slice(9, 19)) / 100,
    vencimento: data?.iso ?? null,
    fator,
  };
}

/** A linha digitável com a pontuação que aparece impressa no boleto. */
export function formatarLinha(linha: string): string {
  const digitos = somenteDigitos(linha);

  if (digitos.length === 48) {
    return [0, 1, 2, 3].map((i) => `${digitos.slice(i * 12, i * 12 + 11)}-${digitos[i * 12 + 11]}`).join(' ');
  }
  if (digitos.length !== 47) return digitos;

  return (
    `${digitos.slice(0, 5)}.${digitos.slice(5, 10)} ` +
    `${digitos.slice(10, 15)}.${digitos.slice(15, 21)} ` +
    `${digitos.slice(21, 26)}.${digitos.slice(26, 32)} ` +
    `${digitos[32]} ${digitos.slice(33)}`
  );
}

export function emReais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
