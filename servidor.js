'use strict';

/**
 * Servidor estático de produção, para VPS.
 *
 * O projeto compila para HTML e JS soltos em `out/`, então `next start` não
 * serve: ele recusa `output: export` e sai com erro. Isto entrega a pasta e
 * mais nada — sem dependência externa, para o pm2 subir direto.
 *
 * Escuta em 127.0.0.1 por padrão, para ficar atrás do nginx. Para expor
 * direto, passe HOST=0.0.0.0.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream');

const RAIZ = path.join(__dirname, 'out');
const PORTA = Number(process.env.PORT || 5069);
const HOST = process.env.HOST || '127.0.0.1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
};

/** Vale comprimir? Imagem e wasm já vêm comprimidos; comprimir de novo só gasta CPU. */
const COMPRIME = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.svg', '.map']);

/**
 * Os mesmos cabeçalhos de public/_headers. Ficam aqui também porque quem serve
 * agora é este processo, e não a Vercel nem o Cloudflare.
 */
const SEGURANCA = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    'frame-src blob:',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(), midi=(), serial=(), bluetooth=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

/**
 * Resolve a URL num arquivo dentro de `out/`.
 *
 * Normaliza antes de comparar: sem isso, `/../etc/passwd` com codificação
 * percentual escaparia da pasta. Devolve null quando a rota tenta sair.
 */
function resolverArquivo(url) {
  let caminho;
  try {
    caminho = decodeURIComponent(url.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  const destino = path.normalize(path.join(RAIZ, caminho));
  if (destino !== RAIZ && !destino.startsWith(RAIZ + path.sep)) return null;

  // /sobre -> out/sobre.html; /pasta/ -> out/pasta/index.html
  const candidatos = [destino, `${destino.replace(/[\\/]+$/, '')}.html`, path.join(destino, 'index.html')];
  for (const candidato of candidatos) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  return null;
}

const servidor = http.createServer(async (req, res) => {
  const responder = (status, corpo) => {
    res.writeHead(status, { ...SEGURANCA, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(corpo);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    responder(405, 'Método não permitido');
    return;
  }

  const arquivo = resolverArquivo(req.url || '/') ?? path.join(RAIZ, '404.html');
  if (!fs.existsSync(arquivo)) {
    responder(404, 'Não encontrado');
    return;
  }

  const extensao = path.extname(arquivo).toLowerCase();
  const achou404 = arquivo.endsWith(`${path.sep}404.html`) && !(req.url || '').includes('404');

  const cabecalhos = {
    ...SEGURANCA,
    'Content-Type': TIPOS[extensao] || 'application/octet-stream',
    // O conteúdo de /_next/static tem hash no nome: nunca muda, pode ficar no
    // cache para sempre. HTML precisa ser revalidado a cada deploy.
    'Cache-Control': (req.url || '').startsWith('/_next/static/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
  };

  try {
    const info = await fsp.stat(arquivo);
    const etiqueta = `W/"${info.size}-${info.mtimeMs.toString(36)}"`;
    cabecalhos.ETag = etiqueta;

    if (req.headers['if-none-match'] === etiqueta) {
      res.writeHead(304, cabecalhos);
      res.end();
      return;
    }

    // Compressão importa mais que o normal aqui: a rede da casa é 100 Mbps e o
    // grosso do peso é JavaScript, que encolhe bastante.
    const aceita = String(req.headers['accept-encoding'] || '');
    const comprimir = COMPRIME.has(extensao) && info.size > 1024;
    const codificacao = comprimir && /\bbr\b/.test(aceita) ? 'br' : comprimir && /\bgzip\b/.test(aceita) ? 'gzip' : null;

    if (codificacao) {
      cabecalhos['Content-Encoding'] = codificacao;
      cabecalhos.Vary = 'Accept-Encoding';
    } else {
      cabecalhos['Content-Length'] = info.size;
    }

    res.writeHead(achou404 ? 404 : 200, cabecalhos);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const leitura = fs.createReadStream(arquivo);
    const saida = codificacao === 'br' ? zlib.createBrotliCompress() : codificacao === 'gzip' ? zlib.createGzip() : null;

    if (saida) pipeline(leitura, saida, res, () => {});
    else pipeline(leitura, res, () => {});
  } catch (erro) {
    responder(500, 'Erro ao ler o arquivo');
    console.error('[pdf-greencodes]', erro.message);
  }
});

if (!fs.existsSync(RAIZ)) {
  console.error('[pdf-greencodes] pasta "out" não encontrada. Rode "npm run build" antes.');
  process.exit(1);
}

servidor.listen(PORTA, HOST, () => {
  console.log(`[pdf-greencodes] servindo out/ em http://${HOST}:${PORTA}`);
});

// O pm2 manda SIGINT no restart: fechar direito evita conexão pela metade.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
