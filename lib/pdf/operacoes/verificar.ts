'use client';

/**
 * Conferência antes de mandar para a máquina.
 *
 * O prejuízo de uma gráfica quase nunca é um arquivo que não abre: é um que
 * abre, imprime, e só na hora de entregar aparece a foto serrilhada ou a
 * fonte trocada. Esta ferramenta procura essas três coisas antes da tiragem —
 * medida da página, resolução das imagens e fonte embutida.
 *
 * O relatório diz também o que NÃO foi conferido. Ferramenta de conferência
 * que só lista acerto ensina a confiar onde não deve.
 */

import { openWithPdfJs, openWithPdfLib, renderPageToCanvas, respirar } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { replaceExtension } from '../../utils';
import { loadPdfJs, loadPdfLib } from '../lazy';

/** Abaixo disto a foto sai serrilhada em papel. É o número que a gráfica usa. */
const DPI_MINIMO = 300;
/** Abaixo disto não é "meio ruim", é inaceitável em qualquer tamanho. */
const DPI_CRITICO = 150;

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

type Matriz = [number, number, number, number, number, number];
const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/** Multiplicação de matriz do PDF: `m` aplicada antes de `base`. */
export function multiplicar(m: Matriz, base: Matriz): Matriz {
  return [
    m[0] * base[0] + m[1] * base[2],
    m[0] * base[1] + m[1] * base[3],
    m[2] * base[0] + m[3] * base[2],
    m[2] * base[1] + m[3] * base[3],
    m[4] * base[0] + m[5] * base[2] + base[4],
    m[4] * base[1] + m[5] * base[3] + base[5],
  ];
}

type Achado = { pagina: number; pixels: string; desenhadaMm: string; dpi: number };

/**
 * A resolução com que cada imagem realmente sai no papel.
 *
 * Não é a resolução do arquivo da imagem: é ela dividida pelo tamanho em que
 * a imagem foi colocada na página. Uma foto de 2000 px que ocupa 5 cm sai
 * ótima; a mesma foto num banner de 1 m sai borrada. Só o desenho na página
 * responde isso, por isso rastreamos a matriz de transformação.
 */
async function conferirImagens(ctx: RunContext, bytes: ArrayBuffer, senha?: string): Promise<Achado[]> {
  const pdfjs = await loadPdfJs();
  const doc = await openWithPdfJs(bytes, senha);
  const rascunho = document.createElement('canvas');
  const achados: Achado[] = [];

  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      ctx.onProgress(0.15 + (0.7 * (p - 1)) / doc.numPages, `Conferindo a página ${p}/${doc.numPages}`);
      const page = await doc.getPage(p);

      // O pdf.js só materializa os XObjects de imagem depois de rasterizar a
      // página. Sem esta renderização descartável, o objs.get() abaixo espera
      // por um objeto que nunca chega. (Mesma armadilha de `extractImages`.)
      await renderPageToCanvas(page, 12, rascunho);
      const ops = await page.getOperatorList();

      let estado: Matriz = [...IDENTIDADE] as Matriz;
      const pilha: Matriz[] = [];

      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];

        if (fn === pdfjs.OPS.save) {
          pilha.push([...estado] as Matriz);
        } else if (fn === pdfjs.OPS.restore) {
          estado = pilha.pop() ?? ([...IDENTIDADE] as Matriz);
        } else if (fn === pdfjs.OPS.transform) {
          estado = multiplicar(args as Matriz, estado);
        } else if (fn === pdfjs.OPS.paintFormXObjectBegin) {
          pilha.push([...estado] as Matriz);
          if (Array.isArray(args[0])) estado = multiplicar(args[0] as Matriz, estado);
        } else if (fn === pdfjs.OPS.paintFormXObjectEnd) {
          estado = pilha.pop() ?? ([...IDENTIDADE] as Matriz);
        } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          try {
            const arg = args[0];
            let imagem: { width: number; height: number } | null = null;

            if (fn === pdfjs.OPS.paintInlineImageXObject) {
              imagem = arg as { width: number; height: number };
            } else {
              const id = String(arg);
              const loja = page.commonObjs.has(id) ? page.commonObjs : page.objs;
              imagem = (await Promise.race([
                new Promise((resolve) => loja.get(id, resolve)),
                new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
              ])) as { width: number; height: number } | null;
            }
            if (!imagem?.width || !imagem?.height) continue;

            // A imagem é desenhada dentro do quadrado unitário, deformado
            // pela matriz. O comprimento de cada vetor-coluna é o tamanho
            // real em pontos, mesmo com a imagem girada.
            const larguraPt = Math.hypot(estado[0], estado[1]);
            const alturaPt = Math.hypot(estado[2], estado[3]);
            if (larguraPt < 1 || alturaPt < 1) continue;

            const dpi = Math.min((imagem.width * 72) / larguraPt, (imagem.height * 72) / alturaPt);
            achados.push({
              pagina: p,
              pixels: `${imagem.width}x${imagem.height} px`,
              desenhadaMm: `${emMm(larguraPt)}x${emMm(alturaPt)} mm`,
              dpi: Math.round(dpi),
            });
          } catch {
            // Uma imagem ilegível não invalida a conferência das outras.
          }
          await respirar(ctx);
        }
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return achados;
}

/**
 * Quais fontes estão embutidas no arquivo.
 *
 * Fonte não embutida é substituída pela máquina por outra parecida, e a
 * largura do texto muda: quebra de linha em outro lugar, título que passa da
 * caixa. Vemos isso pelo descritor — `FontFile`, `FontFile2` ou `FontFile3`
 * presente quer dizer que o desenho da letra veio junto no arquivo.
 */
export async function conferirFontes(bytes: ArrayBuffer, senha?: string): Promise<{ embutidas: string[]; soltas: string[] }> {
  const { PDFArray, PDFDict, PDFName } = await loadPdfLib();
  const doc = await openWithPdfLib(bytes, senha);
  const embutidas = new Set<string>();
  const soltas = new Set<string>();

  const ARQUIVOS = [PDFName.of('FontFile'), PDFName.of('FontFile2'), PDFName.of('FontFile3')];

  for (const pagina of doc.getPages()) {
    const fontes = pagina.node.normalizedEntries().Font;
    if (!fontes) continue;

    for (const [, valor] of fontes.asMap()) {
      const fonte = doc.context.lookupMaybe(valor, PDFDict);
      if (!fonte) continue;

      // Nome de subconjunto vem com prefixo "ABCDEF+": é ruído para quem lê.
      const nome = String(fonte.get(PDFName.of('BaseFont')) ?? '')
        .replace(/^\//, '')
        .replace(/^[A-Z]{6}\+/, '');

      // Fonte composta guarda o descritor na descendente, não nela mesma.
      const descendentes = fonte.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
      const alvo =
        descendentes && descendentes.size() > 0
          ? (doc.context.lookupMaybe(descendentes.get(0), PDFDict) ?? fonte)
          : fonte;

      const descritor = alvo.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      const temArquivo = !!descritor && ARQUIVOS.some((chave) => descritor.get(chave) !== undefined);

      if (temArquivo) embutidas.add(nome || 'sem nome');
      else soltas.add(nome || 'sem nome');
    }
  }

  return { embutidas: [...embutidas].sort(), soltas: [...soltas].sort() };
}

export async function preflight(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  ctx.onProgress(0.05, 'Medindo as páginas');

  const doc = await openWithPdfLib(source.bytes, source.senha);
  const paginas = doc.getPages();
  if (paginas.length === 0) throw new Error('O documento não tem páginas.');

  const medidas = paginas.map((p) => {
    const { width, height } = p.getSize();
    return { l: emMm(width), a: emMm(height), giro: p.getRotation().angle };
  });
  const distintas = new Map<string, number>();
  for (const m of medidas) {
    const chave = `${m.l}x${m.a} mm`;
    distintas.set(chave, (distintas.get(chave) ?? 0) + 1);
  }
  const giradas = medidas.filter((m) => m.giro % 360 !== 0).length;

  let imagens: Achado[] = [];
  let erroDasImagens = '';
  try {
    imagens = await conferirImagens(ctx, source.bytes, source.senha);
  } catch (e) {
    erroDasImagens = e instanceof Error ? e.message : 'falha ao ler as imagens';
  }

  ctx.onProgress(0.9, 'Conferindo as fontes');
  let fontes = { embutidas: [] as string[], soltas: [] as string[] };
  let erroDasFontes = '';
  try {
    fontes = await conferirFontes(source.bytes, source.senha);
  } catch (e) {
    erroDasFontes = e instanceof Error ? e.message : 'falha ao ler as fontes';
  }

  const baixas = imagens.filter((i) => i.dpi < DPI_MINIMO).sort((a, b) => a.dpi - b.dpi);
  const criticas = baixas.filter((i) => i.dpi < DPI_CRITICO);

  const linhas: string[] = [];
  const secao = (titulo: string) => linhas.push('', titulo, '-'.repeat(titulo.length));

  linhas.push(`Conferência de impressão — ${source.name}`, `${paginas.length} página(s)`);

  secao('MEDIDA DA PÁGINA');
  for (const [medida, quantas] of distintas) linhas.push(`  ${medida} — ${quantas} página(s)`);
  if (distintas.size > 1) {
    linhas.push('  ATENÇÃO: as páginas não têm todas o mesmo tamanho. Numa tiragem isso vira corte fora de esquadro.');
  }
  if (giradas > 0) {
    linhas.push(
      `  ATENÇÃO: ${giradas} página(s) com rotação marcada no arquivo. Alguns RIPs ignoram isso e imprimem em pé.`,
    );
  }

  secao('RESOLUÇÃO DAS IMAGENS');
  if (erroDasImagens) {
    linhas.push(`  Não deu para conferir: ${erroDasImagens}`);
  } else if (imagens.length === 0) {
    linhas.push('  Nenhuma imagem encontrada. Documento só de texto e traço imprime bem em qualquer resolução.');
  } else {
    const pior = baixas[0];
    linhas.push(`  ${imagens.length} imagem(ns) conferida(s), no tamanho em que aparecem na página.`);
    if (baixas.length === 0) {
      linhas.push(`  Todas com ${DPI_MINIMO} DPI ou mais. Pode mandar.`);
    } else {
      linhas.push(`  ${baixas.length} abaixo de ${DPI_MINIMO} DPI, sendo ${criticas.length} abaixo de ${DPI_CRITICO}.`);
      linhas.push(`  A pior está na página ${pior.pagina}: ${pior.pixels} ocupando ${pior.desenhadaMm} = ${pior.dpi} DPI.`);
      linhas.push('');
      for (const item of baixas.slice(0, 25)) {
        const gravidade = item.dpi < DPI_CRITICO ? 'GRAVE ' : 'baixa ';
        linhas.push(`  ${gravidade} pág. ${item.pagina}: ${item.pixels} em ${item.desenhadaMm} = ${item.dpi} DPI`);
      }
      if (baixas.length > 25) linhas.push(`  ... e mais ${baixas.length - 25}.`);
    }
  }

  secao('FONTES');
  if (erroDasFontes) {
    linhas.push(`  Não deu para conferir: ${erroDasFontes}`);
  } else if (fontes.embutidas.length === 0 && fontes.soltas.length === 0) {
    linhas.push('  Nenhuma fonte declarada. O documento provavelmente não tem texto vivo.');
  } else {
    if (fontes.embutidas.length > 0) linhas.push(`  Embutidas (${fontes.embutidas.length}): ${fontes.embutidas.join(', ')}`);
    if (fontes.soltas.length > 0) {
      linhas.push(`  NÃO EMBUTIDAS (${fontes.soltas.length}): ${fontes.soltas.join(', ')}`);
      linhas.push('  A máquina troca essas por uma parecida, e a largura do texto muda de lugar.');
    } else {
      linhas.push('  Todas embutidas. O texto sai igual em qualquer máquina.');
    }
  }

  secao('O QUE ESTA CONFERÊNCIA NÃO VÊ');
  linhas.push('  - Espaço de cor e perfil ICC: se o arquivo está em RGB ou CMYK, e em qual perfil.');
  linhas.push('  - Superimposição (overprint) e cobertura total de tinta.');
  linhas.push('  - Sangria: dá para ver o tamanho da página, não se o desenho chega até a borda.');
  linhas.push('  Cor e tinta são conferidas no aplicativo, que tem o motor para isso. Aqui, no site, não dá.');

  const relatorio = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
  ctx.onProgress(1);

  const resumo: string[] = [];
  if (criticas.length > 0) resumo.push(`${criticas.length} imagem(ns) abaixo de ${DPI_CRITICO} DPI — não mande assim.`);
  else if (baixas.length > 0) resumo.push(`${baixas.length} imagem(ns) abaixo de ${DPI_MINIMO} DPI.`);
  if (fontes.soltas.length > 0) resumo.push(`${fontes.soltas.length} fonte(s) não embutida(s).`);
  if (distintas.size > 1) resumo.push('As páginas têm tamanhos diferentes.');
  if (resumo.length === 0) resumo.push('Nada encontrado: medidas iguais, imagens em resolução boa e fontes embutidas.');

  return {
    files: [{ name: replaceExtension(source.name, 'txt'), blob: relatorio, pages: paginas.length }],
    inputBytes: source.size,
    outputBytes: relatorio.size,
    notes: resumo,
  };
}
