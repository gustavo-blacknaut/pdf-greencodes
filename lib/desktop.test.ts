import { describe, expect, it } from 'vitest';
import { comoBytes } from './desktop';

/**
 * O defeito que isto segura: com o canal de bytes do Tauri bloqueado, o PDF
 * chegava como a lista de números do JSON, e `new File([lista])` gravava o
 * texto "37,80,68,70" no lugar dele. Toda ferramenta dizia que não era PDF.
 */
describe('bytes que voltam do aplicativo', () => {
  const PDF = [37, 80, 68, 70, 45]; // "%PDF-"

  function texto(buffer: ArrayBuffer) {
    return new TextDecoder().decode(buffer);
  }

  it('o ArrayBuffer do canal normal passa como veio', () => {
    const original = Uint8Array.from(PDF).buffer;
    expect(comoBytes(original)).toBe(original);
  });

  it('a lista do canal reserva vira os mesmos bytes, e não o texto dela', () => {
    const bytes = comoBytes(PDF);
    expect(texto(bytes)).toBe('%PDF-');
    expect(new Uint8Array(bytes)).toEqual(Uint8Array.from(PDF));
  });

  it('um pedaço de Uint8Array leva só o pedaço', () => {
    const grande = Uint8Array.from([0, 0, ...PDF, 0]);
    expect(texto(comoBytes(grande.subarray(2, 7)))).toBe('%PDF-');
  });

  it('o arquivo montado com a lista começa com %PDF', async () => {
    const arquivo = new File([comoBytes(PDF)], 'a.pdf');
    expect(await arquivo.text()).toBe('%PDF-');
  });

  it('o que não é byte vira erro, e não arquivo estragado', () => {
    expect(() => comoBytes('37,80,68')).toThrow();
    expect(() => comoBytes(null)).toThrow();
  });
});
