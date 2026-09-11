/**
 * Prova a impressão sem gastar papel.
 *
 * O defeito relatado foi "está imprimindo um A5 no meio do A4". A geometria da
 * folha é conferida pelos testes de `lib/impressao/folha.test.ts`, que são
 * matemática pura e rodam em milissegundos. O que eles **não** alcançam é a
 * pergunta final: a folha que montamos, entregue ao `impressora.exe` e ao
 * driver do Windows, cai inteira no papel?
 *
 * Aqui a impressora "Microsoft Print to PDF" responde. Ela é o mesmo caminho
 * de qualquer impressora de verdade — passa pelo spooler, pelo DEVMODE e pelo
 * `PrintDocument` — só que o resultado sai num arquivo que dá para medir.
 *
 * E a medição não é por amostragem: o PDF gerado guarda a matriz que posiciona
 * a imagem na página, em pontos. Lendo `MediaBox` e essa matriz sabemos o
 * tamanho da folha **e** o tamanho da tinta dentro dela — que é o par que
 * denuncia o defeito. Medir só a folha teria aprovado o defeito original sem
 * piscar: a folha nunca esteve errada.
 *
 *   npm run provar-impressao
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMPRESSORA_EXE = path.join(RAIZ, 'impressora', 'impressora.exe');
const PASTA = path.join(RAIZ, '.prova-impressao');
const PT_POR_MM = 72 / 25.4;
const DPI = 300;

/** Os papéis da tela, em milímetros e sempre em pé, com o código do driver. */
const PAPEIS = {
  A3: { largura: 297, altura: 420, codigo: 8 },
  A4: { largura: 210, altura: 297, codigo: 9 },
  A5: { largura: 148, altura: 210, codigo: 11 },
  Letter: { largura: 216, altura: 279, codigo: 1 },
};

/* ------------------------------------------------------------ a folha de teste */

/**
 * Uma folha toda preta, na medida exata do papel.
 *
 * A proporção importa e já enganou um script destes: com uma arte de proporção
 * diferente da folha, sobra branco **por causa da proporção** e isso parece o
 * defeito sem ser. Dando à folha de teste a medida exata do papel, o certo
 * passa a ser cobrir tudo, e qualquer sobra é encolhimento de verdade.
 */
function folhaDeTeste(destino, larguraPx, alturaPx) {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  const crc = (dados) => {
    let c = 0xffffffff;
    for (const b of dados) c = tabela[(c ^ b) & 0xff] ^ (c >>> 8);
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
  ihdr.writeUInt32BE(larguraPx, 0);
  ihdr.writeUInt32BE(alturaPx, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;

  const bruto = Buffer.alloc(alturaPx * (1 + larguraPx), 0);
  writeFileSync(
    destino,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pedaco('IHDR', ihdr),
      pedaco('IDAT', deflateSync(bruto)),
      pedaco('IEND', Buffer.alloc(0)),
    ]),
  );
  return destino;
}

/* ------------------------------------------------------------------- medição */

/** O tamanho da folha, lido do MediaBox. */
function folhaDoPdf(pdf) {
  const texto = pdf.toString('latin1');
  const caixa = texto.match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/);
  if (!caixa) throw new Error('não achei o MediaBox no PDF gerado');
  return {
    largura: (Number(caixa[3]) - Number(caixa[1])) / PT_POR_MM,
    altura: (Number(caixa[4]) - Number(caixa[2])) / PT_POR_MM,
  };
}

/** Multiplica duas matrizes de PDF: primeiro `m`, depois `n`. */
function compor(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/**
 * O tamanho da tinta, lido da matriz que posiciona a imagem.
 *
 * `/Xxx Do` desenha a imagem num quadrado de lado 1, e é a matriz corrente que
 * a estica até o tamanho de verdade. Corrente, e não a última: o "Microsoft
 * Print to PDF" abre a página com `0.75 0 0 0.75 0 0 cm` para trabalhar em 96
 * por polegada em vez de 72, e ler só o `cm` colado no `Do` dá um terço a mais
 * — foi assim que uma folha perfeita apareceu aqui como 177% de cobertura.
 *
 * Então as matrizes são compostas, com a pilha de `q` e `Q`, como um leitor de
 * PDF faria. Aí a medida é exata, sem amostragem.
 */
function tintaDoPdf(pdf) {
  let maior = null;

  for (const fluxo of fluxos(pdf)) {
    const simbolos = fluxo.toString('latin1').split(/\s+/);
    let ctm = [1, 0, 0, 1, 0, 0];
    const pilha = [];

    for (let i = 0; i < simbolos.length; i += 1) {
      const simbolo = simbolos[i];

      if (simbolo === 'q') {
        pilha.push([...ctm]);
      } else if (simbolo === 'Q') {
        ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0];
      } else if (simbolo === 'cm' && i >= 6) {
        const m = simbolos.slice(i - 6, i).map(Number);
        if (m.every(Number.isFinite)) ctm = compor(m, ctm);
      } else if (simbolo === 'Do' && i >= 1 && simbolos[i - 1].startsWith('/')) {
        const largura = Math.hypot(ctm[0], ctm[1]) / PT_POR_MM;
        const altura = Math.hypot(ctm[2], ctm[3]) / PT_POR_MM;
        if (!Number.isFinite(largura) || !Number.isFinite(altura)) continue;
        if (!maior || largura * altura > maior.largura * maior.altura) {
          maior = { largura, altura, x: ctm[4] / PT_POR_MM, y: ctm[5] / PT_POR_MM };
        }
      }
    }
  }

  return maior;
}

/** Todo fluxo do PDF, descomprimido quando dá. */
function* fluxos(pdf) {
  const marca = Buffer.from('stream');
  const fim = Buffer.from('endstream');
  let de = 0;

  while (de < pdf.length) {
    const inicio = pdf.indexOf(marca, de);
    if (inicio === -1) return;
    const termina = pdf.indexOf(fim, inicio);
    if (termina === -1) return;

    // Pula o "stream" e a quebra de linha que vem logo depois dele.
    let corpo = inicio + marca.length;
    if (pdf[corpo] === 0x0d) corpo += 1;
    if (pdf[corpo] === 0x0a) corpo += 1;

    const bruto = pdf.subarray(corpo, termina);
    try {
      yield inflateSync(bruto);
    } catch {
      yield bruto;
    }
    de = termina + fim.length;
  }
}

/* ------------------------------------------------------------------ impressão */

function impressoraVirtual() {
  const saida = execFileSync(IMPRESSORA_EXE, ['listar'], { encoding: 'utf8' });
  const nomes = (JSON.parse(saida).impressoras ?? []).map((item) => item.nome);
  return nomes.find((nome) => /print to pdf/i.test(nome)) ?? null;
}

function imprimir(impressora, imagem, destino, papel, paisagem) {
  const lista = path.join(PASTA, 'folhas.txt');
  writeFileSync(lista, imagem, 'utf8');
  rmSync(destino, { force: true });

  const argumentos = [
    'imprimir',
    '--impressora', impressora,
    '--paginas', lista,
    '--papel', String(papel),
    '--arquivo', destino,
    '--titulo', 'prova de impressao',
  ];
  if (paisagem) argumentos.push('--paisagem');

  execFileSync(IMPRESSORA_EXE, argumentos, { encoding: 'utf8' });
  return esperarOArquivo(destino);
}

/**
 * O spooler escreve o PDF depois que o `Print()` já voltou.
 *
 * Ler cedo demais pega o arquivo pela metade, e o MediaBox sai de um PDF
 * truncado. Esperar o tamanho parar de crescer é o sinal de que terminou.
 */
function esperarOArquivo(destino, limiteMs = 30_000) {
  const ate = Date.now() + limiteMs;
  let anterior = -1;
  let estavel = 0;

  while (Date.now() < ate) {
    if (existsSync(destino)) {
      const agora = readFileSync(destino).length;
      if (agora > 0 && agora === anterior) {
        estavel += 1;
        if (estavel >= 2) return readFileSync(destino);
      } else {
        estavel = 0;
      }
      anterior = agora;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`o PDF não apareceu em ${destino}`);
}

/* ---------------------------------------------------------------- o programa */

function principal() {
  if (!existsSync(IMPRESSORA_EXE)) {
    console.error('Não achei o impressora.exe. Rode antes: npm run impressora');
    return 1;
  }

  const impressora = impressoraVirtual();
  if (!impressora) {
    console.log('Nenhuma impressora "Print to PDF" instalada; nada para provar aqui.');
    return 0;
  }

  mkdirSync(PASTA, { recursive: true });
  console.log(`Provando pela "${impressora}", a ${DPI} DPI.\n`);

  const casos = [
    { papel: 'A4', paisagem: false },
    { papel: 'A4', paisagem: true },
    { papel: 'A5', paisagem: false },
    { papel: 'A3', paisagem: false },
    { papel: 'Letter', paisagem: false },
  ];

  let falhou = false;

  for (const caso of casos) {
    const medida = PAPEIS[caso.papel];
    const folha = caso.paisagem
      ? { largura: medida.altura, altura: medida.largura }
      : { largura: medida.largura, altura: medida.altura };

    const apelido = `${caso.papel}${caso.paisagem ? '-deitada' : ''}`;
    const imagem = folhaDeTeste(
      path.join(PASTA, `${apelido}.png`),
      Math.round((folha.largura * DPI) / 25.4),
      Math.round((folha.altura * DPI) / 25.4),
    );

    const pdf = imprimir(
      impressora,
      imagem,
      path.join(PASTA, `${apelido}.pdf`),
      medida.codigo,
      caso.paisagem,
    );

    const saiu = folhaDoPdf(pdf);
    const tinta = tintaDoPdf(pdf);

    const folhaBate =
      Math.abs(saiu.largura - folha.largura) < 2 && Math.abs(saiu.altura - folha.altura) < 2;
    const cobertura = tinta
      ? (tinta.largura * tinta.altura) / (folha.largura * folha.altura)
      : 0;
    const tintaBate = cobertura > 0.97 && cobertura < 1.03;
    const ok = folhaBate && tintaBate;
    if (!ok) falhou = true;

    console.log(
      `  ${apelido.padEnd(12)} folha ${saiu.largura.toFixed(0)}x${saiu.altura.toFixed(0)} mm ` +
        `(pedido ${folha.largura}x${folha.altura})   ` +
        `tinta ${tinta ? `${tinta.largura.toFixed(0)}x${tinta.altura.toFixed(0)} mm, ${(cobertura * 100).toFixed(1)}%` : 'não achei'}` +
        `   ${ok ? 'OK' : 'ERRADO'}`,
    );

    if (!folhaBate) {
      console.log(`     ^ a folha saiu no tamanho errado: o --papel ${medida.codigo} não pegou.`);
    } else if (tinta && cobertura > 0.45 && cobertura < 0.55) {
      console.log('     ^ metade da área: o encolhimento de 0,707 voltou.');
    } else if (!tintaBate) {
      console.log('     ^ a arte não preencheu a folha.');
    }
  }

  console.log(
    falhou
      ? '\nREPROVOU — a impressão não está entregando a folha inteira.'
      : '\nA folha sai inteira, do tamanho pedido, nos cinco papéis.',
  );
  return falhou ? 1 : 0;
}

process.exit(principal());
