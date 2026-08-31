'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const executar = promisify(execFile);

/**
 * Menu do botão direito no Explorador do Windows.
 *
 * As chaves ficam em HKCU, e não em HKLM, de propósito: assim a integração não
 * pede elevação e some junto com o perfil do usuário. Nada é escrito fora de
 * `Software\Classes\SystemFileAssociations`, que é o lugar previsto para
 * acrescentar ações a um tipo de arquivo sem sequestrar o programa padrão.
 */

const RAIZ = 'HKCU\\Software\\Classes\\SystemFileAssociations';

const ACOES = [
  { extensao: '.pdf', chave: 'GreenPdfAbrir', rotulo: 'Abrir no PDF.GreenCodes', varios: false },
  { extensao: '.pdf', chave: 'GreenPdfJuntar', rotulo: 'Juntar com o PDF.GreenCodes', varios: true },
  { extensao: '.jpg', chave: 'GreenPdfImagem', rotulo: 'Transformar em PDF', varios: true },
  { extensao: '.jpeg', chave: 'GreenPdfImagem', rotulo: 'Transformar em PDF', varios: true },
  { extensao: '.png', chave: 'GreenPdfImagem', rotulo: 'Transformar em PDF', varios: true },
];

function caminhoDaChave(acao) {
  return `${RAIZ}\\${acao.extensao}\\shell\\${acao.chave}`;
}

async function reg(args) {
  try {
    await executar('reg', args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Já está registrado? Basta uma das chaves responder. */
async function consultar() {
  if (process.platform !== 'win32') return false;
  return reg(['query', caminhoDaKeyPrincipal(), '/ve']);
}

function caminhoDaKeyPrincipal() {
  return caminhoDaChave(ACOES[0]);
}

async function ativar(executavel, icone) {
  if (process.platform !== 'win32') return false;

  for (const acao of ACOES) {
    const chave = caminhoDaChave(acao);
    await reg(['add', chave, '/ve', '/d', acao.rotulo, '/f']);
    await reg(['add', chave, '/v', 'Icon', '/d', icone, '/f']);

    // MultiSelectModel=Player entrega todos os selecionados numa chamada só,
    // em vez de abrir uma janela por arquivo.
    if (acao.varios) {
      await reg(['add', chave, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
    }

    await reg(['add', `${chave}\\command`, '/ve', '/d', `"${executavel}" "%1"`, '/f']);
  }

  return true;
}

async function desativar() {
  if (process.platform !== 'win32') return false;

  const vistas = new Set();
  for (const acao of ACOES) {
    const chave = caminhoDaChave(acao);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    await reg(['delete', chave, '/f']);
  }
  return true;
}

module.exports = { consultar, ativar, desativar };
