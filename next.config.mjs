/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Saída estática: o build gera HTML, CSS e JS em `out/` e acabou. Não existe
   * processo de servidor, rota de API nem banco, então também não existe
   * servidor para invadir, atualizar ou manter no ar.
   */
  output: 'export',

  /**
   * Turbopack é o empacotador padrão a partir do Next 16. O alias abaixo faz o
   * mesmo papel que a configuração antiga do webpack: evita que a dependência
   * opcional `canvas` do pdfjs-dist, que só existe no Node, seja procurada no
   * pacote do navegador.
   */
  turbopack: {
    resolveAlias: {
      canvas: './lib/vazio.js',
    },
  },
};

export default nextConfig;
