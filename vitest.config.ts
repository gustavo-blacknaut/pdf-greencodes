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
  },
});
