'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');

const integracao = require('./integracao-windows');
const impressao = require('./impressao');
const { Motor } = require('./motor');

/**
 * Onde moram o Python e o programa de impressão.
 *
 * Empacotado eles ficam fora do asar, porque os dois precisam existir como
 * arquivo de verdade no disco para serem executados.
 */
const RAIZ_DOS_MOTORES = app.isPackaged
  ? path.join(process.resourcesPath, 'recursos')
  : path.join(__dirname, '..');

const motor = new Motor(RAIZ_DOS_MOTORES);

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

  /* ---------------------------------------------------------- motor Python */

  // O andamento chega por fora do pedido, então é reenviado para a janela em
  // vez de voltar como resposta da chamada.
  motor.aoAndar = (passo) => {
    if (janela && !janela.isDestroyed()) janela.webContents.send('motor:andamento', passo);
  };

  ipcMain.handle('motor:executar', (_evento, { acao, pedido }) => motor.executar(acao, pedido).espera);
  ipcMain.handle('motor:cancelar', () => motor.cancelar());

  /**
   * Uma pasta temporária por trabalho, e o caminho de um arquivo dentro dela.
   *
   * O motor trabalha com arquivo em disco; a interface trabalha com bytes na
   * memória. Estes dois canais são a ponte entre os dois mundos.
   */
  ipcMain.handle('motor:pasta-temporaria', async () => {
    const pasta = path.join(os.tmpdir(), 'pdf-greencodes', `motor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fsp.mkdir(pasta, { recursive: true });
    return pasta;
  });

  ipcMain.handle('motor:gravar-entrada', async (_evento, { pasta, nome, bytes }) => {
    if (typeof pasta !== 'string' || typeof nome !== 'string' || !(bytes instanceof ArrayBuffer)) {
      throw new Error('Pedido inválido.');
    }
    // path.basename corta qualquer tentativa de sair da pasta temporária pelo
    // nome do arquivo.
    const destino = path.join(pasta, path.basename(nome));
    await fsp.writeFile(destino, Buffer.from(bytes));
    return destino;
  });

  ipcMain.handle('motor:ler-saida', async (_evento, { caminho }) => {
    if (typeof caminho !== 'string') throw new Error('Pedido inválido.');
    const bytes = await fsp.readFile(caminho);
    return { nome: path.basename(caminho), bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });

  ipcMain.handle('motor:limpar', async (_evento, { pasta }) => {
    if (typeof pasta !== 'string' || !pasta.includes('pdf-greencodes')) return;
    await fsp.rm(pasta, { recursive: true, force: true });
  });

  /**
   * Abre a pasta onde os resultados são salvos.
   *
   * "Onde foi parar o arquivo" é a pergunta mais comum depois de rodar
   * alguma coisa, e todo resultado salvo pelo botão Abrir cai aqui.
   */
  ipcMain.handle('arquivo:pasta-resultados', async () => {
    try {
      const pasta = path.join(app.getPath('documents'), 'PDF.GreenCodes');
      await fsp.mkdir(pasta, { recursive: true });
      await shell.openPath(pasta);
      return { ok: true, caminho: pasta };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

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

  /**
   * Salva sem perguntar nada, numa pasta fixa, com nome numérico.
   *
   * O diálogo de "salvar como" custa dois cliques e uma decisão de nome a
   * cada arquivo. Quem processa dez documentos seguidos quer o resultado no
   * disco e pronto. O número é o primeiro livre da pasta: 1.pdf, 2.pdf, e por
   * aí. Nunca sobrescreve nada.
   */
  ipcMain.handle('arquivo:salvar-numerado', async (_evento, { nome, bytes }) => {
    if (typeof nome !== 'string' || !(bytes instanceof ArrayBuffer)) {
      return { ok: false, erro: 'Pedido inválido.' };
    }

    try {
      const pasta = path.join(app.getPath('documents'), 'PDF.GreenCodes');
      await fsp.mkdir(pasta, { recursive: true });

      const extensao = path.extname(nome) || '.pdf';
      const existentes = new Set(await fsp.readdir(pasta));
      let numero = 1;
      while (existentes.has(numero + extensao)) numero += 1;

      const destino = path.join(pasta, numero + extensao);
      await fsp.writeFile(destino, Buffer.from(bytes));
      return { ok: true, caminho: destino };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

  /**
   * Abre o arquivo numa janela do próprio programa.
   *
   * O Chromium tem leitor de PDF embutido, então é só carregar. Isso não
   * serve para imprimir — ali o print() sai com a tela do leitor, e não com
   * o documento —, mas para ler está de bom tamanho.
   */
  ipcMain.handle('arquivo:abrir-aqui', (_evento, { caminho }) => {
    if (typeof caminho !== 'string' || !fs.existsSync(caminho)) {
      return { ok: false, erro: 'Arquivo não encontrado.' };
    }

    const leitor = new BrowserWindow({
      width: 900,
      height: 1000,
      title: path.basename(caminho),
      backgroundColor: '#ffffff',
      icon: path.join(__dirname, 'icone.png'),
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, plugins: true, nodeIntegration: false, contextIsolation: true },
    });
    leitor.loadFile(caminho);
    return { ok: true, caminho };
  });

  /** Abre no navegador padrão do sistema. */
  ipcMain.handle('arquivo:abrir-no-navegador', async (_evento, { caminho }) => {
    if (typeof caminho !== 'string' || !fs.existsSync(caminho)) {
      return { ok: false, erro: 'Arquivo não encontrado.' };
    }
    try {
      // file:// com barras normais: é o que o navegador entende.
      await shell.openExternal('file:///' + caminho.split(path.sep).join('/'));
      return { ok: true, caminho };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

  /** Abre o arquivo no programa padrão do Windows. */
  ipcMain.handle('arquivo:abrir', async (_evento, { caminho }) => {
    if (typeof caminho !== 'string' || !fs.existsSync(caminho)) {
      return { ok: false, erro: 'Arquivo não encontrado.' };
    }
    const erro = await shell.openPath(caminho);
    return erro ? { ok: false, erro } : { ok: true, caminho };
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

  /**
   * Diálogo nativo de abrir. Devolve só nome, caminho e tamanho.
   *
   * Ler o conteúdo aqui era o que deixava a tela muda: com um arquivo de
   * 400 MB, entre fechar o diálogo e o arquivo aparecer passavam dezenas de
   * segundos sem nada na tela — e, se o arquivo passasse do limite, a recusa
   * só vinha depois de toda essa espera. Agora a interface recebe a lista na
   * hora, valida, mostra, e só então pede o conteúdo.
   */
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
        const info = await fsp.stat(caminho);
        resultado.push({ nome: path.basename(caminho), caminho, tamanho: info.size });
      } catch {
        /* sumiu entre escolher e olhar: ignoramos */
      }
    }
    return resultado;
  });

  /**
   * Lê um arquivo já escolhido, avisando o quanto já leu.
   *
   * Em pedaços, e não de uma vez, para a barra andar de verdade: um readFile
   * de 400 MB fica mudo até terminar.
   */
  ipcMain.handle('arquivo:ler', async (evento, { caminho }) => {
    if (typeof caminho !== 'string' || !fs.existsSync(caminho)) {
      return { ok: false, erro: 'Arquivo não encontrado.' };
    }

    try {
      const info = await fsp.stat(caminho);
      const pedacos = [];
      let lidos = 0;
      let ultimoAviso = 0;

      for await (const pedaco of fs.createReadStream(caminho, { highWaterMark: 4 * 1024 * 1024 })) {
        pedacos.push(pedaco);
        lidos += pedaco.length;

        // Um aviso a cada 2%: mais que isso só enche a fila de mensagens.
        const agora = Math.floor((lidos / info.size) * 50);
        if (agora !== ultimoAviso) {
          ultimoAviso = agora;
          evento.sender.send('arquivo:lendo', { caminho, lidos, total: info.size });
        }
      }

      const conteudo = Buffer.concat(pedacos);
      return {
        ok: true,
        nome: path.basename(caminho),
        bytes: conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength),
      };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
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
  /**
   * Abre as Preferências de Impressão do próprio driver.
   *
   * Tipo e espessura de papel (comum, fotográfico, cartão, etiqueta) não
   * passam pela API do Windows: ficam no DEVMODE privado do driver, e só a
   * janela dele mexe nisso. O que o sistema entrega é tamanho, cor e duplex.
   *
   * O que a pessoa marcar ali vira o padrão daquela impressora, e o nosso
   * envio silencioso sai com esse padrão — então dá para escolher o papel
   * grosso lá e imprimir por aqui.
   */
  ipcMain.handle('impressora:preferencias', (_evento, { impressora }) => {
    if (typeof impressora !== 'string' || !impressora.trim()) {
      return { ok: false, erro: 'Escolha uma impressora primeiro.' };
    }
    try {
      // Solto e sem esperar: a janela é modal do Windows, e travar o app
      // atrás dela deixaria a fila congelada.
      const filho = spawn('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', impressora], {
        detached: true,
        stdio: 'ignore',
      });
      filho.unref();
      return { ok: true };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

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

  /*
   * Impressão: a interface desenha as páginas e manda uma a uma; o módulo
   * de impressão junta e envia. O porquê desse caminho está lá dentro.
   */
  ipcMain.handle('impressao:preparar', () => impressao.preparar());
  ipcMain.handle('impressao:pagina', (_evento, dados) => impressao.receberPagina(dados));
  ipcMain.handle('impressao:enviar', (_evento, dados) => impressao.enviar(dados));
  ipcMain.handle('impressao:descartar', (_evento, { id }) => impressao.descartar(id));

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
    impressao.limparTudo();
    motor.desligar();
    encerrando = true;
  });
}
