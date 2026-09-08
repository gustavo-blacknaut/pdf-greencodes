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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conferir } from './conferir-motor.mjs';

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

/**
 * A biblioteca padrão de C++ da Microsoft.
 *
 * O PyMuPDF é C++, e o `mupdfcpp64.dll` dele depende do `msvcp140.dll`. A
 * distribuição embutida do Python traz o `vcruntime140`, que é a parte de C —
 * e **não** traz o `msvcp140`, que é a de C++.
 *
 * Numa máquina de desenvolvimento isso não aparece: qualquer programa
 * instalado antes já trouxe o Visual C++ Redistributable, e a DLL está no
 * System32. Num Windows recém formatado ela não existe, e o motor morre no
 * primeiro import com "DLL load failed while importing _extra" — sem nenhuma
 * ferramenta funcionar e sem pista nenhuma de por quê.
 *
 * O pacote `msvc-runtime` distribui os arquivos oficiais da Microsoft, os
 * mesmos do redistribuível, que a licença permite acompanhar o aplicativo.
 * Levar a DLL junto evita mandar o dono da gráfica instalar um pacote da
 * Microsoft antes de usar o programa.
 */
const MSVC = '14.44.35112';

/**
 * O que copiar do pacote.
 *
 * É a família do `msvcp140` — a biblioteca em si e os quatro arquivos para
 * onde ela encaminha parte das funções. Fora dela o pacote traz OpenMP e
 * C++/CLI, que nada aqui usa. Se um dia passar a usar, o `conferir-motor`
 * avisa antes de o instalador sair.
 */
const DLLS_DE_CPP = [
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
];

const ZIP = `https://www.python.org/ftp/python/${PYTHON}/python-${PYTHON}-embed-amd64.zip`;
const GET_PIP = 'https://bootstrap.pypa.io/get-pip.py';

const passo = (texto) => console.log(`\n== ${texto}`);
const info = (texto) => console.log(`   ${texto}`);

/**
 * Baixa para um arquivo, sem depender de curl nem de wget estarem no PATH.
 *
 * Tenta de novo antes de desistir: são quatro downloads em sequência, e um
 * tropeço de rede em qualquer um deles perde os outros três — o que já
 * aconteceu aqui, no meio da montagem, sem nada de errado com o script.
 */
async function baixar(url, destino, tentativas = 5) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      const resposta = await fetch(url);
      // Endereço errado não melhora tentando de novo: só atrasa o erro.
      if (resposta.status >= 400 && resposta.status < 500) {
        throw Object.assign(new Error(`respondeu ${resposta.status}`), { desistir: true });
      }
      if (!resposta.ok) throw new Error(`respondeu ${resposta.status}`);
      writeFileSync(destino, Buffer.from(await resposta.arrayBuffer()));
      return destino;
    } catch (erro) {
      // O `fetch` do Node diz só "fetch failed"; o motivo de verdade — tempo
      // esgotado, DNS, recusa — está na causa, e é o que resolve o problema
      // de quem está lendo a tela.
      ultimoErro = erro.cause?.message ?? erro.message;
      if (erro.desistir) break;
      if (tentativa < tentativas) {
        info(`tentativa ${tentativa} de ${tentativas}: ${ultimoErro}`);
        await new Promise((pronto) => setTimeout(pronto, tentativa * 2000));
      }
    }
  }
  throw new Error(`não consegui baixar ${url}\n   ${ultimoErro}`);
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

/**
 * Põe as DLLs de C++ ao lado do `python.exe`.
 *
 * É onde o próprio Python guarda as dele — `vcruntime140` está lá — e é uma
 * das pastas que o Windows varre ao carregar as dependências de um módulo de
 * extensão, porque é a pasta do executável.
 *
 * O pacote é baixado como roda (`.whl`), que é um zip: dá para tirar os cinco
 * arquivos sem instalar um pacote que nada aqui importa.
 */
async function trazerCpp(temporario) {
  // Pelo pip, e não por um endereço fixo: o caminho de um arquivo no PyPI
  // depende de um resumo criptográfico que muda a cada publicação, e chutar
  // esse endereço é combinar de quebrar em alguma versão futura.
  python('-m', 'pip', 'download', `msvc-runtime==${MSVC}`, '--no-deps', '-d', temporario);
  const baixada = readdirSync(temporario).find((nome) => nome.endsWith('.whl'));
  if (!baixada) throw new Error('o pip não trouxe o pacote msvc-runtime');
  const roda = path.join(temporario, baixada);

  // A extração é feita pelo próprio Python: `zipfile` já está ali, e evita
  // depender de um descompactador instalado na máquina.
  const script = path.join(temporario, 'extrair.py');
  writeFileSync(
    script,
    [
      'import sys, zipfile, os',
      'roda, destino, nomes = sys.argv[1], sys.argv[2], sys.argv[3].split(",")',
      'z = zipfile.ZipFile(roda)',
      'dentro = {os.path.basename(n): n for n in z.namelist() if "/Scripts/" not in n}',
      'for nome in nomes:',
      '    if nome not in dentro:',
      '        raise SystemExit(f"o pacote nao tem {nome}")',
      '    open(os.path.join(destino, nome), "wb").write(z.read(dentro[nome]))',
      '    print("  ", nome)',
    ].join('\n'),
    'utf8',
  );
  info(python(script, roda, RUNTIME, DLLS_DE_CPP.join(',')).trim());
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

  passo('Trazendo a biblioteca padrão de C++');
  await trazerCpp(temporario);

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

  /*
   * "Abriu aqui" não é prova de que abre na loja.
   *
   * Esta máquina tem, no System32, DLLs que um Windows recém formatado não
   * tem — e o motor as encontra sem nem saber que dependia delas. O
   * conferidor lê a tabela de importação de cada binário e responde a
   * pergunta que interessa: tudo o que ele precisa vai junto no instalador?
   */
  passo('Conferindo as dependências, como se fosse outra máquina');
  const { binarios, faltas } = conferir(RUNTIME);
  info(`${binarios} binários lidos`);
  if (faltas.size) {
    throw new Error(
      `o motor ficou sem ${[...faltas.keys()].join(', ')} — na máquina da loja ele não abriria`,
    );
  }
  info('nenhuma DLL faltando');

  passo('Pronto');
  info('Agora dá para rodar: npm run motor   e   npm run app:build');
}

main().catch((erro) => {
  console.error(`\nFalhou: ${erro.message}`);
  console.error('O runtime pode ter ficado pela metade. Rode de novo com --forcar.');
  process.exit(1);
});
