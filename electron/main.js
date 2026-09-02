'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');

const integracao = require('./integracao-windows');

/**
 * PDF.GreenCodes para desktop.
 *
 * O que o app tem além do site: menu do botão direito no Explorador, diálogo
 * nativo de salvar, abertura por clique duplo e resultado sem prazo de
 * expiração. O processamento é o mesmo, rodando dentro da janela, e não há
 * requisição de rede em lugar nenhum.
 */

const PASTA_WEB = path.join(__dirname, '..', 'out');
const HOST = '127.0.0.1';
const EXTENSOES_ACEITAS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx', '.txt']);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

let janela = null;
let bandeja = null;
let porta = 0;
let encerrando = false;
let interfacePronta = false;
let filaDeArquivos = [];

/* -------------------------------------------------------------------------- */
/* Servidor local                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A interface é servida por HTTP local em vez de `file://` porque o pdf.js
 * carrega o worker por `new URL(...)`, e o protocolo de arquivo bloqueia isso.
 * O servidor só entrega o que está dentro de `out/`.
 */
function subirServidor() {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      const caminho = decodeURIComponent((req.url || '/').split('?')[0]);
      const destino = path.normalize(path.join(PASTA_WEB, caminho));

      // Trava de diretório: normaliza primeiro, compara depois. Cobre também
      // tentativa com codificação percentual, já decodificada acima.
      if (destino !== PASTA_WEB && !destino.startsWith(PASTA_WEB + path.sep)) {
        res.writeHead(403).end('Proibido');
        return;
      }

      let arquivo = destino;
      if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        const comHtml = `${destino.replace(/[\\/]+$/, '')}.html`;
        const indice = path.join(destino, 'index.html');
        arquivo = fs.existsSync(comHtml) ? comHtml : fs.existsSync(indice) ? indice : path.join(PASTA_WEB, '404.html');
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
    servidor.listen(0, HOST, () => resolve(servidor.address().port));
  });
}

/* -------------------------------------------------------------------------- */
/* Arquivos vindos do sistema                                                  */
/* -------------------------------------------------------------------------- */

/** Separa os caminhos de arquivo do resto dos argumentos da linha de comando. */
function arquivosDosArgumentos(argv) {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .filter((arg) => EXTENSOES_ACEITAS.has(path.extname(arg).toLowerCase()))
    .filter((arg) => fs.existsSync(arg));
}

async function entregarArquivos(caminhos) {
  if (!caminhos.length) return;

  // A interface pode ainda não ter montado; nesse caso guardamos para depois.
  if (!interfacePronta || !janela) {
    filaDeArquivos.push(...caminhos);
    return;
  }

  const carregados = [];
  for (const caminho of caminhos) {
    try {
      const conteudo = await fsp.readFile(caminho);
      carregados.push({ nome: path.basename(caminho), bytes: conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength) });
    } catch {
      /* arquivo sumiu ou está sem permissão: ignoramos em silêncio */
    }
  }

  if (carregados.length) janela.webContents.send('sistema:abrir-arquivos', carregados);
}

/* -------------------------------------------------------------------------- */
/* Janela e bandeja                                                            */
/* -------------------------------------------------------------------------- */

function abrirJanela() {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
    return;
  }

  janela = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#070f0b',
    show: false,
    autoHideMenuBar: true,
    title: 'PDF.GreenCodes',
    icon: path.join(__dirname, 'icone.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // A interface não precisa de Node. Sem ele, uma falha no render não vira
      // acesso ao disco.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  // `/app` é a casca enxuta: barra com a versão e as ferramentas. A home do
  // site, com apresentação e rodapé, não é carregada aqui.
  janela.loadURL(`http://${HOST}:${porta}/app`);

  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navegação para fora do próprio app é bloqueada.
  janela.webContents.on('will-navigate', (evento, url) => {
    if (!url.startsWith(`http://${HOST}:${porta}`)) {
      evento.preventDefault();
      shell.openExternal(url);
    }
  });

  // Fechar esconde na bandeja: o app fica pronto para o próximo arquivo.
  janela.on('close', (evento) => {
    if (encerrando) return;
    evento.preventDefault();
    janela.hide();
  });

  janela.on('closed', () => {
    janela = null;
    interfacePronta = false;
  });
}

function montarMenu() {
  const modelo = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Abrir...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            abrirJanela();
            const escolha = await dialog.showOpenDialog(janela, {
              title: 'Escolher arquivos',
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'Arquivos aceitos', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'txt'] }],
            });
            if (!escolha.canceled) await entregarArquivos(escolha.filePaths);
          },
        },
        { type: 'separator' },
        { label: 'Esconder na bandeja', accelerator: 'CmdOrCtrl+W', click: () => janela && janela.hide() },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            encerrando = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'resetZoom', label: 'Tamanho normal' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Diminuir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Site', click: () => shell.openExternal('https://pdf.greencodes.com.br') },
        {
          label: 'Sobre',
          click: () =>
            dialog.showMessageBox(janela, {
              type: 'info',
              title: 'PDF.GreenCodes',
              message: `PDF.GreenCodes ${app.getVersion()}`,
              detail:
                'Ferramentas de PDF que rodam inteiras nesta máquina.\nNenhum arquivo é enviado para a internet.',
            }),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(modelo));
}

async function montarBandeja() {
  const arquivoIcone = path.join(__dirname, 'icone.png');
  const imagem = fs.existsSync(arquivoIcone)
    ? nativeImage.createFromPath(arquivoIcone).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  bandeja = new Tray(imagem);
  bandeja.setToolTip('PDF.GreenCodes');
  await atualizarMenuDaBandeja();
  bandeja.on('click', () => abrirJanela());
}

async function atualizarMenuDaBandeja() {
  if (!bandeja) return;

  const [integrado, inicio] = await Promise.all([
    integracao.consultar(),
    Promise.resolve(app.getLoginItemSettings().openAtLogin),
  ]);

  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir', click: () => abrirJanela() },
      { type: 'separator' },
      {
        label: 'Menu do botão direito no Explorador',
        type: 'checkbox',
        checked: integrado,
        click: async (item) => {
          await definirIntegracao(item.checked);
          await atualizarMenuDaBandeja();
        },
      },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: inicio,
        click: async (item) => {
          definirInicioAutomatico(item.checked);
          await atualizarMenuDaBandeja();
        },
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
}

/**
 * Início automático em modo oculto.
 *
 * `openAsHidden` não funciona no Windows, então passamos `--oculto` e a janela
 * só aparece quando alguém pede. Um app de PDF pulando na cara ao ligar o
 * computador seria motivo para desinstalar.
 */
function definirInicioAutomatico(ligado) {
  app.setLoginItemSettings({ openAtLogin: ligado, path: process.execPath, args: ['--oculto'] });
}

function definirIntegracao(ligado) {
  return ligado
    ? integracao.ativar(process.execPath, `${process.execPath},0`)
    : integracao.desativar();
}

/* -------------------------------------------------------------------------- */
/* Canais com a interface                                                      */
/* -------------------------------------------------------------------------- */

function registrarCanais() {
  ipcMain.handle('app:versao', () => app.getVersion());

  ipcMain.on('sistema:pronto', async () => {
    interfacePronta = true;
    if (filaDeArquivos.length) {
      const pendentes = filaDeArquivos;
      filaDeArquivos = [];
      await entregarArquivos(pendentes);
    }
  });

  ipcMain.handle('arquivo:salvar', async (_evento, { nome, bytes }) => {
    if (typeof nome !== 'string' || !(bytes instanceof ArrayBuffer)) {
      return { ok: false, erro: 'Pedido inválido.' };
    }

    const escolha = await dialog.showSaveDialog(janela, {
      title: 'Salvar arquivo',
      defaultPath: path.basename(nome),
      filters: filtrosPara(nome),
    });
    if (escolha.canceled || !escolha.filePath) return { ok: false, cancelado: true };

    try {
      await fsp.writeFile(escolha.filePath, Buffer.from(bytes));
      return { ok: true, caminho: escolha.filePath };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

  ipcMain.handle('arquivo:salvar-varios', async (_evento, { arquivos }) => {
    if (!Array.isArray(arquivos) || !arquivos.length) return { ok: false, erro: 'Nada para salvar.' };

    const escolha = await dialog.showOpenDialog(janela, {
      title: 'Escolher a pasta de destino',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (escolha.canceled || !escolha.filePaths[0]) return { ok: false, cancelado: true };

    const pasta = escolha.filePaths[0];
    const salvos = [];
    try {
      for (const arquivo of arquivos) {
        if (typeof arquivo?.nome !== 'string' || !(arquivo.bytes instanceof ArrayBuffer)) continue;
        // basename impede que um nome com barra escreva fora da pasta escolhida.
        const destino = path.join(pasta, path.basename(arquivo.nome));
        await fsp.writeFile(destino, Buffer.from(arquivo.bytes));
        salvos.push(destino);
      }
      return { ok: true, pasta, quantidade: salvos.length };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

  ipcMain.handle('arquivo:escolher', async (_evento, { extensoes }) => {
    const lista = Array.isArray(extensoes) && extensoes.length ? extensoes : ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'txt'];
    const escolha = await dialog.showOpenDialog(janela, {
      title: 'Escolher arquivos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Arquivos aceitos', extensions: lista.map((e) => String(e).replace('.', '')) }],
    });
    if (escolha.canceled) return [];

    const resultado = [];
    for (const caminho of escolha.filePaths) {
      try {
        const conteudo = await fsp.readFile(caminho);
        resultado.push({
          nome: path.basename(caminho),
          bytes: conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength),
        });
      } catch {
        /* ignora o que não conseguimos ler */
      }
    }
    return resultado;
  });

  ipcMain.handle('arquivo:revelar', (_evento, { caminho }) => {
    if (typeof caminho === 'string' && fs.existsSync(caminho)) shell.showItemInFolder(caminho);
    return true;
  });

  /**
   * Impressoras visiveis para o Windows: locais, de rede e as virtuais
   * ('Microsoft Print to PDF' e afins). O nome tecnico e o que a impressao
   * usa; o amigavel e o que a pessoa reconhece.
   */
  ipcMain.handle('impressora:listar', async () => {
    if (!janela) return [];
    const lista = await janela.webContents.getPrintersAsync();
    return lista.map((impressora) => ({
      nome: impressora.name,
      apelido: impressora.displayName || impressora.name,
      descricao: impressora.description || '',
      padrao: Boolean(impressora.isDefault),
    }));
  });

  /**
   * Impressão: grava o PDF num arquivo temporário, abre numa janela escondida
   * e manda para a fila. O Chromium já renderiza PDF, então não depende de
   * leitor externo instalado na máquina.
   */
  ipcMain.handle('arquivo:imprimir', async (_evento, { nome, bytes, opcoes }) => {
    if (typeof nome !== 'string' || !(bytes instanceof ArrayBuffer)) {
      return { ok: false, erro: 'Pedido inválido.' };
    }

    const temporario = path.join(os.tmpdir(), `greencodes-${Date.now()}-${path.basename(nome)}`);
    let janelaImpressao = null;
    try {
      await fsp.writeFile(temporario, Buffer.from(bytes));

      janelaImpressao = new BrowserWindow({ show: false, webPreferences: { plugins: true, sandbox: true } });
      await janelaImpressao.loadURL(`file://${temporario.split(String.fromCharCode(92)).join("/")}`);

      const resultado = await new Promise((resolve) => {
        // Com impressora escolhida no painel, imprimimos direto (silent). Sem
        // ela, cai na caixa do Windows, que e o caminho do site.
        const config = opcoes || {};
        janelaImpressao.webContents.print(
          {
            silent: Boolean(config.impressora),
            deviceName: config.impressora || undefined,
            color: config.colorido !== false,
            copies: Math.max(1, Math.min(99, Number(config.copias) || 1)),
            landscape: Boolean(config.paisagem),
            duplexMode: config.duplex || 'simplex',
            pageSize: config.papel || 'A4',
            dpi: { horizontal: Number(config.dpi) || 300, vertical: Number(config.dpi) || 300 },
            printBackground: true,
          },
          (sucesso, motivo) => resolve({ sucesso, motivo }),
        );
      });

      // Cancelar no diálogo do Windows não é erro: a pessoa desistiu.
      if (!resultado.sucesso && resultado.motivo && resultado.motivo !== 'cancelled') {
        return { ok: false, erro: resultado.motivo };
      }
      return { ok: true, cancelado: !resultado.sucesso };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    } finally {
      if (janelaImpressao && !janelaImpressao.isDestroyed()) janelaImpressao.destroy();
      fsp.rm(temporario, { force: true }).catch(() => {});
    }
  });

  ipcMain.handle('integracao:consultar', () => integracao.consultar());
  ipcMain.handle('integracao:definir', async (_evento, { ligado }) => {
    const ok = await definirIntegracao(Boolean(ligado));
    await atualizarMenuDaBandeja();
    return ok;
  });

  ipcMain.handle('inicio:consultar', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('inicio:definir', async (_evento, { ligado }) => {
    definirInicioAutomatico(Boolean(ligado));
    await atualizarMenuDaBandeja();
    return true;
  });
}

function filtrosPara(nome) {
  const extensao = path.extname(nome).replace('.', '').toLowerCase() || 'pdf';
  const rotulos = { pdf: 'Documento PDF', zip: 'Arquivo compactado', jpg: 'Imagem JPEG', png: 'Imagem PNG', txt: 'Texto' };
  return [
    { name: rotulos[extensao] ?? extensao.toUpperCase(), extensions: [extensao] },
    { name: 'Todos os arquivos', extensions: ['*'] },
  ];
}

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir um arquivo com o app já rodando manda os caminhos para a janela viva,
  // em vez de subir uma segunda cópia do programa.
  app.on('second-instance', async (_evento, argv) => {
    abrirJanela();
    await entregarArquivos(arquivosDosArgumentos(argv));
  });

  // macOS entrega arquivos por evento, e não por argumento.
  app.on('open-file', async (evento, caminho) => {
    evento.preventDefault();
    abrirJanela();
    await entregarArquivos([caminho]);
  });

  app.whenReady().then(async () => {
    if (!fs.existsSync(PASTA_WEB)) {
      dialog.showErrorBox(
        'PDF.GreenCodes',
        'A pasta "out" não foi encontrada.\n\nRode "npm run build" antes de empacotar o aplicativo.',
      );
      app.quit();
      return;
    }

    try {
      porta = await subirServidor();
    } catch (erro) {
      dialog.showErrorBox('PDF.GreenCodes', `Não foi possível iniciar: ${erro.message}`);
      app.quit();
      return;
    }

    registrarCanais();
    montarMenu();
    await montarBandeja();

    const arquivosIniciais = arquivosDosArgumentos(process.argv);
    if (arquivosIniciais.length) filaDeArquivos.push(...arquivosIniciais);

    // Só abre a janela sozinho quando não foi o Windows que nos iniciou.
    if (!process.argv.includes('--oculto') || arquivosIniciais.length) abrirJanela();

    app.on('activate', () => abrirJanela());
  });

  app.on('window-all-closed', () => {
    // Não encerra: o app continua na bandeja até escolherem Sair.
  });

  app.on('before-quit', () => {
    encerrando = true;
  });
}
