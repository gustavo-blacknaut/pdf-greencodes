'use strict';

/**
 * Falha o build quando um arquivo de código passa do limite.
 *
 * Existe porque o motor de PDF chegou a 2.779 linhas antes de alguém reparar.
 * Arquivo grande não é errado por si; o problema é que ninguém percebe quando
 * ele cresce, e aí já são quarenta funções no mesmo lugar.
 *
 * É um script e não um plugin de lint de propósito: o projeto não tem ESLint,
 * e trazer a árvore de dependências dele para conferir contagem de linha
 * custaria mais que o problema.
 */

const fs = require('node:fs');
const path = require('node:path');

const LIMITE = 800;
const AVISO = 600;
const PASTAS = ['app', 'components', 'lib', 'electron', 'scripts'];
const EXTENSOES = new Set(['.ts', '.tsx', '.js']);

/** Arquivo que não é nosso, ou que é gerado, não conta. */
const IGNORAR = [/node_modules/, /\.next/, /[\/]out[\/]/, /public[\/]tesseract/, /\.min\.js$/];

function listar(pasta) {
  const achados = [];
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const caminho = path.join(pasta, item.name);
    if (IGNORAR.some((re) => re.test(caminho))) continue;
    if (item.isDirectory()) achados.push(...listar(caminho));
    else if (EXTENSOES.has(path.extname(item.name))) achados.push(caminho);
  }
  return achados;
}

const arquivos = PASTAS.filter((p) => fs.existsSync(p)).flatMap(listar);

const medidos = arquivos
  .map((caminho) => ({ caminho, linhas: fs.readFileSync(caminho, 'utf8').split('\n').length }))
  .sort((a, b) => b.linhas - a.linhas);

const estourados = medidos.filter((m) => m.linhas > LIMITE);
const proximos = medidos.filter((m) => m.linhas > AVISO && m.linhas <= LIMITE);

for (const { caminho, linhas } of proximos) {
  console.warn(`  aviso  ${String(linhas).padStart(5)}  ${caminho}`);
}

if (estourados.length) {
  console.error(`\nArquivo acima de ${LIMITE} linhas:\n`);
  for (const { caminho, linhas } of estourados) {
    console.error(`  ${String(linhas).padStart(5)}  ${caminho}`);
  }
  console.error('\nDivida por assunto antes de seguir.\n');
  process.exit(1);
}

console.log(`${medidos.length} arquivos, o maior com ${medidos[0].linhas} linhas (limite ${LIMITE}).`);
