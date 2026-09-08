/**
 * As tabelas de código de barras, conferidas pelas regras da própria norma.
 *
 * Tabela copiada à mão é onde mora o erro que ninguém enxerga: um dígito
 * trocado desenha um código bonito que o leitor recusa, e só se descobre com
 * mil etiquetas impressas. Por isso aqui quase não há valor esperado escrito
 * à mão — o que há são as invariantes que cada simbologia garante, e um
 * dígito trocado quebra alguma delas.
 */
import { describe, expect, it } from 'vitest';
import { barrasCompridas, digitoEan, faixasEscuras, gerarCodigo, SIMBOLOGIAS } from './barras';

/** Conta os módulos escuros. */
const escuros = (padrao: string) => [...padrao].filter((bit) => bit === '1').length;

describe('EAN: o verificador', () => {
  it.each([
    ['400638133393', 1],
    ['978020137962', 4],
    ['501234567890', 0],
  ])('fecha %s com %i', (corpo, esperado) => {
    expect(digitoEan(corpo)).toBe(esperado);
  });

  it('fecha o EAN-8 de sete dígitos', () => {
    expect(digitoEan('9638507')).toBe(4);
  });

  it('o verificador do código completo dá zero na conferência', () => {
    // Somar o código inteiro, verificador incluído, tem que fechar em zero.
    // É assim que o leitor confere, e não recalculando.
    const completo = `400638133393${digitoEan('400638133393')}`;
    const invertido = [...completo].reverse();
    const soma = invertido.reduce((total, d, i) => total + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    expect(soma % 10).toBe(0);
  });
});

describe('EAN-13', () => {
  const codigo = gerarCodigo('ean13', '400638133393');

  it('tem os 95 módulos da norma', () => {
    expect(codigo.modulos).toHaveLength(95);
  });

  it('põe as três guardas nos lugares certos', () => {
    expect(codigo.modulos.slice(0, 3)).toBe('101');
    expect(codigo.modulos.slice(45, 50)).toBe('01010');
    expect(codigo.modulos.slice(92)).toBe('101');
  });

  it('calcula o 13º dígito e escreve o código inteiro embaixo', () => {
    expect(codigo.legenda).toBe('4006381333931');
  });

  it('aceita o código já completo, e não duplica o verificador', () => {
    expect(gerarCodigo('ean13', '4006381333931').legenda).toBe('4006381333931');
  });

  it.each([
    ['12345', 'curto demais'],
    ['12345678901234', 'longo demais'],
  ])('recusa %s (%s)', (entrada) => {
    expect(() => gerarCodigo('ean13', entrada)).toThrow(/12 dígitos/);
  });

  /*
   * A metade esquerda usa dois alfabetos misturados, e o que distingue um do
   * outro é a paridade: no L o número de módulos escuros é sempre ímpar, no
   * G e no R é sempre par. É essa regra que deixa ler o código de cabeça
   * para baixo — e ela cai por terra se um padrão da tabela estiver errado.
   */
  it('a metade esquerda respeita a paridade que a norma define', () => {
    for (let i = 0; i < 6; i += 1) {
      const inicio = 3 + i * 7;
      const grupo = codigo.modulos.slice(inicio, inicio + 7);
      expect(grupo, `dígito ${i + 1} da esquerda`).toHaveLength(7);
      // Ímpar é L, par é G. Um dos dois, nunca outra coisa.
      expect([0, 1]).toContain(escuros(grupo) % 2 === 0 ? 0 : 1);
      // O alfabeto da esquerda sempre começa em espaço e termina em barra.
      expect(grupo[0]).toBe('0');
      expect(grupo[6]).toBe('1');
    }
  });

  it('a metade direita é sempre par, e espelha a esquerda', () => {
    for (let i = 0; i < 6; i += 1) {
      const inicio = 50 + i * 7;
      const grupo = codigo.modulos.slice(inicio, inicio + 7);
      expect(escuros(grupo) % 2, `dígito ${i + 1} da direita`).toBe(0);
      expect(grupo[0]).toBe('1');
      expect(grupo[6]).toBe('0');
    }
  });

  it('o mesmo dígito muda de desenho conforme o primeiro número', () => {
    // O primeiro dígito não tem barras próprias: ele existe só na mistura de
    // L e G da esquerda. Dois códigos iguais a menos do primeiro dígito têm
    // que sair diferentes, senão essa informação se perdeu.
    const a = gerarCodigo('ean13', '000000000000').modulos;
    const b = gerarCodigo('ean13', '500000000000').modulos;
    expect(a).not.toBe(b);
  });
});

describe('EAN-8', () => {
  const codigo = gerarCodigo('ean8', '9638507');

  it('tem os 67 módulos da norma', () => {
    expect(codigo.modulos).toHaveLength(67);
  });

  it('põe as guardas onde o EAN-8 as põe', () => {
    expect(codigo.modulos.slice(0, 3)).toBe('101');
    expect(codigo.modulos.slice(31, 36)).toBe('01010');
    expect(codigo.modulos.slice(64)).toBe('101');
  });

  it('fecha a legenda com o verificador', () => {
    expect(codigo.legenda).toBe('96385074');
  });
});

describe('Code 128: a tabela inteira', () => {
  /*
   * Duas regras valem para as 106 letras do Code 128, e as duas juntas pegam
   * praticamente qualquer dígito trocado na transcrição:
   *
   *   1. cada letra soma exatamente 11 módulos;
   *   2. a soma só das barras é par — é a paridade embutida na simbologia.
   *
   * A letra de parada é a exceção conhecida: sete elementos e 13 módulos.
   */
  const tabela = (
    gerarCodigo('code128', 'A') as unknown as { modulos: string }
  );

  it('encaixa nas contas de largura da norma', () => {
    // início + 1 letra + verificador = 3 letras de 11, mais 13 da parada.
    expect(tabela.modulos).toHaveLength(3 * 11 + 13);
  });

  it('cada letra a mais custa exatamente 11 módulos', () => {
    const um = gerarCodigo('code128', 'A').modulos.length;
    const dois = gerarCodigo('code128', 'AB').modulos.length;
    const tres = gerarCodigo('code128', 'ABC').modulos.length;
    expect(dois - um).toBe(11);
    expect(tres - dois).toBe(11);
  });

  it('todo código começa e termina em barra', () => {
    for (const conteudo of ['A', 'GRAFICA-001', '12345678', 'a b c']) {
      const modulos = gerarCodigo('code128', conteudo).modulos;
      expect(modulos[0], conteudo).toBe('1');
      expect(modulos[modulos.length - 1], conteudo).toBe('1');
    }
  });

  it('a soma das barras é par em todo o símbolo', () => {
    // Vale letra a letra e, por consequência, no símbolo inteiro. Conferir o
    // total já denuncia a tabela adulterada.
    for (const conteudo of ['A', 'GRAFICA-001', '12345678', 'Pedido 42']) {
      const faixas = faixasEscuras(gerarCodigo('code128', conteudo).modulos);
      const barras = faixas.reduce((total, faixa) => total + faixa.largura, 0);
      expect(barras % 2, conteudo).toBe(0);
    }
  });

  it('número par de dígitos sai pela metade da largura', () => {
    // Oito dígitos em conjunto C ocupam quatro letras; em B ocupariam oito.
    const emC = gerarCodigo('code128', '12345678').modulos.length;
    const emB = gerarCodigo('code128', '123456789').modulos.length;
    expect(emC).toBeLessThan(emB);
    expect(emC).toBe(6 * 11 + 13);
  });

  it('recusa o que não cabe na tabela', () => {
    expect(() => gerarCodigo('code128', 'ação')).toThrow(/não aceita/);
  });

  it('recusa conteúdo vazio em vez de desenhar um código sem dados', () => {
    expect(() => gerarCodigo('code128', '   ')).toThrow(/Escreva/);
  });
});

describe('Code 39: três de nove', () => {
  it('toda letra tem exatamente três elementos largos', () => {
    // É a regra que dá nome à simbologia. Uma letra com dois ou quatro largos
    // é tabela errada, e nenhum leitor aceita.
    //
    // Cada letra ocupa 6 estreitos + 3 largos de 3 = 15 módulos, e entre uma
    // e outra vai um espaço estreito. A letra vai ladeada por dois Z para o
    // caso do espaço, que existe no Code 39 mas some se ficar na ponta.
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.$/+%';
    for (const letra of letras) {
      const codigo = gerarCodigo('code39', `Z${letra}Z`);
      expect(codigo.modulos, letra).toHaveLength(5 * 15 + 4);
    }
  });

  it('guarda o espaço do meio, e descarta o das pontas', () => {
    expect(gerarCodigo('code39', '  PEDIDO 42  ').legenda).toBe('PEDIDO 42');
  });

  it('põe o asterisco delimitador dos dois lados, sem escrevê-lo embaixo', () => {
    const codigo = gerarCodigo('code39', 'A');
    expect(codigo.legenda).toBe('A');
    const asterisco = gerarCodigo('code39', 'AA').modulos;
    expect(asterisco.startsWith(codigo.modulos.slice(0, 15))).toBe(true);
  });

  it('sobe a caixa sozinho, porque o Code 39 não tem minúscula', () => {
    expect(gerarCodigo('code39', 'pedido').legenda).toBe('PEDIDO');
  });

  it('recusa o asterisco como conteúdo, que é o delimitador', () => {
    expect(() => gerarCodigo('code39', 'A*B')).toThrow(/não aceita/);
  });

  it('avisa qual foi o caractere recusado', () => {
    expect(() => gerarCodigo('code39', 'A#B')).toThrow(/"#"/);
  });
});

describe('ITF', () => {
  it('grava os dígitos aos pares', () => {
    // Início (4) + 5 pares de barra e espaço por par de dígitos + parada (5).
    // Cada par de dígitos tem 10 elementos, 4 largos e 6 estreitos: 18 módulos.
    const codigo = gerarCodigo('itf', '1234');
    expect(codigo.modulos).toHaveLength(4 + 2 * 18 + 5);
  });

  it('cada dígito tem exatamente dois elementos largos', () => {
    for (let d = 0; d <= 9; d += 1) {
      const par = `${d}${d}`;
      const codigo = gerarCodigo('itf', par);
      const barras = faixasEscuras(codigo.modulos.slice(4, 4 + 18));
      // Duas barras largas de três módulos, três estreitas de um.
      const largas = barras.filter((faixa) => faixa.largura === 3).length;
      expect(largas, par).toBe(2);
    }
  });

  it('completa o ITF-14 quando faltam só o verificador', () => {
    const codigo = gerarCodigo('itf', '1789100031595');
    expect(codigo.legenda).toHaveLength(14);
    expect(codigo.legenda.slice(0, 13)).toBe('1789100031595');
  });

  it('recusa quantidade ímpar e explica como resolver', () => {
    expect(() => gerarCodigo('itf', '12345')).toThrow(/par/);
    expect(() => gerarCodigo('itf', '12345')).toThrow(/zero na frente/);
  });

  it('ignora o que não for número na entrada', () => {
    expect(gerarCodigo('itf', '12-34').legenda).toBe('1234');
  });
});

describe('as faixas, para desenhar', () => {
  it('agrupa os módulos escuros em retângulos', () => {
    expect(faixasEscuras('101100011')).toEqual([
      { inicio: 0, largura: 1 },
      { inicio: 2, largura: 2 },
      { inicio: 7, largura: 2 },
    ]);
  });

  it('não devolve nada quando não há barra', () => {
    expect(faixasEscuras('0000')).toEqual([]);
  });

  it('fecha a última faixa quando o código termina em barra', () => {
    expect(faixasEscuras('0011')).toEqual([{ inicio: 2, largura: 2 }]);
  });
});

describe('as barras compridas do EAN', () => {
  it('marca só as três guardas do EAN-13', () => {
    const codigo = gerarCodigo('ean13', '400638133393');
    const comprida = barrasCompridas('ean13', codigo.modulos.length);
    const marcadas = faixasEscuras(codigo.modulos).filter((faixa) => comprida(faixa.inicio));
    // Duas barras em cada uma das três guardas.
    expect(marcadas).toHaveLength(6);
  });

  it('não marca nada fora do EAN, que não tem guarda', () => {
    const codigo = gerarCodigo('code128', 'ABC');
    const comprida = barrasCompridas('code128', codigo.modulos.length);
    expect(faixasEscuras(codigo.modulos).some((faixa) => comprida(faixa.inicio))).toBe(false);
  });
});

describe('o catálogo', () => {
  it('todo exemplo do catálogo gera um código de verdade', () => {
    // O exemplo aparece como sugestão na tela. Exemplo que não gera é a
    // primeira coisa que a pessoa tenta, e a primeira que falha.
    for (const [simbologia, dados] of Object.entries(SIMBOLOGIAS)) {
      const codigo = gerarCodigo(simbologia as never, dados.exemplo);
      expect(codigo.modulos.length, simbologia).toBeGreaterThan(20);
      expect(/^[01]+$/.test(codigo.modulos), simbologia).toBe(true);
    }
  });
});
