import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * O padrão de 5s era apertado desde sempre, e ficou curto depois que o
     * motor foi dividido em módulos: cada arquivo de teste passou a montar um
     * grafo de dez arquivos em vez de um só, e o primeiro teste de cada um
     * paga esse arranque. As asserções continuam as mesmas — o que mudou foi
     * quanto tempo a primeira leva.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,

    /*
     * `.claude/worktrees` guarda cópias inteiras do projeto, e o vitest as
     * varria junto: cada teste rodava duas vezes, o total dobrava, e uma
     * cópia velha continuava reprovando com um defeito já corrigido aqui.
     * Pior: o worktree apagado do git deixa os arquivos no disco, então a
     * cópia sobrevive ao próprio worktree.
     *
     * `node_modules`, `dist` e `.next` vêm do padrão do vitest e precisam ser
     * repetidos: informar `exclude` substitui a lista inteira.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-app/**', '**/.next/**', '**/out/**', '**/.claude/**'],
  },
});
