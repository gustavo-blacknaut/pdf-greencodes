/**
 * Publica a versão do aplicativo no GitHub, com o instalador anexado.
 *
 *   npm run publicar-app -- notas.md
 *
 * Cada release leva o instalador duas vezes: com a versão no nome, que é o
 * que o Tauri gera, e com o nome fixo `PDF.GreenCodes-Setup.exe`. É o nome
 * fixo que o botão "Baixar o aplicativo" do site pede, pelo endereço
 * `releases/latest/download/...`: com a versão no nome, o link quebraria a
 * cada release nova.
 *
 * Confere antes que a versão é a mesma nos três lugares onde ela mora, e que
 * o instalador existe — publicar release sem .exe deixa a loja sem ter o que
 * instalar.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const REPOSITORIO = 'gustavo-blacknaut/pdf-greencodes-app';
const NOME_FIXO = 'PDF.GreenCodes-Setup.exe';

function falhar(motivo) {
  console.error(`\nNão publiquei: ${motivo}`);
  process.exit(1);
}

const notas = process.argv[2];
if (!notas || !existsSync(notas)) falhar('passe o arquivo com as notas da versão: npm run publicar-app -- notas.md');

const versao = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
const doTauri = JSON.parse(readFileSync(path.join(RAIZ, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const doCargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(RAIZ, 'src-tauri', 'Cargo.toml'), 'utf8'))?.[1];
if (versao !== doTauri || versao !== doCargo) {
  falhar(`a versão não bate: package.json ${versao}, tauri.conf.json ${doTauri}, Cargo.toml ${doCargo}.`);
}

const pasta = path.join(RAIZ, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const comVersao = path.join(pasta, `PDF.GreenCodes_${versao}_x64-setup.exe`);
if (!existsSync(comVersao)) falhar(`não achei ${comVersao}. Rode antes: npm run app:build`);

const fixo = path.join(pasta, NOME_FIXO);
copyFileSync(comVersao, fixo);

const titulo = readFileSync(notas, 'utf8').match(/^#\s+(.+)$/m)?.[1] ?? `PDF.GreenCodes ${versao}`;
console.log(`Publicando v${versao}: ${titulo}`);
// `gh.exe` com a extensão: dentro do `npm run`, no Windows, chamar só `gh`
// falhou sem achar o programa, e a release não saiu.
execFileSync(
  process.platform === 'win32' ? 'gh.exe' : 'gh',
  ['release', 'create', `v${versao}`, comVersao, fixo, '--repo', REPOSITORIO, '--target', 'main', '--title', `v${versao} — ${titulo}`, '--notes-file', notas],
  { stdio: 'inherit' },
);
console.log(`\nO botão do site já baixa esta versão:\nhttps://github.com/${REPOSITORIO}/releases/latest/download/${NOME_FIXO}`);
