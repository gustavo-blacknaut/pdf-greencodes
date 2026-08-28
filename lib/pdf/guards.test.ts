import { describe, expect, it } from 'vitest';
import { LIMITES, pareceMesmoImagem, pareceMesmoPdf, validarFila } from './guards';

function bytes(...conteudo: (string | number[])[]): ArrayBuffer {
  const partes = conteudo.flatMap((parte) =>
    typeof parte === 'string' ? [...parte].map((c) => c.charCodeAt(0)) : parte,
  );
  return new Uint8Array(partes).buffer;
}

describe('pareceMesmoPdf', () => {
  it('aceita o cabeçalho padrão', () => {
    expect(pareceMesmoPdf(bytes('%PDF-1.7\n...'))).toBe(true);
  });

  it('aceita cabeçalho precedido de lixo, como a especificação permite', () => {
    expect(pareceMesmoPdf(bytes('x'.repeat(200), '%PDF-1.4'))).toBe(true);
  });

  it('recusa executável renomeado para .pdf', () => {
    expect(pareceMesmoPdf(bytes([0x4d, 0x5a, 0x90, 0x00], 'programa'))).toBe(false);
  });

  it('recusa arquivo vazio', () => {
    expect(pareceMesmoPdf(new ArrayBuffer(0))).toBe(false);
  });

  it('recusa cabeçalho escondido além do primeiro kilobyte', () => {
    expect(pareceMesmoPdf(bytes('x'.repeat(2000), '%PDF-1.4'))).toBe(false);
  });

  it('recusa assinatura parcial', () => {
    expect(pareceMesmoPdf(bytes('%PDF'))).toBe(false);
  });
});

describe('pareceMesmoImagem', () => {
  it('reconhece JPEG, PNG e WebP', () => {
    expect(pareceMesmoImagem(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(pareceMesmoImagem(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(pareceMesmoImagem(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe(true);
  });

  it('recusa RIFF que não é WebP, como um .wav', () => {
    expect(pareceMesmoImagem(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe(false);
  });

  it('recusa PDF entrando como imagem', () => {
    expect(pareceMesmoImagem(bytes('%PDF-1.7'))).toBe(false);
  });
});

describe('validarFila', () => {
  const arquivo = (name: string, size: number) => ({ name, size });

  it('aceita uma fila dentro dos limites', () => {
    expect(() => validarFila([arquivo('a.pdf', 1024)], [])).not.toThrow();
  });

  it('recusa arquivo acima do teto individual', () => {
    expect(() => validarFila([arquivo('grande.pdf', LIMITES.bytesPorArquivo + 1)], [])).toThrow(
      /limite por arquivo/,
    );
  });

  it('recusa quando a soma com o que já está na fila estoura o teto', () => {
    // Cada arquivo cabe sozinho no teto individual; o problema é a soma.
    const cabeSozinho = LIMITES.bytesPorArquivo - 1;
    const jaNaFila = Array.from({ length: 2 }, () => ({ size: cabeSozinho }));
    expect(() => validarFila([arquivo('novo.pdf', cabeSozinho)], jaNaFila)).toThrow(/limite é/);
  });

  it('recusa arquivos demais', () => {
    const muitos = Array.from({ length: LIMITES.arquivos + 1 }, (_, i) => arquivo(`${i}.pdf`, 10));
    expect(() => validarFila(muitos, [])).toThrow(/Máximo de/);
  });

  it('cita o nome do arquivo culpado, para o usuário saber qual tirar', () => {
    expect(() => validarFila([arquivo('contrato-2026.pdf', LIMITES.bytesPorArquivo + 1)], [])).toThrow(
      /contrato-2026\.pdf/,
    );
  });
});
