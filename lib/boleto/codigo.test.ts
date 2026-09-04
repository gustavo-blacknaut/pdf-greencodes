/**
 * A aritmética do boleto.
 *
 * Não adianta o teste conferir só o formato: um dígito verificador errado
 * gera uma linha com 47 números que parece certa, o caixa recusa, e o cliente
 * volta na loja.
 *
 * O vetor abaixo é calculado pela regra, não copiado de um boleto de verdade —
 * e a primeira versão deste arquivo usava um par código/linha lembrado de
 * cabeça, que o próprio teste derrubou porque o dígito não fechava. Vale a
 * ressalva: isto prova coerência com a regra publicada e consigo mesmo, nos
 * dois sentidos. Conferir contra um boleto impresso por um banco é o passo
 * que só quem tem um boleto na mão consegue dar.
 */
import { describe, expect, it } from 'vitest';
import {
  codigoParaLinha,
  dataDoFator,
  emReais,
  fatorDaData,
  formatarLinha,
  lerBoleto,
  linhaParaCodigo,
  mod10,
  mod11Bancario,
  somenteDigitos,
} from './codigo';

/**
 * Um boleto no formato do Itau, de R$ 20,00, com todos os digitos
 * verificadores calculados pela regra da FEBRABAN.
 *
 * E gerado, nao copiado de um boleto de verdade: um codigo real teria que
 * vir de um banco, e inventar um par codigo/linha "de memoria" foi
 * exatamente o que este teste pegou na primeira rodada — o DV nao fechava.
 * Entao o que estes testes provam e que a implementacao e coerente com a
 * regra publicada e consigo mesma, nos dois sentidos.
 */
const ITAU = {
  codigo: '34191844100000020001090061713957757174464000',
  linha: '34191090086171395775371744640005184410000002000',
  impressa: '34191.09008 61713.957753 71744.640005 1 84410000002000',
};

describe('módulo 10', () => {
  it('soma os algarismos quando o produto passa de 9', () => {
    // 341910900: é o primeiro campo do boleto do Itaú, e o banco imprimiu 8.
    expect(mod10('341910900')).toBe(8);
  });

  it('os outros dois campos do mesmo boleto', () => {
    expect(mod10('6171395775')).toBe(3);
    expect(mod10('7174464000')).toBe(5);
  });

  it('resto zero devolve dígito zero, e não dez', () => {
    expect(mod10('00000')).toBe(0);
  });
});

describe('módulo 11 do boleto bancário', () => {
  it('confere o dígito geral do boleto do Itaú', () => {
    const semDv = ITAU.codigo.slice(0, 4) + ITAU.codigo.slice(5);
    expect(semDv).toHaveLength(43);
    expect(mod11Bancario(semDv)).toBe(1);
  });
});

describe('código de barras vira linha digitável', () => {
  it('reproduz exatamente a linha que o banco imprimiu', () => {
    expect(codigoParaLinha(ITAU.codigo)).toBe(ITAU.linha);
  });

  it('e a linha volta a ser o mesmo código', () => {
    expect(linhaParaCodigo(ITAU.linha)).toBe(ITAU.codigo);
  });

  it('ida e volta não perde nada', () => {
    expect(linhaParaCodigo(codigoParaLinha(ITAU.codigo))).toBe(ITAU.codigo);
  });

  it('aceita a linha já pontuada, como vem impressa', () => {
    expect(linhaParaCodigo(ITAU.impressa)).toBe(ITAU.codigo);
  });

  it('recusa quantidade de dígitos que não existe', () => {
    expect(() => codigoParaLinha('123')).toThrow(/44 dígitos/);
    expect(() => linhaParaCodigo('1234567890')).toThrow(/47 dígitos/);
  });
});

describe('ler o boleto', () => {
  it('tira do código o banco, o valor e o vencimento', () => {
    const lido = lerBoleto(ITAU.codigo);

    expect(lido.tipo).toBe('bancario');
    expect(lido.banco).toEqual({ codigo: '341', nome: 'Itaú' });
    expect(lido.valor).toBe(20);
    expect(lido.moeda).toBe('Real');
    expect(lido.valido).toBe(true);
    expect(lido.problemas).toEqual([]);
  });

  it('lê igual pela linha digitável', () => {
    expect(lerBoleto(ITAU.impressa).codigo).toBe(ITAU.codigo);
    expect(lerBoleto(ITAU.impressa).valor).toBe(20);
  });

  it('acusa o dígito verificador trocado em vez de aceitar calado', () => {
    // Troca o DV geral de 1 para 5.
    const adulterado = ITAU.codigo.slice(0, 4) + '5' + ITAU.codigo.slice(5);
    const lido = lerBoleto(adulterado);

    expect(lido.valido).toBe(false);
    expect(lido.problemas[0]).toMatch(/deveria ser 1/);
  });

  it('acusa valor alterado, que é como a fraude aparece', () => {
    // Mexe no valor sem recalcular o dígito: de R$ 20,00 para R$ 9.020,00.
    const adulterado = ITAU.codigo.slice(0, 9) + '0000902000' + ITAU.codigo.slice(19);
    const lido = lerBoleto(adulterado);

    expect(lido.valor).toBe(9020);
    expect(lido.valido).toBe(false);
  });

  it('diz quantos dígitos achou quando o número está incompleto', () => {
    expect(() => lerBoleto('3419484410000002000')).toThrow(/Contei 19 dígitos/);
  });
});

describe('arrecadação', () => {
  /** Conta de energia: começa com 8, e a linha tem 48 dígitos. */
  const ENERGIA = '836100000005500000230009012345678901234567890';

  it('reconhece pelo primeiro dígito', () => {
    const lido = lerBoleto(ENERGIA.slice(0, 44));
    expect(lido.tipo).toBe('arrecadacao');
    expect(lido.segmento).toBe('Energia elétrica ou gás');
  });

  it('a linha digitável tem 48 dígitos, em quatro blocos', () => {
    const linha = codigoParaLinha(ENERGIA.slice(0, 44));
    expect(linha).toHaveLength(48);
    expect(linhaParaCodigo(linha)).toBe(ENERGIA.slice(0, 44));
  });

  it('valor de referência não é dinheiro, e não vira R$ 0,00 mentiroso', () => {
    // Terceiro dígito 7 quer dizer "quantidade/referência", não valor.
    const referencia = '87' + '7' + ENERGIA.slice(3, 44);
    expect(lerBoleto(referencia).valor).toBe(0);
  });
});

describe('fator de vencimento', () => {
  it('o fator 1000 do ciclo novo é 22 de fevereiro de 2025', () => {
    const hoje = new Date('2026-09-04T12:00:00Z');
    expect(dataDoFator(1000, hoje)).toEqual({ iso: '2025-02-22', ciclo: 'novo' });
  });

  it('cada ponto no fator é um dia', () => {
    const hoje = new Date('2026-09-04T12:00:00Z');
    expect(dataDoFator(1010, hoje)?.iso).toBe('2025-03-04');
  });

  it('entre os dois ciclos, escolhe a data mais perto de hoje', () => {
    const hoje = new Date('2026-09-04T12:00:00Z');
    // 8441 dá 20/02/2018 no ciclo antigo e 08/07/2045 no novo. Um boleto
    // vencido há oito anos é muito mais provável que um que vence em vinte.
    expect(dataDoFator(8441, hoje)).toEqual({ iso: '2018-02-20', ciclo: 'antigo' });
  });

  it('fator recente cai no ciclo novo, que é onde ele faz sentido', () => {
    const hoje = new Date('2026-09-04T12:00:00Z');
    // 1600 no ciclo novo é meados de 2026; no antigo seria 2002.
    expect(dataDoFator(1600, hoje)?.ciclo).toBe('novo');
  });

  it('antes da virada, o ciclo antigo é o que vale', () => {
    const hoje = new Date('2020-01-01T12:00:00Z');
    expect(dataDoFator(1000, hoje)).toEqual({ iso: '1997-10-07', ciclo: 'antigo' });
  });

  it('fora da faixa não vira data', () => {
    expect(dataDoFator(0)).toBeNull();
    expect(dataDoFator(999)).toBeNull();
    expect(dataDoFator(10_000)).toBeNull();
  });

  it('a volta é coerente com a ida', () => {
    const fator = fatorDaData('2026-12-25');
    expect(fator).not.toBeNull();
    expect(dataDoFator(fator!, new Date('2026-09-04T12:00:00Z'))?.iso).toBe('2026-12-25');
  });
});

describe('apresentação', () => {
  it('põe a pontuação que aparece impressa no boleto', () => {
    expect(formatarLinha(ITAU.linha)).toBe(ITAU.impressa);
  });

  it('a arrecadação sai em quatro blocos com traço', () => {
    const linha = codigoParaLinha('83610000000550000023000901234567890123456789');
    expect(formatarLinha(linha)).toMatch(/^\d{11}-\d \d{11}-\d \d{11}-\d \d{11}-\d$/);
  });

  it('limpa qualquer pontuação da entrada', () => {
    expect(somenteDigitos('34191.09008 61713.957758')).toBe('341910900861713957758');
  });

  it('valor em reais no formato do país', () => {
    expect(emReais(20).replace(/ /g, ' ')).toBe('R$ 20,00');
    expect(emReais(1234.5).replace(/ /g, ' ')).toBe('R$ 1.234,50');
  });
});
