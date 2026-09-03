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

const { rodarNoPython, temMotorPython } = await import('./motor-python');

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

  it('deixa no TypeScript as que só mexem na estrutura', () => {
    // Juntar e girar já eram rápidas: trocar só somaria risco.
    for (const id of ['merge', 'split', 'rotate', 'protect', 'ocr']) {
      expect(temMotorPython(id, contexto()), id).toBe(false);
    }
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
