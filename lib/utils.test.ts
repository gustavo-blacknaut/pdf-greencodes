import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, parsePageRange, replaceExtension, suffixName } from './utils';

describe('parsePageRange', () => {
  it('devolve todas as páginas quando a entrada é vazia', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('   ', 3)).toEqual([0, 1, 2]);
  });

  it('converte números soltos para índices base zero', () => {
    expect(parsePageRange('1', 5)).toEqual([0]);
    expect(parsePageRange('2, 4', 5)).toEqual([1, 3]);
  });

  it('entende intervalos fechados e abertos', () => {
    expect(parsePageRange('2-4', 6)).toEqual([1, 2, 3]);
    expect(parsePageRange('4-', 6)).toEqual([3, 4, 5]);
    expect(parsePageRange('-2', 6)).toEqual([0, 1]);
  });

  it('ordena e remove repetições', () => {
    expect(parsePageRange('3, 1, 3, 2-3', 5)).toEqual([0, 1, 2]);
  });

  it('aceita ponto e vírgula e espaços como separadores', () => {
    expect(parsePageRange('1;3', 4)).toEqual([0, 2]);
    expect(parsePageRange('1 3', 4)).toEqual([0, 2]);
  });

  it('recusa páginas fora do documento', () => {
    expect(() => parsePageRange('9', 3)).toThrow(/não existe/);
    expect(() => parsePageRange('0', 3)).toThrow(/não existe/);
    expect(() => parsePageRange('1-9', 3)).toThrow(/fora do arquivo/);
  });

  it('recusa intervalo invertido', () => {
    expect(() => parsePageRange('4-2', 6)).toThrow(/fora do arquivo/);
  });

  it('recusa lixo', () => {
    expect(() => parsePageRange('abc', 3)).toThrow(/inválido/);
    expect(() => parsePageRange('1-2-3', 3)).toThrow(/inválido/);
  });
});

describe('formatBytes', () => {
  it('usa a unidade proporcional ao tamanho', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('não quebra com entrada inválida', () => {
    expect(formatBytes(-1)).toBe('sem info');
    expect(formatBytes(Number.NaN)).toBe('sem info');
  });
});

describe('formatDuration', () => {
  it('formata como minuto e segundo', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('trata tempo negativo como zero, porque o contador não pode ficar às avessas', () => {
    expect(formatDuration(-5_000)).toBe('0:00');
  });
});

describe('nomes de arquivo', () => {
  it('troca a extensão preservando pontos internos do nome', () => {
    expect(replaceExtension('relatorio.final.pdf', 'txt')).toBe('relatorio.final.txt');
  });

  it('acrescenta o sufixo antes da extensão', () => {
    expect(suffixName('contrato.pdf', 'comprimido')).toBe('contrato-comprimido.pdf');
    expect(suffixName('foto.PNG', 'girado')).toBe('foto-girado.PNG');
  });
});
