'use client';

/** Mexer na ordem, na quantidade e no arranjo das páginas. */

import { PAGE_SIZES, copy, desenharPaginaDeImagem, mmParaPt, openWithPdfLib, pintarFundoBranco, respirar, salvarPdf, senhaDaFila, tamanhoDaPagina } from '../nucleo';
import { type OutputFile, type PagePlanItem, type RunContext, type RunResult } from '../tipos';
import { parsePageRange, suffixName, yieldToBrowser } from '../../utils';
import { loadPdfLib } from '../lazy';

export async function merge(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  let inputBytes = 0;

  const canvas = document.createElement('canvas');
  const formatoImagem = String(ctx.options.formatoImagem ?? 'a4');
  const fundoBranco = ctx.options.fundoBranco !== false && ctx.options.fundoBranco !== 'false';
  let imagens = 0;

  for (let i = 0; i < ctx.files.length; i += 1) {
    const source = ctx.files[i];
    inputBytes += source.size;
    ctx.onProgress(i / ctx.files.length, `Juntando ${source.name}`);

    if (source.type.startsWith('image/')) {
      // Foto entra como página inteira, na mesma ordem em que foi solta.
      const bitmap = await createImageBitmap(new Blob([copy(source.bytes)], { type: source.type }));
      const pagina =
        formatoImagem === 'imagem'
          ? { largura: bitmap.width, altura: bitmap.height, seguirImagem: true }
          : tamanhoDaPagina({ formato: 'a4', orientacao: 'auto' }, bitmap.width, bitmap.height);
      await desenharPaginaDeImagem(out, canvas, bitmap, pagina, 0, 'proporcao');
      bitmap.close();
      imagens += 1;
    } else {
      const doc = await openWithPdfLib(source.bytes, source.senha);
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => {
        out.addPage(page);
        if (fundoBranco) pintarFundoBranco(out, page);
      });
    }

    await respirar(ctx);
  }

  const name = String(ctx.options.filename || 'documento-unido').replace(/[\\/:*?"<>|]/g, '') || 'documento-unido';
  const blob = await salvarPdf(out, senhaDaFila(ctx.files));
  ctx.onProgress(1);

  const notes: string[] = [];
  if (imagens > 0) notes.push(`${imagens} ${imagens === 1 ? 'imagem virou página' : 'imagens viraram páginas'}.`);
  if (ctx.files.some((f) => f.senha)) notes.push('O arquivo unido saiu sem senha.');

  return {
    files: [{ name: `${name}.pdf`, blob, pages: out.getPageCount() }],
    inputBytes,
    outputBytes: blob.size,
    notes,
  };
}

export async function split(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pageCount = doc.getPageCount();
  const mode = String(ctx.options.mode ?? 'every');

  const groups: { label: string; indices: number[] }[] = [];
  const notes: string[] = [];

  if (mode === 'every') {
    const size = Math.max(1, Number(ctx.options.every) || 1);
    for (let start = 0; start < pageCount; start += size) {
      const indices = Array.from({ length: Math.min(size, pageCount - start) }, (_, k) => start + k);
      groups.push({ label: `${start + 1}-${start + indices.length}`, indices });
    }
  } else if (mode === 'size') {
    const maxMb = Math.max(0.001, Number(ctx.options.maxSize) || 10);
    const maxBytes = maxMb * 1024 * 1024;

    let currentIndices: number[] = [];
    let currentDoc = await PDFDocument.create();

    for (let i = 0; i < pageCount; i += 1) {
      const [copiedPage] = await currentDoc.copyPages(doc, [i]);
      currentDoc.addPage(copiedPage);
      const testBytes = await currentDoc.save({ useObjectStreams: true });

      if (testBytes.length > maxBytes && currentIndices.length > 0) {
        const label = `${currentIndices[0] + 1}-${currentIndices[currentIndices.length - 1] + 1}`;
        groups.push({ label, indices: currentIndices });

        currentIndices = [i];
        currentDoc = await PDFDocument.create();
        const [newPage] = await currentDoc.copyPages(doc, [i]);
        currentDoc.addPage(newPage);
      } else {
        currentIndices.push(i);
      }
      await respirar(ctx);
    }

    if (currentIndices.length > 0) {
      const label = `${currentIndices[0] + 1}-${currentIndices[currentIndices.length - 1] + 1}`;
      groups.push({ label, indices: currentIndices });
    }
    notes.push(`Dividido por tamanho limite de ${maxMb} MB por parte.`);
  } else if (mode === 'extract') {
    const rawInput = String(ctx.options.extractRanges || ctx.options.ranges || '').trim();
    if (!rawInput) throw new Error('Informe pelo menos uma página ou intervalo, ex: 1, 3, 5-8.');
    const chunks = rawInput.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const indicesSet = new Set<number>();
    for (const chunk of chunks) {
      const rangeIndices = parsePageRange(chunk, pageCount);
      rangeIndices.forEach((idx) => indicesSet.add(idx));
    }
    const indices = Array.from(indicesSet).sort((a, b) => a - b);
    if (!indices.length) throw new Error('Nenhuma página válida foi selecionada para extração.');
    groups.push({ label: 'selecionadas', indices });
    notes.push(`${indices.length} página(s) extraída(s) para o novo PDF.`);
  } else {
    const chunks = String(ctx.options.ranges ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!chunks.length) throw new Error('Informe pelo menos um intervalo, ex: 1-3, 4-8.');
    for (const chunk of chunks) {
      groups.push({ label: chunk.replace(/\s+/g, ''), indices: parsePageRange(chunk, pageCount) });
    }
  }

  const outputs: OutputFile[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    ctx.onProgress(i / groups.length, `Gerando parte ${i + 1}/${groups.length}`);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(doc, groups[i].indices);
    pages.forEach((page) => out.addPage(page));
    const blob = await salvarPdf(out, source.senha);
    outputs.push({
      name: suffixName(source.name, `paginas-${groups[i].label}`),
      blob,
      pages: groups[i].indices.length,
    });
    await yieldToBrowser();
  }

  ctx.onProgress(1);
  return {
    files: outputs,
    inputBytes: source.size,
    outputBytes: outputs.reduce((sum, o) => sum + o.blob.size, 0),
    notes,
  };
}

export const PLAN_SUFFIX: Record<string, string> = {
  organize: 'organizado',
  remove: 'sem-paginas',
  keep: 'extraido',
  rotate: 'girado',
};

/**
 * Motor das quatro ferramentas que usam a grade de miniaturas. A grade publica
 * um plano com as páginas que ficam, em que ordem e com qual rotação. Aqui só
 * remontamos o documento seguindo esse plano.
 */
export async function applyPlan(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);
  const pageCount = doc.getPageCount();
  const board = String(ctx.options.board ?? 'organize');

  let plan: PagePlanItem[];
  try {
    plan = JSON.parse(String(ctx.options.plan ?? '[]'));
  } catch {
    throw new Error('Não foi possível ler a seleção de páginas.');
  }
  plan = plan.filter((item) => Number.isInteger(item.i) && item.i >= 0 && item.i < pageCount);

  if (!plan.length) {
    throw new Error(
      board === 'keep'
        ? 'Clique nas páginas que você quer guardar.'
        : 'O documento ficaria sem nenhuma página.',
    );
  }
  if (board === 'remove' && plan.length === pageCount) {
    throw new Error('Clique nas páginas que devem sair.');
  }
  if (board === 'rotate' && plan.every((item) => !item.r)) {
    throw new Error('Clique numa página para girá-la.');
  }

  ctx.onProgress(0.4, 'Remontando o documento');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    doc,
    plan.map((item) => item.i),
  );
  pages.forEach((page, index) => {
    const total = page.getRotation().angle + (plan[index].r ?? 0);
    page.setRotation(degrees(((total % 360) + 360) % 360));
    out.addPage(page);
  });

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  const removed = pageCount - plan.length;
  const rotated = plan.filter((item) => item.r).length;
  const notes: string[] = [];
  if (board === 'keep') {
    notes.push(`${plan.length} de ${pageCount} páginas no arquivo novo.`);
  } else if (removed > 0) {
    notes.push(`${removed} página${removed > 1 ? 's' : ''} removida${removed > 1 ? 's' : ''}.`);
  }
  if (rotated > 0) notes.push(`${rotated} página${rotated > 1 ? 's' : ''} girada${rotated > 1 ? 's' : ''}.`);

  return {
    files: [
      { name: suffixName(source.name, PLAN_SUFFIX[board] ?? 'editado'), blob, pages: plan.length },
    ],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes,
  };
}

/**
 * Grade de cada quantidade por folha, e se a folha deita.
 *
 * A regra é manter as celas o mais quadradas possível: 6 em pé fica 2x3, 6
 * deitado fica 3x2. Deitar a folha quando as colunas passam das linhas evita
 * cela espremida e sobra de papel nas laterais.
 */
export const GRADES: Record<number, { colunas: number; linhas: number; deitada: boolean }> = {
  2: { colunas: 1, linhas: 2, deitada: true },
  4: { colunas: 2, linhas: 2, deitada: false },
  6: { colunas: 2, linhas: 3, deitada: false },
  8: { colunas: 2, linhas: 4, deitada: false },
  9: { colunas: 3, linhas: 3, deitada: false },
  12: { colunas: 3, linhas: 4, deitada: false },
  16: { colunas: 4, linhas: 4, deitada: false },
};

/** As quantidades oferecidas, na ordem. */
export const POR_FOLHA = Object.keys(GRADES).map(Number);

export async function nUp(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await openWithPdfLib(source.bytes, source.senha);

  const pedido = Number(ctx.options.perSheet ?? 2);
  const porFolha = GRADES[pedido] ? pedido : 2;
  const { colunas, linhas, deitada } = GRADES[porFolha];

  // Espaçamento é o vão ENTRE as páginas. Margem é a sobra na beirada da
  // folha. Antes os dois eram a mesma coisa, e o resultado comia alguns
  // milímetros de cada lado sem ninguém pedir. O PDF não precisa de margem de
  // segurança: quem cuida disso é a impressora.
  const gap = mmParaPt(Math.min(Math.max(Number(ctx.options.espacamentoMm ?? 0), 0), 30));
  const margem = mmParaPt(Math.min(Math.max(Number(ctx.options.margemMm ?? 0), 0), 30));
  const border = ctx.options.border === true || ctx.options.border === 'true';

  const out = await PDFDocument.create();
  const embedded = await out.embedPages(doc.getPages());
  const [a4w, a4h] = PAGE_SIZES.a4;
  const folhaL = deitada ? a4h : a4w;
  const folhaA = deitada ? a4w : a4h;

  const celaL = (folhaL - margem * 2 - gap * (colunas - 1)) / colunas;
  const celaA = (folhaA - margem * 2 - gap * (linhas - 1)) / linhas;

  for (let inicio = 0; inicio < embedded.length; inicio += porFolha) {
    ctx.onProgress(inicio / embedded.length, `Folha ${Math.floor(inicio / porFolha) + 1}`);
    const folha = out.addPage([folhaL, folhaA]);

    for (let vaga = 0; vaga < porFolha && inicio + vaga < embedded.length; vaga += 1) {
      const item = embedded[inicio + vaga];
      const coluna = vaga % colunas;
      const linha = Math.floor(vaga / colunas);
      const x = margem + coluna * (celaL + gap);
      // A leitura começa em cima, mas o eixo Y do PDF cresce para cima.
      const y = folhaA - margem - (linha + 1) * celaA - linha * gap;

      const proporcao = Math.min(celaL / item.width, celaA / item.height);
      const larg = item.width * proporcao;
      const alt = item.height * proporcao;

      folha.drawPage(item, {
        x: x + (celaL - larg) / 2,
        y: y + (celaA - alt) / 2,
        xScale: proporcao,
        yScale: proporcao,
      });

      if (border) {
        folha.drawRectangle({
          x,
          y,
          width: celaL,
          height: celaA,
          borderColor: rgb(0.8, 0.8, 0.85),
          borderWidth: 0.7,
        });
      }
    }
    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, `${porFolha}-por-folha`), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `${embedded.length} páginas em ${out.getPageCount()} folhas, ${colunas} x ${linhas} por folha` +
        (deitada ? ', com a folha deitada.' : '.'),
    ],
  };
}

/** Inverte a ordem das páginas. Útil em digitalização feita de trás para frente. */
export async function reverse(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  const out = await PDFDocument.create();
  const indices = Array.from({ length: total }, (_, i) => total - 1 - i);
  const copiadas = await out.copyPages(origem, indices);
  for (const pagina of copiadas) {
    out.addPage(pagina);
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'invertido'), blob, pages: total }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [],
  };
}

/**
 * Intercala dois PDFs: página 1 do primeiro, página 1 do segundo, e assim por
 * diante. É o caso do escâner sem duplex, que gera um arquivo com as frentes e
 * outro com os versos — e os versos costumam sair na ordem contrária.
 */
export async function interleave(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const [primeiro, segundo] = ctx.files;
  if (!segundo) throw new Error('Escolha dois arquivos: um com as frentes e outro com os versos.');

  const docA = await openWithPdfLib(primeiro.bytes, primeiro.senha);
  const docB = await openWithPdfLib(segundo.bytes, segundo.senha);
  const inverterSegundo = ctx.options.reverseSecond !== false;

  const out = await PDFDocument.create();
  const totalA = docA.getPageCount();
  const totalB = docB.getPageCount();

  const paginasA = await out.copyPages(docA, Array.from({ length: totalA }, (_, i) => i));
  const ordemB = Array.from({ length: totalB }, (_, i) => (inverterSegundo ? totalB - 1 - i : i));
  const paginasB = await out.copyPages(docB, ordemB);

  const maior = Math.max(totalA, totalB);
  for (let i = 0; i < maior; i += 1) {
    if (i < totalA) out.addPage(paginasA[i]);
    if (i < totalB) out.addPage(paginasB[i]);
    ctx.onProgress(i / maior, `Intercalando ${i + 1}/${maior}`);
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, senhaDaFila(ctx.files));
  const notes: string[] = [];
  if (totalA !== totalB) {
    notes.push(
      `Os arquivos têm ${totalA} e ${totalB} páginas. As que sobraram foram para o fim, na ordem em que estavam.`,
    );
  }

  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(primeiro.name, 'intercalado'), blob, pages: totalA + totalB }],
    inputBytes: primeiro.size + segundo.size,
    outputBytes: blob.size,
    notes,
  };
}

/**
 * Corta cada página em duas ou quatro partes, cada uma virando página própria.
 *
 * É o contrário de "Várias por folha", e o caso comum é livro digitalizado:
 * o escâner pega as duas páginas abertas numa imagem só e aqui elas se separam.
 */
export async function splitPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const modo = String(ctx.options.mode ?? 'vertical');
  const paginas = origem.getPages();

  const out = await PDFDocument.create();

  for (let i = 0; i < paginas.length; i += 1) {
    ctx.onProgress(i / paginas.length, `Página ${i + 1}/${paginas.length}`);
    const { width, height } = paginas[i].getSize();

    // Cada recorte é uma fatia da página original, de baixo para cima e da
    // esquerda para a direita — mas a leitura começa em cima, então as linhas
    // saem na ordem inversa.
    const recortes =
      modo === 'horizontal'
        ? [
            { left: 0, bottom: height / 2, right: width, top: height },
            { left: 0, bottom: 0, right: width, top: height / 2 },
          ]
        : modo === 'quatro'
          ? [
              { left: 0, bottom: height / 2, right: width / 2, top: height },
              { left: width / 2, bottom: height / 2, right: width, top: height },
              { left: 0, bottom: 0, right: width / 2, top: height / 2 },
              { left: width / 2, bottom: 0, right: width, top: height / 2 },
            ]
          : [
              { left: 0, bottom: 0, right: width / 2, top: height },
              { left: width / 2, bottom: 0, right: width, top: height },
            ];

    for (const recorte of recortes) {
      const embutida = await out.embedPage(paginas[i], recorte);
      const larguraParte = recorte.right - recorte.left;
      const alturaParte = recorte.top - recorte.bottom;
      out
        .addPage([larguraParte, alturaParte])
        .drawPage(embutida, { x: 0, y: 0, width: larguraParte, height: alturaParte });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'dividido'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`Cada página virou ${modo === 'quatro' ? 'quatro' : 'duas'}: ${paginas.length} entraram, ${out.getPageCount()} saíram.`],
  };
}

/**
 * Monta o documento para virar livreto: imprima frente e verso na borda curta,
 * dobre a pilha ao meio e as páginas caem na ordem certa.
 *
 * Cada folha A4 deitada recebe duas páginas. Numa brochura grampeada no vinco,
 * a primeira folha carrega a última página e a primeira juntas, a segunda
 * carrega a penúltima e a segunda, e assim por diante.
 */
export async function booklet(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  // A dobra só fecha em múltiplo de 4; o que falta entra como página em branco.
  const comBrancos = Math.ceil(total / 4) * 4;
  const primeira = origem.getPage(0).getSize();
  const larguraFolha = primeira.width * 2;
  const alturaFolha = primeira.height;

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(origem.getPages());

  const ordem: (number | null)[] = [];
  for (let i = 0; i < comBrancos / 2; i += 2) {
    ordem.push(comBrancos - 1 - i, i); // frente da folha
    ordem.push(i + 1, comBrancos - 2 - i); // verso
  }

  for (let i = 0; i < ordem.length; i += 2) {
    ctx.onProgress(i / ordem.length, `Montando folha ${Math.floor(i / 2) + 1}`);
    const folha = out.addPage([larguraFolha, alturaFolha]);
    for (const [posicao, indice] of [ordem[i], ordem[i + 1]].entries()) {
      if (indice === null || indice >= total) continue;
      folha.drawPage(embutidas[indice], {
        x: posicao * primeira.width,
        y: 0,
        width: primeira.width,
        height: alturaFolha,
      });
    }
    await respirar(ctx);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'livreto'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Imprima frente e verso virando na borda curta, dobre a pilha ao meio e grampeie no vinco.',
      ...(comBrancos !== total ? [`Foram somadas ${comBrancos - total} página(s) em branco para fechar a dobra.`] : []),
    ],
  };
}

/** Separa o documento em dois: um com as páginas ímpares, outro com as pares. */
export async function oddEven(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const total = origem.getPageCount();

  const impares = Array.from({ length: total }, (_, i) => i).filter((i) => i % 2 === 0);
  const pares = Array.from({ length: total }, (_, i) => i).filter((i) => i % 2 === 1);

  const saidas: OutputFile[] = [];
  let outputBytes = 0;

  for (const [rotulo, indices] of [
    ['impares', impares],
    ['pares', pares],
  ] as const) {
    if (!indices.length) continue;
    ctx.onProgress(rotulo === 'impares' ? 0.2 : 0.6, `Separando as ${rotulo}`);
    const out = await PDFDocument.create();
    for (const pagina of await out.copyPages(origem, indices)) out.addPage(pagina);
    const blob = await salvarPdf(out, source.senha);
    outputBytes += blob.size;
    saidas.push({ name: suffixName(source.name, rotulo), blob, pages: indices.length });
    await respirar(ctx);
  }

  ctx.onProgress(1);
  return {
    files: saidas,
    inputBytes: source.size,
    outputBytes,
    notes: [`${impares.length} página(s) ímpar(es) e ${pares.length} par(es), contando a partir de 1.`],
  };
}

/** Insere folhas em branco, para imprimir frente e verso ou tomar nota. */
export async function blankPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const origem = await openWithPdfLib(source.bytes, source.senha);
  const onde = String(ctx.options.where ?? 'depois-de-cada');
  const quantas = Math.max(1, Math.min(10, Math.round(Number(ctx.options.count ?? 1))));
  const total = origem.getPageCount();

  const out = await PDFDocument.create();
  const copiadas = await out.copyPages(origem, Array.from({ length: total }, (_, i) => i));

  const branco = (referencia: { width: number; height: number }) =>
    out.addPage([referencia.width, referencia.height]);

  if (onde === 'no-inicio') {
    const tamanho = origem.getPage(0).getSize();
    for (let n = 0; n < quantas; n += 1) branco(tamanho);
  }

  for (let i = 0; i < copiadas.length; i += 1) {
    ctx.onProgress(i / copiadas.length, `Página ${i + 1}/${total}`);
    const tamanho = copiadas[i].getSize();
    out.addPage(copiadas[i]);
    if (onde === 'depois-de-cada' && i < copiadas.length - 1) {
      for (let n = 0; n < quantas; n += 1) branco(tamanho);
    }
    await respirar(ctx);
  }

  if (onde === 'no-fim') {
    const tamanho = origem.getPage(total - 1).getSize();
    for (let n = 0; n < quantas; n += 1) branco(tamanho);
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'com-brancos'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [`O documento saiu com ${out.getPageCount()} páginas; entrou com ${total}.`],
  };
}
