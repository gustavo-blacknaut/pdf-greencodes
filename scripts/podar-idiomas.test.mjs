/**
 * A poda de idiomas não pode comer o que o Chromium precisa.
 *
 * São 41 MB de traduções da interface do Chromium, das quais o programa usa
 * uma. Cortar é dinheiro no bolso — mas cortar demais quebra de um jeito
 * silencioso: a interface do Chromium (menu de contexto, diálogo de
 * impressão, mensagens de erro) sobe **em branco**, sem estourar nada.
 *
 * Por isso o teste é sobre o que **fica**, e não sobre o que sai.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import podarIdiomas from './podar-idiomas.mjs';

/** Monta uma pasta `locales` como a que o electron-builder deixa. */
function comIdiomas(nomes) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'podar-'));
  const pasta = path.join(raiz, 'locales');
  mkdirSync(pasta);
  for (const nome of nomes) writeFileSync(path.join(pasta, nome), 'x'.repeat(1024));
  return { raiz, pasta };
}

const TODOS = [
  'af.pak', 'am.pak', 'ar.pak', 'en-US.pak', 'es.pak', 'fr.pak',
  'ja.pak', 'pt-BR.pak', 'pt-PT.pak', 'ru.pak', 'zh-CN.pak',
];

describe('podar idiomas', () => {
  it('deixa o português e o inglês, e leva o resto', async () => {
    const { raiz, pasta } = comIdiomas(TODOS);
    try {
      await podarIdiomas({ appOutDir: raiz });
      expect(readdirSync(pasta).sort()).toEqual(['en-US.pak', 'pt-BR.pak']);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('o inglês fica porque é o retorno do Chromium', async () => {
    /*
     * Sem `en-US`, um texto que não exista na tradução escolhida sai em
     * branco em vez de sair em inglês. Mensagem em branco num diálogo de
     * impressão é pior que mensagem em inglês.
     */
    const { raiz, pasta } = comIdiomas(TODOS);
    try {
      await podarIdiomas({ appOutDir: raiz });
      expect(readdirSync(pasta)).toContain('en-US.pak');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('quebra o build se o que precisa ficar não estiver lá', async () => {
    // Descobrir isso no build é barato; descobrir com o programa instalado,
    // na loja, com a interface em branco, não é.
    const { raiz } = comIdiomas(['af.pak', 'ru.pak']);
    try {
      await expect(podarIdiomas({ appOutDir: raiz })).rejects.toThrow(/precisa ficar/);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('não mexe no que não é tradução', async () => {
    const { raiz, pasta } = comIdiomas(['pt-BR.pak', 'en-US.pak', 'ru.pak', 'LEIA-ME.txt']);
    try {
      await podarIdiomas({ appOutDir: raiz });
      expect(readdirSync(pasta)).toContain('LEIA-ME.txt');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('sem a pasta de idiomas, não derruba o build', async () => {
    // Nem toda plataforma tem `locales`. Não é motivo para o build parar.
    const raiz = mkdtempSync(path.join(tmpdir(), 'podar-'));
    try {
      await expect(podarIdiomas({ appOutDir: raiz })).resolves.toBeUndefined();
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
