import { describe, expect, it } from 'vitest';
import {
  ArquivoRejeitado,
  LIMITES,
  pareceMesmoImagem,
  pareceMesmoPdf,
  usarLimitesDoAplicativo,
  validarFila,
} from './guards';

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
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  const arquivo = (name: string, size: number) => ({ name, size });
  const pegar = (fazer: () => void): ArquivoRejeitado => {
    try {
      fazer();
    } catch (e) {
      return e as ArquivoRejeitado;
    }
    throw new Error('era para ter recusado');
  };

  it('aceita uma fila dentro dos limites', () => {
    expect(() => validarFila([arquivo('a.pdf', 1024)], [])).not.toThrow();
  });

  it('no site, recusa acima de 200 MB e manda para o aplicativo', () => {
    expect(LIMITES.bytesPorArquivo).toBe(200 * MB);
    expect(() => validarFila([arquivo('cabe.pdf', 200 * MB)], [])).not.toThrow();

    const erro = pegar(() => validarFila([arquivo('grande.pdf', 200 * MB + 1)], []));
    expect(erro).toBeInstanceOf(ArquivoRejeitado);
    expect(erro.message).toMatch(/site aceita até 200 MB/);
    expect(erro.message).toMatch(/aplicativo/);
    expect(erro.sugereAplicativo).toBe(true);
  });

  it('no site, a soma da fila também conta, sem limite de páginas', () => {
    // Cada arquivo cabe sozinho; o que passa é a soma dos dois.
    const erro = pegar(() => validarFila([arquivo('b.pdf', 120 * MB)], [{ size: 120 * MB }]));
    expect(erro.message).toMatch(/somam 240 MB/);
    expect(erro.sugereAplicativo).toBe(true);
  });

  it('no aplicativo, arquivo de 1 GB passa e o teto é 2 GB', () => {
    usarLimitesDoAplicativo(true);
    try {
      expect(() => validarFila([arquivo('digitalizacao.pdf', 1.5 * GB)], [])).not.toThrow();
      const erro = pegar(() => validarFila([arquivo('enorme.pdf', 2 * GB + 1)], []));
      expect(erro.message).toMatch(/limite por arquivo é 2 GB/);
      // No aplicativo não há para onde mandar: sugerir o próprio app seria piada.
      expect(erro.sugereAplicativo).toBe(false);
    } finally {
      usarLimitesDoAplicativo(false);
    }
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
