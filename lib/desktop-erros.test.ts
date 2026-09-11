import { describe, expect, it, vi } from 'vitest';

/**
 * Quando o Rust devolve Err, o Tauri rejeita com o texto puro. A tela só
 * mostra a mensagem de um Error, então o motivo — "escreva pelo menos o
 * cabeçalho ou o rodapé" — virava "Algo deu errado ao processar o arquivo".
 */
const invokeFalso = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...argumentos: unknown[]) => invokeFalso(...argumentos),
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const { motorPython, salvarNumerado } = await import('./desktop');

describe('erro que vem do Rust', () => {
  it('o texto do motor chega como Error, com a mensagem inteira', async () => {
    invokeFalso.mockRejectedValueOnce('escreva pelo menos o cabeçalho ou o rodapé');
    const erro = await motorPython()!.executar('cabecalho-rodape', { arquivos: [] }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('escreva pelo menos o cabeçalho ou o rodapé');
  });

  it('um Error de verdade passa como veio', async () => {
    const original = new Error('cano quebrado');
    invokeFalso.mockRejectedValueOnce(original);
    await expect(motorPython()!.cancelar()).rejects.toBe(original);
  });

  it('o que não é texto vira Error legível, e não [object Object]', async () => {
    invokeFalso.mockRejectedValueOnce({ codigo: 5 });
    const erro = await salvarNumerado('a.pdf', new Blob(['x'])).catch((e: unknown) => e);
    expect((erro as Error).message).toBe('{"codigo":5}');
  });
});
