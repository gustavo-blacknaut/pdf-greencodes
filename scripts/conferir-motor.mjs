/**
 * Confere o caminho inteiro entre o Node e o motor Python, sem abrir o
 * Electron: sobe o motor pelo mesmo módulo que o aplicativo usa, manda um
 * trabalho de verdade e lê o resultado de volta.
 *
 * É o teste que a interface não consegue fazer sozinha — no Vitest o
 * `electron/motor.js` roda, mas quem o chama de verdade é o processo
 * principal, e é esse encaixe que interessa aqui.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { Motor } = require('../electron/motor.js');

const RAIZ = path.join(import.meta.dirname, '..');
const PYTHON = path.join(RAIZ, 'motor', 'runtime', 'python.exe');

function passou(rotulo, condicao, detalhe = '') {
  console.log(`${condicao ? '  ok  ' : ' FALHA'} ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) process.exitCode = 1;
}

/** Um PDF de teste, feito pelo próprio PyMuPDF. */
async function pdfDeTeste(destino) {
  const script = [
    'import pymupdf, sys',
    'doc = pymupdf.open()',
    'p = doc.new_page(width=595, height=842)',
    'p.insert_text((72, 120), "Teste do motor", fontsize=28)',
    'doc.save(sys.argv[1])',
  ].join('\n');

  const arquivoDoScript = path.join(path.dirname(destino), 'gerar.py');
  await fs.writeFile(arquivoDoScript, script, 'utf8');
  execFileSync(PYTHON, [arquivoDoScript, destino]);
}

/** Lê o ColorSpace da primeira imagem do PDF, para provar que saiu CMYK. */
function colorspaceDaPrimeiraImagem(caminho) {
  const script = [
    'import pymupdf, sys',
    'doc = pymupdf.open(sys.argv[1])',
    'imagens = doc[0].get_images(full=True)',
    'print(doc.xref_get_key(imagens[0][0], "ColorSpace")[1] if imagens else "sem imagem")',
  ].join('\n');

  const arquivoDoScript = path.join(path.dirname(caminho), 'ler.py');
  execFileSync(PYTHON, ['-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])', arquivoDoScript, script]);
  return execFileSync(PYTHON, [arquivoDoScript, caminho], { encoding: 'utf8' }).trim();
}

const pasta = path.join(os.tmpdir(), `conferir-motor-${Date.now()}`);
await fs.mkdir(pasta, { recursive: true });

const motor = new Motor(RAIZ);
const andamentos = [];
motor.aoAndar = (passo) => andamentos.push(passo);

try {
  const entrada = path.join(pasta, 'entrada.pdf');
  await pdfDeTeste(entrada);
  passou('o PDF de teste foi criado', (await fs.stat(entrada)).size > 0);

  console.log('\n— informar —');
  const info = await motor.executar('informar', { arquivos: [entrada] }).espera;
  passou('o motor respondeu', info.arquivos?.length === 1);
  passou('leu a contagem de páginas', info.arquivos[0].paginas === 1);
  passou('reconheceu o papel', info.arquivos[0].detalhePaginas[0].formato === 'A4');

  console.log('\n— tons de preto em K100 (o motivo de trocar o motor) —');
  const k100 = await motor.executar('tons-de-preto', {
    arquivos: [entrada],
    opcoes: { tinta: 'k100', dpi: 100, limite: 180 },
  }).espera;

  passou('gerou o arquivo', typeof k100.arquivo === 'string');
  passou('avisou o andamento', andamentos.length > 0, `${andamentos.length} passos`);
  passou(
    'gravou DeviceCMYK, sem perfil ICC no meio',
    colorspaceDaPrimeiraImagem(k100.arquivo) === '/DeviceCMYK',
    colorspaceDaPrimeiraImagem(k100.arquivo),
  );

  console.log('\n— erro do usuário chega legível —');
  let mensagem = '';
  try {
    await motor.executar('tons-de-preto', { arquivos: [path.join(pasta, 'nao-existe.pdf')] }).espera;
  } catch (erro) {
    mensagem = erro.message;
  }
  passou('a mensagem explica o problema', mensagem.includes('nao encontrei'), mensagem);

  console.log('\n— cancelar derruba o motor —');
  passou('cancelou', motor.cancelar() === true);
} finally {
  motor.desligar();
  await fs.rm(pasta, { recursive: true, force: true });
}

console.log(process.exitCode ? '\nalgo falhou' : '\ntudo certo');
