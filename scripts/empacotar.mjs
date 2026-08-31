/**
 * Empacota o aplicativo para Windows.
 *
 * Por que não é só `electron-builder --win`:
 *
 * O electron-builder baixa um pacote de assinatura que traz symlinks do macOS
 * dentro. Criar symlink no Windows exige privilégio de administrador ou o Modo
 * de Desenvolvedor ligado, e sem isso a extração falha e o build morre — mesmo
 * que a gente nem vá assinar nada.
 *
 * Então o build acontece em três passos: empacota sem a etapa de assinatura,
 * grava ícone e metadados no executável com o rcedit (que vem por npm, não do
 * cache do builder), e só então monta o instalador a partir da pasta pronta.
 *
 * Se você ligar o Modo de Desenvolvedor do Windows, `npx electron-builder --win`
 * passa a funcionar direto e este script deixa de ser necessário.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pacote = require('../package.json');

const SAIDA = 'dist-app';
const DESEMPACOTADO = path.join(SAIDA, 'win-unpacked');
const EXECUTAVEL = path.join(DESEMPACOTADO, `${pacote.build.productName}.exe`);
const ICONE = path.join(SAIDA, '.icon-ico', 'icon.ico');

// Desligar a assinatura também desliga o rcedit do builder; por isso o passo 2.
const SEM_ASSINATURA = ['-c.win.signAndEditExecutable=false'];

function passo(numero, texto) {
  console.log(`\n[${numero}/3] ${texto}`);
}

function builder(args) {
  execFileSync('npx', ['electron-builder', ...args], { stdio: 'inherit', shell: true });
}

if (!existsSync('out')) {
  console.error('A pasta "out" não existe. Rode "npm run build" antes.');
  process.exit(1);
}

rmSync(SAIDA, { recursive: true, force: true });

passo(1, 'Empacotando o aplicativo');
builder(['--win', '--dir', ...SEM_ASSINATURA]);

passo(2, 'Gravando ícone e metadados no executável');
if (!existsSync(EXECUTAVEL)) {
  console.error(`Não encontrei ${EXECUTAVEL}.`);
  process.exit(1);
}

// O pacote exporta { rcedit }, e nao a funcao direto.
 const { rcedit } = require('rcedit');
await rcedit(EXECUTAVEL, {
  'icon': existsSync(ICONE) ? ICONE : undefined,
  'file-version': pacote.version,
  'product-version': pacote.version,
  'version-string': {
    ProductName: pacote.build.productName,
    FileDescription: pacote.build.productName,
    CompanyName: pacote.build.copyright,
    LegalCopyright: pacote.build.copyright,
    InternalName: pacote.build.productName,
    OriginalFilename: `${pacote.build.productName}.exe`,
  },
});

passo(3, 'Montando o instalador');
builder(['--win', 'nsis', '--prepackaged', DESEMPACOTADO, '--publish', 'never', ...SEM_ASSINATURA]);

console.log(`\nPronto. O instalador está em ${SAIDA}/`);
