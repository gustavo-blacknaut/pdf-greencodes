/**
 * Prova a geometria da impressão sem gastar papel.
 *
 * O defeito relatado foi "está imprimindo um A5 no meio do A4". A causa: o
 * CSS declarava a folha pelo **nome** (`@page { size: A4 }`), que traz a
 * orientação junto, enquanto a orientação de verdade ia separada, no
 * `landscape` da chamada. Com os dois discordando, o driver encolhia o
 * trabalho por 210/297 — 0,707 — e a arte saía com metade da área no meio da
 * folha.
 *
 * Os testes de unidade provam que o CSS agora pede milímetros na ordem certa.
 * O que eles **não** alcançam é a pergunta final: o Chromium, recebendo esse
 * HTML com essas opções, entrega uma folha inteira?
 *
 * Aqui o `printToPDF` responde. Ele passa pela mesma montagem de página do
 * `print`, e o PDF que sai pode ser medido — primeiro a folha, e depois, pelo
 * MuPDF, onde a tinta caiu dentro dela.
 *
 * Conferido reintroduzindo o defeito de propósito: a folha deitada volta a
 * 50,1% de cobertura, metade exata da área, e o script reprova.
 *
 *   npm run provar-impressao
 */

import { app, BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const PT_POR_MM = 72 / 25.4;
const A4 = { largura: 210, altura: 297 };

/** Lê o montarHtml do módulo sem carregar o resto, como o teste de unidade faz. */
function carregarMontarHtml() {
  const arquivo = path.join(process.cwd(), 'electron', 'impressao.js');
  const fonte = readFileSync(arquivo, 'utf8');
  const corpo = fonte.slice(fonte.indexOf('const PAPEL_MM'), fonte.indexOf('async function preparar'));
  const montar = fonte.slice(fonte.indexOf('const AJUSTES'), fonte.indexOf('/** Espera as imagens'));
  return new Function('path', `${corpo}\n${montar}\nreturn montarHtml;`)(path);
}

/**
 * Uma "página" toda preta, na medida pedida.
 *
 * A proporção importa e já enganou este script. Com uma arte de 4 por 3 numa
 * folha A4 em pé, o ajuste "cabe na página" deixa branco em cima e embaixo
 * **por causa da proporção** — 53% de cobertura, que parece o defeito e não
 * é. Dando à arte a mesma proporção da folha, o certo passa a ser 100%, e
 * qualquer branco que sobre é encolhimento de verdade.
 *
 * Sai em PNG, e não num formato mais simples de escrever à mão: o Chromium
 * não decodifica PPM nem PGM, e a página carregaria sem a imagem — o que
 * mediria a folha certa por acaso, com o HTML vazio.
 */
function paginaDeTeste(pasta, nome, largura, altura) {
  const crcTabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTabela[n] = c >>> 0;
  }
  const crc = (dados) => {
    let c = 0xffffffff;
    for (const b of dados) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pedaco = (tipo, corpo) => {
    const inteiro = Buffer.concat([Buffer.from(tipo, 'latin1'), corpo]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(corpo.length);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc(inteiro));
    return Buffer.concat([tamanho, inteiro, soma]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 0; // tons de cinza

  // Uma linha de filtro zero mais os pixels, tudo em preto.
  const bruto = Buffer.alloc(altura * (1 + largura), 0);
  const idat = deflateSync(bruto);

  const png = path.join(pasta, nome);
  writeFileSync(
    png,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pedaco('IHDR', ihdr),
      pedaco('IDAT', idat),
      pedaco('IEND', Buffer.alloc(0)),
    ]),
  );
  return png;
}

/**
 * As medidas da folha, lidas do PDF gerado.
 *
 * Atenção ao que isto **não** responde. A primeira versão deste script parava
 * aqui, e teria aprovado o defeito original sem piscar: a folha nunca esteve
 * errada. O que estava errado era a arte, encolhida por 0,707 no meio de uma
 * folha do tamanho certo.
 *
 * Por isso o script grava os PDFs e a medição de tinta é feita depois, pelo
 * MuPDF, que sabe rasterizar. Ver `provar-impressao.py`.
 */
function medirFolha(pdf) {
  const texto = pdf.toString('latin1');
  const caixa = texto.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!caixa) throw new Error('não achei o MediaBox no PDF gerado');
  return {
    larguraMm: (Number(caixa[3]) - Number(caixa[1])) / PT_POR_MM,
    alturaMm: (Number(caixa[4]) - Number(caixa[2])) / PT_POR_MM,
  };
}

/**
 * Uma janela só para os dois casos.
 *
 * Destruir e recriar entre um caso e outro fazia o segundo `loadFile` voltar
 * `ERR_FAILED`: a janela nova nascia enquanto a anterior ainda estava sendo
 * desmontada. Reaproveitar evita a corrida — e é o que o aplicativo faz de
 * verdade, uma janela escondida por trabalho.
 */
async function gerar(janela, html, opcoes) {
  await janela.loadFile(html);
  // O `print` de verdade espera as imagens carregarem antes; aqui o mesmo.
  await janela.webContents.executeJavaScript(
    'Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((p) => { i.onload = p; i.onerror = p; })))',
  );
  // O mesmo que o enviar() faz: posicionar so depois de as imagens
  // carregarem, senao o tamanho real de cada pagina e zero.
  await janela.webContents.executeJavaScript('window.__posicionar ? (window.__posicionar(), true) : false');
  return janela.webContents.printToPDF(opcoes);
}

async function principal() {
  await app.whenReady();

  const montarHtml = carregarMontarHtml();
  // Os PDFs ficam num lugar conhecido: quem mede a tinta e o MuPDF, depois.
  const pasta = path.join(process.cwd(), 'dist-app', '.prova-impressao');
  mkdirSync(pasta, { recursive: true });

  const casos = [
    { nome: 'A4 em pé', paisagem: false, esperado: A4, arte: [420, 594] },
    { nome: 'A4 deitada', paisagem: true, esperado: { largura: A4.altura, altura: A4.largura }, arte: [594, 420] },
    // Metade do tamanho, no centro: a tinta tem que cobrir um quarto da área.
    { nome: 'A4 a 100%', paisagem: false, esperado: A4, arte: [595, 842], extras: { escala: 'original', dpi: 72 }, cobertura: [0.97, 1.01] },
    { nome: 'A4 a 50%', paisagem: false, esperado: A4, arte: [595, 842], extras: { escala: 'porcento', escalaPorcento: 50, dpi: 72 }, cobertura: [0.24, 0.26] },
    // Marcas de corte: a arte encolhe e aparecem oito riscos em volta.
    // 60% da folha da 36% de area; as oito marcas somam quase nada.
    { nome: 'com marcas', paisagem: false, esperado: A4, arte: [595, 842], extras: { escala: 'porcento', escalaPorcento: 60, dpi: 72, marcasCorte: true }, cobertura: [0.35, 0.38] },
    // Deslocada 20 mm para a direita: parte sai da folha e a tinta cai.
    { nome: 'deslocada', paisagem: false, esperado: A4, arte: [595, 842], extras: { escala: 'original', dpi: 72, deslocaXmm: 20 }, cobertura: [0.88, 0.92] },
  ];

  const janela = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const casos_medidos = [];
  let falhou = false;

  for (const caso of casos) {
    // A arte tem a proporção da folha: assim o certo é cobrir tudo, e
    // qualquer sobra de branco é encolhimento de verdade.
    const pagina = paginaDeTeste(pasta, `arte-${caso.paisagem ? 'deitada' : 'em-pe'}.png`, caso.arte[0], caso.arte[1]);
    const html = path.join(pasta, `folha-${caso.paisagem ? 'deitada' : 'em-pe'}.html`);
    writeFileSync(
      html,
      montarHtml([pagina], 'A4', { paisagem: caso.paisagem, margemLadosMm: 0, margemCimaMm: 0, ajuste: 'pagina', ...(caso.extras ?? {}) }),
      'utf8',
    );

    const pdf = await gerar(janela, html, {
      pageSize: 'A4',
      landscape: caso.paisagem,
      margins: { marginType: 'none' },
      printBackground: true,
    });

    const apelido = caso.nome.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    writeFileSync(path.join(pasta, apelido + '.pdf'), pdf);
    casos_medidos.push({ arquivo: apelido + '.pdf', nome: caso.nome, cobertura: caso.cobertura ?? [0.97, 1.01] });
    const medida = medirFolha(pdf);
    const alvo = caso.esperado;
    const bate =
      Math.abs(medida.larguraMm - alvo.largura) < 2 && Math.abs(medida.alturaMm - alvo.altura) < 2;

    console.log(
      `  ${caso.nome.padEnd(12)} folha ${medida.larguraMm.toFixed(0)}x${medida.alturaMm.toFixed(0)} mm ` +
        `(esperado ${alvo.largura}x${alvo.altura})  ${bate ? 'OK' : 'ERRADO'}`,
    );

    if (!bate) {
      falhou = true;
      const encolhimento = medida.larguraMm / alvo.largura;
      if (Math.abs(encolhimento - 0.707) < 0.05) {
        console.log('     ^ 0,707 é a assinatura do defeito antigo: o CSS e o driver discordando.');
      }
    }
  }

  janela.destroy();

  if (falhou) {
    console.log('\nREPROVOU já na medida da folha.');
    app.exit(1);
    return;
  }

  /*
   * A medida da folha não basta, e é o ponto todo deste script: a folha nunca
   * esteve errada. O que estava errado era a arte, encolhida por 0,707 no
   * meio de uma folha do tamanho certo.
   *
   * Quem sabe rasterizar aqui é o MuPDF, então a segunda metade roda no
   * Python do motor. Chamar daqui, em vez de encadear no `npm run`, evita o
   * caminho com barra invertida — que o cmd do Windows come.
   */
  // A lista do que medir, para o Python saber o que esperar de cada folha.
  writeFileSync(path.join(pasta, 'casos.json'), JSON.stringify(casos_medidos, null, 1));

  console.log('\n  Medindo onde a tinta caiu...\n');
  const python = path.join(process.cwd(), 'motor', 'runtime', 'python.exe');
  const medicao = spawnSync(python, [path.join('scripts', 'provar-impressao.py')], { encoding: 'utf8' });

  if (medicao.error) {
    console.log(`  não consegui rodar o motor (${medicao.error.message}).`);
    console.log('  Os PDFs ficaram em', pasta);
    app.exit(2);
    return;
  }

  process.stdout.write(medicao.stdout ?? '');
  if (medicao.stderr?.trim()) process.stderr.write(medicao.stderr);
  app.exit(medicao.status ?? 0);
}

principal().catch((erro) => {
  console.error('falhou:', erro.message);
  app.exit(2);
});
