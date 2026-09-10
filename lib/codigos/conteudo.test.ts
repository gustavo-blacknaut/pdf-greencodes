/**
 * O que vai dentro do QR Code.
 *
 * Um QR guarda texto e mais nada; o que faz o celular abrir o WhatsApp em vez
 * de mostrar uma linha de letras é o formato desse texto. Errar o formato não
 * dá erro em lugar nenhum — dá um código bonito que não faz nada, e isso só
 * se descobre com o adesivo já colado na vitrine.
 *
 * O PIX é o mais delicado: tem norma do Banco Central, campos de tamanho
 * declarado e um verificador no fim. Verificador errado é código recusado
 * pelo banco, sem explicação na tela de ninguém.
 */
import { describe, expect, it } from 'vitest';
import {
  crc16,
  identificadorValido,
  montarConteudo,
  montarPix,
  normalizarValor,
  telefoneInternacional,
  TIPOS,
} from './conteudo';

describe('telefone', () => {
  it.each([
    ['31995998009', '5531995998009'],
    ['(31) 99599-8009', '5531995998009'],
    ['5531995998009', '5531995998009'],
    ['+55 31 99599-8009', '5531995998009'],
    ['3133334444', '553133334444'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(telefoneInternacional(entrada)).toBe(esperado);
  });

  it('recusa número curto, dizendo o que falta', () => {
    // Sem DDD o link abre uma conversa com um número que não existe, e o
    // erro só aparece quando alguém tenta usar.
    expect(() => telefoneInternacional('99998888')).toThrow(/DDD/);
  });

  it('recusa vazio', () => {
    expect(() => telefoneInternacional('')).toThrow(/Escreva o número/);
  });
});

describe('link', () => {
  it('põe https quando falta o protocolo', () => {
    // Sem protocolo, muito leitor trata como texto e não abre nada.
    expect(montarConteudo('link', { url: 'greencodes.com.br' })).toBe('https://greencodes.com.br');
  });

  it('não mexe no que já tem protocolo', () => {
    expect(montarConteudo('link', { url: 'http://exemplo.com' })).toBe('http://exemplo.com');
    expect(montarConteudo('link', { url: 'https://exemplo.com' })).toBe('https://exemplo.com');
  });

  it('recusa endereço vazio', () => {
    expect(() => montarConteudo('link', { url: '  ' })).toThrow(/endereço/);
  });
});

describe('whatsapp', () => {
  it('monta o link com país e DDD', () => {
    expect(montarConteudo('whatsapp', { numero: '(31) 99599-8009' })).toBe('https://wa.me/5531995998009');
  });

  it('leva a mensagem já digitada', () => {
    const saida = montarConteudo('whatsapp', { numero: '31995998009', mensagem: 'Olá, quero um orçamento' });
    expect(saida).toContain('?text=');
    expect(decodeURIComponent(saida.split('text=')[1])).toBe('Olá, quero um orçamento');
  });

  it('escapa o que quebraria o endereço', () => {
    const saida = montarConteudo('whatsapp', { numero: '31995998009', mensagem: 'preço & prazo?' });
    expect(saida).not.toContain('& prazo');
    expect(decodeURIComponent(saida.split('text=')[1])).toBe('preço & prazo?');
  });
});

describe('wi-fi', () => {
  it('monta a linha que o celular entende', () => {
    expect(montarConteudo('wifi', { rede: 'GreenCodes', senha: 'segredo123', seguranca: 'WPA' })).toBe(
      'WIFI:S:GreenCodes;T:WPA;P:segredo123;;',
    );
  });

  it('rede aberta não leva senha', () => {
    expect(montarConteudo('wifi', { rede: 'Livre', seguranca: 'NOPASS' })).toBe('WIFI:S:Livre;T:nopass;;');
  });

  it('escapa ponto e vírgula, que é o separador', () => {
    // Sem escapar, uma senha com ";" parte a linha ao meio e a rede some.
    const saida = montarConteudo('wifi', { rede: 'Loja', senha: 'a;b:c', seguranca: 'WPA' });
    expect(saida).toContain('P:a\\;b\\:c');
  });

  it('marca a rede oculta', () => {
    expect(montarConteudo('wifi', { rede: 'X', senha: 'y', seguranca: 'WPA', oculta: 'true' })).toContain('H:true');
  });

  it('cobra a senha quando a rede é fechada', () => {
    expect(() => montarConteudo('wifi', { rede: 'X', seguranca: 'WPA' })).toThrow(/senha/);
  });
});

describe('telefone, e-mail e sms', () => {
  it('telefone abre o discador', () => {
    expect(montarConteudo('telefone', { numero: '31995998009' })).toBe('tel:+5531995998009');
  });

  it('e-mail leva assunto e mensagem', () => {
    const saida = montarConteudo('email', { para: 'a@b.com', assunto: 'Orçamento', mensagem: 'Bom dia' });
    expect(saida.startsWith('mailto:a@b.com?')).toBe(true);
    expect(saida).toContain('subject=Or');
    expect(saida).toContain('body=Bom');
  });

  it('sms leva o recado', () => {
    expect(montarConteudo('sms', { numero: '31995998009', mensagem: 'oi' })).toBe('SMSTO:+5531995998009:oi');
  });
});

describe('contato', () => {
  it('monta um vCard que a agenda lê', () => {
    const saida = montarConteudo('contato', {
      nome: 'Gustavo',
      empresa: 'GreenCodes',
      numero: '31995998009',
      email: 'a@b.com',
    });
    expect(saida.startsWith('BEGIN:VCARD')).toBe(true);
    expect(saida.trimEnd().endsWith('END:VCARD')).toBe(true);
    expect(saida).toContain('FN:Gustavo');
    expect(saida).toContain('ORG:GreenCodes');
    expect(saida).toContain('TEL;TYPE=CELL:+5531995998009');
  });

  it('cobra o nome', () => {
    expect(() => montarConteudo('contato', {})).toThrow(/nome/);
  });
});

describe('PIX: o verificador', () => {
  /*
   * Existe meia dúzia de variantes de CRC-16, e todas devolvem quatro dígitos
   * de aparência igual. Usar a errada dá um código que parece certo e o banco
   * recusa — por isso o valor conhecido está preso aqui.
   *
   * "123456789" é a entrada padrão de conferência de CRC, e o CCITT-FALSE
   * responde 29B1.
   */
  it('é o CCITT-FALSE, e não outra variante', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('sempre devolve quatro dígitos', () => {
    for (const entrada of ['', 'a', 'PIX', '00020126']) {
      expect(crc16(entrada)).toMatch(/^[0-9A-F]{4}$/);
    }
  });
});

describe('PIX: o código', () => {
  const base = { chave: 'a@b.com', nome: 'GreenCodes', cidade: 'Belo Horizonte' };

  it('começa com a versão do formato e termina com o verificador', () => {
    const codigo = montarPix(base);
    expect(codigo.startsWith('000201')).toBe(true);
    expect(codigo.slice(-8, -4)).toBe('6304');
    expect(codigo.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });

  it('o verificador fecha quando conferido de volta', () => {
    // É o que o banco faz: recalcula sobre tudo, inclusive o "6304".
    const codigo = montarPix(base);
    expect(crc16(codigo.slice(0, -4))).toBe(codigo.slice(-4));
  });

  it('a chave vai dentro do arranjo do Banco Central', () => {
    expect(montarPix(base)).toContain('br.gov.bcb.pix');
    expect(montarPix(base)).toContain('a@b.com');
  });

  it('cada campo declara o próprio tamanho', () => {
    /*
     * O formato não tem separador: quem lê sabe onde o campo acaba porque o
     * tamanho vem escrito antes. Um tamanho errado desalinha tudo dali para
     * frente, e o código vira lixo sem dar erro.
     */
    const codigo = montarPix(base);
    const ids: string[] = [];
    let i = 0;
    while (i < codigo.length) {
      const id = codigo.slice(i, i + 2);
      const tamanho = Number(codigo.slice(i + 2, i + 4));
      expect(Number.isFinite(tamanho), `tamanho ilegível na posição ${i}`).toBe(true);
      ids.push(id);
      i += 4 + tamanho;
    }

    // A caminhada termina exatamente no fim: nem sobrou nem faltou byte, o
    // que só acontece se todo tamanho declarado estiver certo.
    expect(i).toBe(codigo.length);
    // E o último campo é o verificador, que fecha o código.
    expect(ids[ids.length - 1]).toBe('63');
    expect(ids[0]).toBe('00');
    expect(ids).toContain('26');
  });

  it('a moeda é o real e o país é o Brasil', () => {
    const codigo = montarPix(base);
    expect(codigo).toContain('5303986');
    expect(codigo).toContain('5802BR');
  });

  it('leva o valor quando informado', () => {
    expect(montarPix({ ...base, valor: '25,90' })).toContain('540525.90');
    expect(montarPix({ ...base, valor: '1.250,00' })).toContain('54071250.00');
  });

  it('sem valor, quem paga digita quanto quer', () => {
    // É a caixinha do balcão, e é permitido pela norma.
    const codigo = montarPix(base);
    expect(codigo).not.toContain('5405');
    expect(codigo).not.toContain('5406');
  });

  it('valor inválido é tratado como sem valor, e não como zero', () => {
    for (const ruim of ['abc', '-5', '0', '']) {
      expect(normalizarValor(ruim)).toBe('');
    }
  });

  it('tira acento do nome, que muitos bancos recusam', () => {
    expect(montarPix({ ...base, nome: 'Gráfica São João' })).toContain('GRAFICA SAO JOAO');
  });

  it('corta nome e cidade no teto da norma', () => {
    const codigo = montarPix({
      ...base,
      nome: 'UM NOME MUITO MAIS COMPRIDO DO QUE A NORMA PERMITE',
      cidade: 'UMA CIDADE DE NOME ENORME',
    });
    // 25 e 15 são os tetos; passar disso faz o banco recusar o código inteiro.
    expect(codigo).toContain('5925UM NOME MUITO MAIS COMP');
    expect(codigo).toContain('6015UMA CIDADE DE ');
  });

  it('sem identificador, usa a marca combinada', () => {
    expect(montarPix(base)).toContain('62070503***');
  });

  it('o identificador aceita só letra e número', () => {
    expect(identificadorValido('PED-123/45')).toBe('PED12345');
    expect(identificadorValido('')).toBe('***');
    expect(identificadorValido('x'.repeat(40))).toHaveLength(25);
  });

  it('cobra a chave', () => {
    expect(() => montarPix({ ...base, chave: '' })).toThrow(/chave PIX/);
  });

  it('pelo montarConteudo dá o mesmo resultado', () => {
    expect(montarConteudo('pix', { ...base, valor: '10,00' })).toBe(montarPix({ ...base, valor: '10,00' }));
  });
});

describe('o catálogo de tipos', () => {
  it('todo tipo tem nome e explicação', () => {
    for (const [tipo, dados] of Object.entries(TIPOS)) {
      expect(dados.nome, tipo).toBeTruthy();
      expect(dados.sobre.length, tipo).toBeGreaterThan(15);
    }
  });

  it('texto solto continua saindo como foi escrito', () => {
    expect(montarConteudo('texto', { texto: 'qualquer coisa' })).toBe('qualquer coisa');
  });
});
