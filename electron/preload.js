'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Ponte entre a interface e o processo principal.
 *
 * A janela roda com `contextIsolation` e `sandbox` ligados, então a página não
 * tem acesso a Node nem ao sistema de arquivos. Tudo que ela consegue fazer
 * está nesta lista, e cada função é validada do outro lado antes de tocar em
 * qualquer coisa. É de propósito que não exista nada genérico aqui: sem
 * `invoke` livre, uma falha na interface não vira acesso ao disco.
 */
contextBridge.exposeInMainWorld('greenpdf', {
  /** Marca de que estamos no aplicativo, e não no site. */
  ehAplicativo: true,

  versao: () => ipcRenderer.invoke('app:versao'),

  /** Abre o diálogo nativo de salvar e grava o arquivo escolhido. */
  salvarArquivo: (nome, bytes) => ipcRenderer.invoke('arquivo:salvar', { nome, bytes }),

  /** Grava direto em Documentos/PDF.GreenCodes com nome numérico. */
  salvarNumerado: (nome, bytes) => ipcRenderer.invoke('arquivo:salvar-numerado', { nome, bytes }),

  /** Abre o arquivo no programa padrão do sistema. */
  abrir: (caminho) => ipcRenderer.invoke('arquivo:abrir', { caminho }),

  /** Escolhe uma pasta e grava vários arquivos de uma vez. */
  salvarVarios: (arquivos) => ipcRenderer.invoke('arquivo:salvar-varios', { arquivos }),

  /** Diálogo nativo de abrir. Devolve nome e conteúdo de cada escolhido. */
  escolherArquivos: (extensoes) => ipcRenderer.invoke('arquivo:escolher', { extensoes }),

  /** Manda o PDF para a fila de impressão, com o diálogo do sistema. */
  /** Impressoras que o Windows enxerga: locais, de rede e virtuais. */
  listarImpressoras: () => ipcRenderer.invoke('impressora:listar'),

  imprimir: (nome, bytes, opcoes) => ipcRenderer.invoke('arquivo:imprimir', { nome, bytes, opcoes }),

  /** Mostra o arquivo salvo no Explorador. */
  revelar: (caminho) => ipcRenderer.invoke('arquivo:revelar', { caminho }),

  /** Arquivos abertos pelo sistema: clique duplo, "Abrir com", menu de contexto. */
  aoAbrirDoSistema: (callback) => {
    const ouvinte = (_evento, arquivos) => callback(arquivos);
    ipcRenderer.on('sistema:abrir-arquivos', ouvinte);
    // Avisa o processo principal que a interface já está pronta para receber.
    ipcRenderer.send('sistema:pronto');
    return () => ipcRenderer.off('sistema:abrir-arquivos', ouvinte);
  },

  menuDeContexto: {
    consultar: () => ipcRenderer.invoke('integracao:consultar'),
    definir: (ligado) => ipcRenderer.invoke('integracao:definir', { ligado }),
  },

  inicioAutomatico: {
    consultar: () => ipcRenderer.invoke('inicio:consultar'),
    definir: (ligado) => ipcRenderer.invoke('inicio:definir', { ligado }),
  },
});
