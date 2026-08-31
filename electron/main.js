'use strict';

const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

/**
 * Casca desktop do PDF.GreenCodes.
 *
 * A aplicação é a mesma do site: HTML, CSS e JS estáticos gerados por
 * `npm run build`. Aqui eles são servidos por um servidor local mínimo em vez de
 * abertos com file://, porque o pdf.js carrega o worker por `new URL(...)` e o
 * protocolo de arquivo bloqueia isso. Nenhum documento sai da máquina: o
 * servidor só entrega os arquivos da própria pasta.
 */

const PASTA = path.join(__dirname, '..', 'out');
const HOST = '127.0.0.1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function servir() {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      let caminho = decodeURIComponent((req.url || '/').split('?')[0]);

      // Nada de subir de pasta: o caminho é normalizado e preso dentro de out/.
      const destino = path.normalize(path.join(PASTA, caminho));
      if (!destino.startsWith(PASTA)) {
        res.writeHead(403).end('Proibido');
        return;
      }

      let arquivo = destino;
      if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        // Exportação estática do Next: /juntar-pdf vira juntar-pdf.html
        const comHtml = `${destino.replace(/[\/]$/, '')}.html`;
        const indice = path.join(destino, 'index.html');
        arquivo = fs.existsSync(comHtml) ? comHtml : fs.existsSync(indice) ? indice : path.join(PASTA, '404.html');
      }

      if (!fs.existsSync(arquivo)) {
        res.writeHead(404).end('Não encontrado');
        return;
      }

      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(arquivo).pipe(res);
    });

    servidor.on('error', reject);
    // Porta zero: o sistema escolhe uma livre e evita conflito com outro app.
    servidor.listen(0, HOST, () => resolve(servidor.address().port));
  });
}

let janela = null;
let bandeja = null;
let encerrando = false;

function abrirJanela(porta) {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
    return;
  }

  janela = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#070f0b',
    show: false,
    autoHideMenuBar: true,
    title: 'PDF.GreenCodes',
    webPreferences: {
      // A página é confiável, mas não há motivo para dar Node a ela.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.loadURL(`http://${HOST}:${porta}/`);

  // Link externo abre no navegador, não dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fechar esconde na bandeja: o app continua pronto para o próximo arquivo.
  janela.on('close', (evento) => {
    if (encerrando) return;
    evento.preventDefault();
    janela.hide();
  });

  janela.on('closed', () => {
    janela = null;
  });
}

function criarBandeja(porta) {
  const icone = path.join(__dirname, 'icone.png');
  const imagem = fs.existsSync(icone) ? nativeImage.createFromPath(icone) : nativeImage.createEmpty();

  bandeja = new Tray(imagem);
  bandeja.setToolTip('PDF.GreenCodes');
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir', click: () => abrirJanela(porta) },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => configurarInicioAutomatico(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          encerrando = true;
          app.quit();
        },
      },
    ]),
  );

  bandeja.on('click', () => abrirJanela(porta));
}

/**
 * Início automático.
 *
 * `openAsHidden` não vale no Windows, então passamos `--oculto` e a janela só
 * aparece quando a pessoa clica na bandeja. Ninguém quer um app de PDF pulando
 * na cara ao ligar o computador.
 */
function configurarInicioAutomatico(ligado) {
  app.setLoginItemSettings({
    openAtLogin: ligado,
    path: process.execPath,
    args: ['--oculto'],
  });
}

// Segunda instância traz a janela existente para a frente em vez de abrir outra.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => janela && abrirJanela());

  app.whenReady().then(async () => {
    let porta;
    try {
      porta = await servir();
    } catch (erro) {
      dialog.showErrorBox('PDF.GreenCodes', `Não foi possível iniciar o app: ${erro.message}`);
      app.quit();
      return;
    }

    if (!fs.existsSync(PASTA)) {
      dialog.showErrorBox(
        'PDF.GreenCodes',
        'A pasta "out" não foi encontrada. Rode "npm run build" antes de empacotar o aplicativo.',
      );
      app.quit();
      return;
    }

    criarBandeja(porta);

    // Na primeira execução deixamos o início automático ligado, já que o app
    // vive na bandeja e some do caminho.
    if (!app.getLoginItemSettings().openAtLogin) configurarInicioAutomatico(true);

    const abrirEscondido = process.argv.includes('--oculto');
    if (!abrirEscondido) abrirJanela(porta);
    else criarBandeja(porta);

    app.on('activate', () => abrirJanela(porta));
  });

  app.on('window-all-closed', () => {
    // Não encerra: o app continua na bandeja até escolherem Sair.
  });

  app.on('before-quit', () => {
    encerrando = true;
  });
}
