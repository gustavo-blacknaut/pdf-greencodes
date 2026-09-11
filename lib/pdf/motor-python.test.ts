import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * O adaptador entre a tela e o motor Python.
 *
 * O que importa testar aqui é a tradução: a tela fala "level: maxima" e o
 * motor entende "redesenhar + nivel: muito". Um erro nesse mapa sai como
 * arquivo errado sem nenhuma mensagem de erro, que é o pior tipo de defeito.
 */

const motorFalso = {
  executar: vi.fn(),
  cancelar: vi.fn(),
  pastaTemporaria: vi.fn(),
  gravarEntrada: vi.fn(),
  lerSaida: vi.fn(),
  limpar: vi.fn(),
  aoAndar: vi.fn(),
};

vi.mock('../desktop', () => ({
  motorPython: () => (estaNoApp ? motorFalso : null),
}));

let estaNoApp = true;

const { compactarSemPerda, opcoesDoMotor, rodarNoPython, temMotorPython } = await import('./motor-python');

function contexto(extras: Partial<Parameters<typeof rodarNoPython>[1]> = {}) {
  return {
    files: [{ id: '1', name: 'a.pdf', size: 100, type: 'application/pdf', bytes: new ArrayBuffer(8), pageCount: 1, thumbnail: null }],
    options: {},
    onProgress: () => {},
    ...extras,
  } as Parameters<typeof rodarNoPython>[1];
}

beforeEach(() => {
  estaNoApp = true;
  motorFalso.pastaTemporaria.mockResolvedValue('C:\\temp\\x');
  motorFalso.gravarEntrada.mockResolvedValue('C:\\temp\\x\\a.pdf');
  motorFalso.lerSaida.mockResolvedValue({ nome: 'a-comprimido.pdf', bytes: new ArrayBuffer(50) });
  motorFalso.limpar.mockResolvedValue(undefined);
  motorFalso.aoAndar.mockReturnValue(() => {});
  motorFalso.executar.mockResolvedValue({ arquivo: 'C:\\temp\\x\\a-comprimido.pdf', notas: [] });
});

afterEach(() => vi.clearAllMocks());

describe('quais ferramentas atravessam', () => {
  it('manda as que rasterizam para o Python', () => {
    for (const id of ['grayscale', 'invert-colors', 'black-tones', 'pdf-to-images']) {
      expect(temMotorPython(id, contexto()), id).toBe(true);
    }
  });

  it('manda também as que só mexem na estrutura', () => {
    // Antes ficavam no TypeScript, por acreditar que "já eram rápidas".
    // A medição desmentiu: o custo nunca esteve na operação, e sim no
    // pdf-lib abrir e gravar — 7,0 s de piso num documento de 300 páginas,
    // sem fazer trabalho nenhum. O PyMuPDF faz o serviço inteiro em menos
    // de 1 s, ida e volta ao disco incluída.
    for (const id of ['merge', 'reverse', 'booklet', 'crop', 'header-footer', 'page-numbers', 'repair']) {
      expect(temMotorPython(id, contexto()), id).toBe(true);
    }
  });

  it('deixa no TypeScript o que o motor não sabe fazer', () => {
    // `ocr` e o editor não existem do lado de lá; `protect` existe, mas só
    // com senha — as permissões de impressão e cópia se perderiam.
    for (const id of ['ocr', 'edit', 'protect', 'pdf-to-word', 'unlock']) {
      expect(temMotorPython(id, contexto()), id).toBe(false);
    }
  });

  it('só desce o modo de dividir que o motor cobre', () => {
    expect(temMotorPython('split', contexto({ options: { mode: 'every', every: 5 } }))).toBe(true);
    /*
     * O modo por tamanho desce por um motivo que não é velocidade: quando uma
     * parte de uma página só passa do limite, ela precisa encolher, e o motor
     * encolhe reduzindo só as imagens — o texto continua texto. No navegador
     * a única saída seria redesenhar a página inteira como foto.
     */
    expect(temMotorPython('split', contexto({ options: { mode: 'size', maxSize: 5 } }))).toBe(true);
    // Por intervalo o motor não faz; fica no TypeScript.
    expect(temMotorPython('split', contexto({ options: { mode: 'ranges', ranges: '1-3' } }))).toBe(false);
  });

  it('o limite de tamanho chega ao motor em bytes, e a redução ligada', () => {
    // A tela fala em MB e o motor em bytes. Errar essa conversão por mil
    // entregaria partes de 1 KB ou de 1 GB, e as duas "funcionam".
    const opcoes = opcoesDoMotor('split', { mode: 'size', maxSize: 1 });
    expect(opcoes.limiteBytes).toBe(1024 * 1024);
    expect(opcoes.reduzir).toBe(true);

    expect(opcoesDoMotor('split', { mode: 'size', maxSize: 1, reduzir: false }).reduzir).toBe(false);
  });

  it('marca d’água ladrilhada fica no TypeScript', () => {
    // O motor carimba uma vez no meio; repetir pela página é daqui.
    expect(temMotorPython('watermark', contexto({ options: { text: 'X' } }))).toBe(true);
    expect(temMotorPython('watermark', contexto({ options: { text: 'X', tile: true } }))).toBe(false);
  });

  it('redimensionar por escala fica no TypeScript', () => {
    expect(temMotorPython('resize', contexto({ options: { target: 'a4' } }))).toBe(true);
    expect(temMotorPython('resize', contexto({ options: { target: 'scale', scale: 50 } }))).toBe(false);
    expect(temMotorPython('resize', contexto({ options: { target: 'personalizado' } }))).toBe(false);
  });

  it('no site nada atravessa, porque não existe motor', () => {
    estaNoApp = false;
    expect(temMotorPython('grayscale', contexto())).toBe(false);
  });

  it('comprimir juntando vários fica no TypeScript', () => {
    // O motor Python não junta enquanto comprime; sem esta guarda o pedido
    // sairia com um arquivo em vez do documento único.
    const varios = contexto({ options: { juntar: true } });
    expect(temMotorPython('compress', varios)).toBe(false);
  });

  it('comprimir um arquivo só atravessa', () => {
    expect(temMotorPython('compress', contexto())).toBe(true);
  });
});

describe('tradução das opções', () => {
  async function opcoesEnviadas(id: string, options: Record<string, string | number | boolean>) {
    await rodarNoPython(id, contexto({ options }));
    return motorFalso.executar.mock.calls[0][1].opcoes;
  }

  it('sem perda não redesenha', async () => {
    expect(await opcoesEnviadas('compress', { level: 'sem-perda' })).toEqual({ redesenhar: false });
  });

  it('equilibrada redesenha no nível médio', async () => {
    expect(await opcoesEnviadas('compress', { level: 'equilibrada' })).toEqual({ redesenhar: true, nivel: 'medio' });
  });

  it('máxima redesenha no nível mais forte', async () => {
    expect(await opcoesEnviadas('compress', { level: 'maxima' })).toEqual({ redesenhar: true, nivel: 'muito' });
  });

  it('a tinta do tons de preto chega inteira', async () => {
    expect(await opcoesEnviadas('black-tones', { tinta: 'k100', limite: 200, dpi: 220 })).toEqual({
      tinta: 'k100',
      limite: 200,
      dpi: 220,
    });
  });

  it('sem tinta escolhida, vai a de tela', async () => {
    expect(await opcoesEnviadas('black-tones', {})).toMatchObject({ tinta: 'rgb' });
  });

  it('dpi que não é número cai no padrão em vez de virar NaN', async () => {
    expect(await opcoesEnviadas('grayscale', { dpi: 'alto' })).toEqual({ dpi: 150 });
  });
});

describe('ida e volta pelo disco', () => {
  it('grava a entrada, chama a ação e lê a saída', async () => {
    const resultado = await rodarNoPython('grayscale', contexto());

    expect(motorFalso.gravarEntrada).toHaveBeenCalledWith('C:\\temp\\x', 'a.pdf', expect.any(ArrayBuffer));
    expect(motorFalso.executar).toHaveBeenCalledWith('tons-de-cinza', expect.objectContaining({ arquivos: ['C:\\temp\\x\\a.pdf'] }));
    expect(resultado.files).toHaveLength(1);
    expect(resultado.files[0].name).toBe('a-comprimido.pdf');
  });

  it('limpa a pasta temporária mesmo quando o motor falha', async () => {
    motorFalso.executar.mockRejectedValue(new Error('estourou'));
    await expect(rodarNoPython('grayscale', contexto())).rejects.toThrow('estourou');
    expect(motorFalso.limpar).toHaveBeenCalledWith('C:\\temp\\x');
  });

  it('páginas que não são número não viram texto na tela', async () => {
    // A cobertura de tinta manda em `paginas` a medição de cada página. Era
    // isso que aparecia como "[object Object],[object Object]" no resultado.
    motorFalso.executar.mockResolvedValue({
      arquivo: 'C:\\temp\\x\\a-cobertura.txt',
      paginas: [{ pagina: 1, maior: 280 }, { pagina: 2, maior: 310 }],
      notas: ['Limite considerado: 300%.', { nao: 'e texto' }],
    });
    const resultado = await rodarNoPython('ink-coverage', contexto());
    expect(resultado.files[0].pages).toBeUndefined();
    expect(resultado.notes).toEqual(['Limite considerado: 300%.']);
  });

  it('a contagem de páginas de verdade continua passando', async () => {
    motorFalso.executar.mockResolvedValue({ arquivo: 'C:\\temp\\x\\a.pdf', paginas: 6, notas: [] });
    const resultado = await rodarNoPython('grayscale', contexto());
    expect(resultado.files[0].pages).toBe(6);
  });

  it('a senha do arquivo acompanha o pedido', async () => {
    const comSenha = contexto();
    comSenha.files[0].senha = 'segredo';
    await rodarNoPython('grayscale', comSenha);
    expect(motorFalso.executar.mock.calls[0][1].senhas).toEqual(['segredo']);
  });

  it('resultado com vários arquivos vira vários blobs', async () => {
    motorFalso.executar.mockResolvedValue({
      arquivos: [{ arquivo: 'C:\\temp\\x\\p1.jpg' }, { arquivo: 'C:\\temp\\x\\p2.jpg' }],
    });
    const resultado = await rodarNoPython('pdf-to-images', contexto());
    expect(resultado.files).toHaveLength(2);
  });

  it('motor que termina sem gerar nada vira erro claro', async () => {
    motorFalso.executar.mockResolvedValue({ notas: [] });
    await expect(rodarNoPython('grayscale', contexto())).rejects.toThrow('sem gerar arquivo');
  });

  it('as notas do motor chegam ao resultado', async () => {
    motorFalso.executar.mockResolvedValue({
      arquivo: 'C:\\temp\\x\\a.pdf',
      notas: ['O preto saiu em K100.'],
    });
    const resultado = await rodarNoPython('black-tones', contexto());
    expect(resultado.notes).toEqual(['O preto saiu em K100.']);
  });
});

describe('compactar sem perda', () => {
  /*
   * O ganho é real e foi medido: dez orçamentos com o mesmo timbre somam
   * 3419 KB e viram 345 KB juntos — 90% menos, só por não repetir o que eles
   * tinham em comum. Nenhuma imagem é reduzida e nenhuma cor muda.
   *
   * O que se testa aqui é o contrato, não a compactação: que ela nunca
   * devolve um arquivo maior, nunca derruba o trabalho que já ficou pronto, e
   * some sozinha no site.
   */
  const grande = new Blob([new Uint8Array(1000)], { type: 'application/pdf' });

  it('devolve o arquivo compactado quando ele ficou menor', async () => {
    motorFalso.executar.mockResolvedValue({ arquivo: 'C:\\temp\\x\\compacto.pdf' });
    motorFalso.lerSaida.mockResolvedValue({ nome: 'compacto.pdf', bytes: new ArrayBuffer(300) });

    const saida = await compactarSemPerda(grande);
    expect(saida.size).toBe(300);
    expect(motorFalso.executar).toHaveBeenCalledWith('reparar', expect.anything());
  });

  it('mantém o original quando compactar engordaria', async () => {
    // Acontece com arquivo estranho, e entregar maior chamando de compactado
    // seria mentir para quem pediu.
    motorFalso.executar.mockResolvedValue({ arquivo: 'C:\\temp\\x\\compacto.pdf' });
    motorFalso.lerSaida.mockResolvedValue({ nome: 'compacto.pdf', bytes: new ArrayBuffer(5000) });

    expect((await compactarSemPerda(grande)).size).toBe(1000);
  });

  it('falhar aqui não custa o trabalho que já ficou pronto', async () => {
    // Compactar é um extra depois do serviço feito. Se o motor tropeçar, o
    // documento unido tem que sair mesmo assim.
    motorFalso.executar.mockRejectedValue(new Error('o motor caiu'));
    expect((await compactarSemPerda(grande)).size).toBe(1000);
  });

  it('limpa a pasta temporária mesmo quando falha', async () => {
    motorFalso.executar.mockRejectedValue(new Error('o motor caiu'));
    await compactarSemPerda(grande);
    expect(motorFalso.limpar).toHaveBeenCalledWith('C:\\temp\\x');
  });

  it('no site devolve o arquivo como veio, sem prometer nada', async () => {
    estaNoApp = false;
    const saida = await compactarSemPerda(grande);
    expect(saida).toBe(grande);
    expect(motorFalso.executar).not.toHaveBeenCalled();
  });
});
