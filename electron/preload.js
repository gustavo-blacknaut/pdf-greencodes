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

  /** Abre numa janela do próprio programa. */
  abrirAqui: (caminho) => ipcRenderer.invoke('arquivo:abrir-aqui', { caminho }),

  /** Abre no navegador padrão. */
  abrirNoNavegador: (caminho) => ipcRenderer.invoke('arquivo:abrir-no-navegador', { caminho }),

  /** Escolhe uma pasta e grava vários arquivos de uma vez. */
  salvarVarios: (arquivos) => ipcRenderer.invoke('arquivo:salvar-varios', { arquivos }),

  /** Diálogo nativo de abrir. Devolve nome, caminho e tamanho — sem ler. */
  escolherArquivos: (extensoes) => ipcRenderer.invoke('arquivo:escolher', { extensoes }),

  /** Lê um arquivo escolhido. O progresso chega por aoLerArquivo. */
  lerArquivo: (caminho) => ipcRenderer.invoke('arquivo:ler', { caminho }),

  /** Quanto já foi lido do arquivo que está carregando. */
  aoLerArquivo: (callback) => {
    const ouvinte = (_evento, dados) => callback(dados);
    ipcRenderer.on('arquivo:lendo', ouvinte);
    return () => ipcRenderer.off('arquivo:lendo', ouvinte);
  },

  /** Abre as Preferências do driver, onde fica o tipo/espessura do papel. */
  preferenciasDaImpressora: (impressora) => ipcRenderer.invoke('impressora:preferencias', { impressora }),

  /** Impressoras que o Windows enxerga: locais, de rede e virtuais. */
  listarImpressoras: () => ipcRenderer.invoke('impressora:listar'),

  /**
   * Impressão em três tempos: abre a sessão, manda cada página desenhada e
   * então envia. Quem desenha é a interface, que é onde o pdf.js mora.
   */
  impressao: {
    preparar: () => ipcRenderer.invoke('impressao:preparar'),
    pagina: (id, indice, bytes) => ipcRenderer.invoke('impressao:pagina', { id, indice, bytes }),
    enviar: (id, opcoes, nome) => ipcRenderer.invoke('impressao:enviar', { id, opcoes, nome }),
    descartar: (id) => ipcRenderer.invoke('impressao:descartar', { id }),
  },

  /**
   * O motor de PDF em Python (PyMuPDF).
   *
   * Existe porque desenhar página no pdf.js é lento: medido no mesmo arquivo
   * de 141 páginas, 1189 ms por página contra 277 do PyMuPDF. As ferramentas
   * que rasterizam passam por aqui; as que só mexem na estrutura do PDF
   * continuam rodando na própria janela, onde já eram rápidas.
   *
   * A interface trabalha com bytes e o motor com arquivo em disco, então a
   * ponte grava a entrada numa pasta temporária e lê a saída de volta.
   */
  motor: {
    executar: (acao, pedido) => ipcRenderer.invoke('motor:executar', { acao, pedido }),
    cancelar: () => ipcRenderer.invoke('motor:cancelar'),
    pastaTemporaria: () => ipcRenderer.invoke('motor:pasta-temporaria'),
    gravarEntrada: (pasta, nome, bytes) => ipcRenderer.invoke('motor:gravar-entrada', { pasta, nome, bytes }),
    lerSaida: (caminho) => ipcRenderer.invoke('motor:ler-saida', { caminho }),
    limpar: (pasta) => ipcRenderer.invoke('motor:limpar', { pasta }),

    /** Quanto já andou do trabalho atual. Devolve a função de desligar o aviso. */
    aoAndar: (callback) => {
      const ouvinte = (_evento, passo) => callback(passo);
      ipcRenderer.on('motor:andamento', ouvinte);
      return () => ipcRenderer.off('motor:andamento', ouvinte);
    },
  },

  /** Mostra o arquivo salvo no Explorador. */
  revelar: (caminho) => ipcRenderer.invoke('arquivo:revelar', { caminho }),

  /** Abre a pasta onde os resultados são salvos. */
  abrirPastaDosResultados: () => ipcRenderer.invoke('arquivo:pasta-resultados'),

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
