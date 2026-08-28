/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Saída estática: o build gera HTML, CSS e JS em `out/` e acabou. Não existe
   * processo de servidor, rota de API nem banco, então também não existe
   * servidor para invadir, atualizar ou manter no ar.
   */
  output: 'export',

  // pdf.js resolve o worker por `new URL(...)`; o alias evita que o webpack
  // tente empacotar o canvas do Node, que só existe no servidor.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
