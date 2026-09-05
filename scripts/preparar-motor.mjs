/**
 * Monta o motor Python embutido em `motor/runtime`.
 *
 * Esses 40 MB são ignorados pelo git de propósito — binário não entra em
 * repositório — mas até agora não havia como refazê-los: o runtime tinha sido
 * montado à mão numa sessão, e quem clonava o projeto conseguia rodar o site
 * e não conseguia gerar o instalador. Este script fecha esse buraco.
 *
 * O que ele monta é a distribuição *embeddable* do Python: uma pasta que roda
 * sozinha, sem instalar nada no Windows e sem aparecer no PATH. É o que
 * permite o aplicativo carregar o PyMuPDF na máquina de alguém que nunca
 * ouviu falar de Python.
 *
 *   node scripts/preparar-motor.mjs            # monta se não existir
 *   node scripts/preparar-motor.mjs --forcar   # refaz do zero
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(RAIZ, 'motor', 'runtime');

/**
 * As versões são fixas de propósito.
 *
 * O instalador vai para as máquinas da loja, e "a versão mais nova do dia"
 * significa que dois builds do mesmo commit podem sair diferentes. Subir a
 * versão é uma decisão, não um efeito colateral.
 */
const PYTHON = '3.12.10';
const PYMUPDF = '1.28.2';

const ZIP = `https://www.python.org/ftp/python/${PYTHON}/python-${PYTHON}-embed-amd64.zip`;
const GET_PIP = 'https://bootstrap.pypa.io/get-pip.py';

const passo = (texto) => console.log(`\n== ${texto}`);
const info = (texto) => console.log(`   ${texto}`);

/** Baixa para um arquivo, sem depender de curl nem de wget estarem no PATH. */
async function baixar(url, destino) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`${url} respondeu ${resposta.status}`);
  writeFileSync(destino, Buffer.from(await resposta.arrayBuffer()));
  return destino;
}

/** O `python` da pasta, que é o único que este script usa. */
function python(...args) {
  return execFileSync(path.join(RUNTIME, 'python.exe'), args, {
    cwd: RUNTIME,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * A distribuição embeddable vem com o `import site` comentado.
 *
 * Sem descomentar, o `site-packages` não entra no caminho de importação e o
 * PyMuPDF fica instalado mas invisível. É o detalhe que faz o motor subir e
 * morrer no primeiro `import`.
 */
function liberarSitePackages() {
  const arquivo = path.join(RUNTIME, `python${PYTHON.split('.').slice(0, 2).join('')}._pth`);
  if (!existsSync(arquivo)) throw new Error(`não achei o ${path.basename(arquivo)} dentro do runtime`);

  const conteudo = readFileSync(arquivo, 'utf8');
  if (/^import site$/m.test(conteudo)) {
    info('site-packages já estava liberado');
    return;
  }
  writeFileSync(arquivo, conteudo.replace(/^#\s*import site$/m, 'import site'), 'utf8');
  info(`site-packages liberado em ${path.basename(arquivo)}`);
}

async function main() {
  const forcar = process.argv.includes('--forcar');

  if (existsSync(path.join(RUNTIME, 'python.exe')) && !forcar) {
    passo('O motor já está montado');
    info(python('-c', 'import pymupdf, sys; print(sys.version.split()[0], "| PyMuPDF", pymupdf.__version__)').trim());
    info('Use --forcar para refazer do zero.');
    return;
  }

  const temporario = path.join(RAIZ, 'node_modules', '.cache', 'motor');
  mkdirSync(temporario, { recursive: true });

  passo(`Baixando o Python ${PYTHON} embutido`);
  const zip = await baixar(ZIP, path.join(temporario, 'python.zip'));
  info(`${(readFileSync(zip).length / 1048576).toFixed(1)} MB`);

  passo('Extraindo');
  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });
  // O Expand-Archive do PowerShell existe em todo Windows 10 e 11, e evita
  // depender de um descompactador instalado.
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${RUNTIME}' -Force"`,
    { stdio: 'inherit' },
  );

  passo('Liberando o site-packages');
  liberarSitePackages();

  passo('Instalando o pip');
  const getPip = await baixar(GET_PIP, path.join(temporario, 'get-pip.py'));
  python(getPip, '--no-warn-script-location');
  info(python('-m', 'pip', '--version').trim());

  passo(`Instalando o PyMuPDF ${PYMUPDF} e o pytest`);
  python('-m', 'pip', 'install', '--no-warn-script-location', `pymupdf==${PYMUPDF}`, 'pytest');

  passo('Conferindo');
  info(python('-c', 'import pymupdf, sys; print(sys.version.split()[0], "| PyMuPDF", pymupdf.__version__)').trim());

  // Uma conversão de verdade, e não só o import: pacote instalado que não
  // abre um PDF não serve para nada, e o erro apareceria só no build.
  const prova = python(
    '-c',
    'import pymupdf; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,72),"ok"); ' +
      'print("paginas:", d.page_count, "| bytes:", len(d.tobytes()))',
  );
  info(prova.trim());

  passo('Pronto');
  info('Agora dá para rodar: npm run motor   e   npm run app:build');
}

main().catch((erro) => {
  console.error(`\nFalhou: ${erro.message}`);
  console.error('O runtime pode ter ficado pela metade. Rode de novo com --forcar.');
  process.exit(1);
});
