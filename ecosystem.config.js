/**
 * pm2 para a VPS.
 *
 * `next start` não serve neste projeto: a saída é estática e ele recusa
 * `output: export`. Quem entrega a pasta `out/` é o servidor.js daqui.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'pdf-greencodes',
      script: 'servidor.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 5069,
        // Atrás do nginx. Para expor direto na internet, troque por 0.0.0.0.
        HOST: '127.0.0.1',
      },
      max_memory_restart: '200M',
      autorestart: true,
    },
  ],
};
