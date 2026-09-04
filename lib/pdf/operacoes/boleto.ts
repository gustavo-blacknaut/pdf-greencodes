'use client';

/**
 * Ler o código de barras do boleto e desenhar a folha para impressão.
 *
 * As duas coisas que este arquivo faz são bem diferentes, e vale separar:
 *
 * **Ler** tira do código o que já está escrito nele: banco, valor,
 * vencimento, e se os dígitos verificadores fecham. É aritmética, não
 * consulta — nada sai da máquina.
 *
 * **Desenhar** pega um código que o banco já emitiu e monta a folha
 * imprimível, com o código de barras e a linha digitável. Isso é serviço de
 * gráfica: imprimir carnê e boleto de quem tem convênio bancário. O programa
 * não inventa código, e nem teria como — um boleto pagável depende de
 * convênio com banco e de registro na CIP, que são coisas do banco, não de
 * um programa de impressão.
 */

import { formatarLinha, lerBoleto, somenteDigitos, type Leitura } from '../../boleto/codigo';
import { mmParaPt, salvarPdf } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { loadPdfLib } from '../lazy';

/**
 * As barras do Intercalado 2 de 5, que é o padrão do boleto.
 *
 * Cada par de dígitos vira cinco barras (do primeiro) intercaladas com cinco
 * espaços (do segundo). `n` é estreito, `w` é largo — daí o nome. É por isso
 * que o código precisa ter quantidade par de dígitos, e os 44 do boleto são.
 */
const PADROES: Record<string, string> = {
  '0': 'nnwwn',
  '1': 'wnnnw',
  '2': 'nwnnw',
  '3': 'wwnnn',
  '4': 'nnwnw',
  '5': 'wnwnn',
  '6': 'nwwnn',
  '7': 'nnnww',
  '8': 'wnnwn',
  '9': 'nwnwn',
};

/** Largura de cada traço, em unidades de barra estreita. */
export function barrasDoCodigo(digitos: string): { largura: number; preta: boolean }[] {
  if (digitos.length % 2 !== 0) throw new Error('O código de barras precisa de uma quantidade par de dígitos.');

  const traços: { largura: number; preta: boolean }[] = [];
  // Início: quatro traços estreitos, alternando barra e espaço.
  for (let i = 0; i < 4; i += 1) traços.push({ largura: 1, preta: i % 2 === 0 });

  for (let i = 0; i < digitos.length; i += 2) {
    const barras = PADROES[digitos[i]];
    const espacos = PADROES[digitos[i + 1]];
    if (!barras || !espacos) throw new Error('O código de barras só aceita dígitos.');

    for (let k = 0; k < 5; k += 1) {
      // A FEBRABAN manda o largo valer três vezes o estreito.
      traços.push({ largura: barras[k] === 'w' ? 3 : 1, preta: true });
      traços.push({ largura: espacos[k] === 'w' ? 3 : 1, preta: false });
    }
  }

  // Fim: barra larga, espaço estreito, barra estreita.
  traços.push({ largura: 3, preta: true });
  traços.push({ largura: 1, preta: false });
  traços.push({ largura: 1, preta: true });

  return traços;
}

/** Só lê e devolve o laudo em texto. */
export async function readBoleto(ctx: RunContext): Promise<RunResult> {
  const entrada = String(ctx.options.codigo ?? '').trim();
  if (!entrada) throw new Error('Cole o código de barras ou a linha digitável do boleto.');

  const lido = lerBoleto(entrada);
  const linhas = montarLaudo(lido);
  const laudo = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });

  ctx.onProgress(1);
  return {
    files: [{ name: 'boleto-lido.txt', blob: laudo }],
    inputBytes: entrada.length,
    outputBytes: laudo.size,
    notes: resumoNaTela(lido),
  };
}

function montarLaudo(lido: Leitura): string[] {
  const linhas = ['Leitura do boleto', '='.repeat(40), ''];

  linhas.push(`Tipo: ${lido.tipo === 'bancario' ? 'Boleto bancário' : 'Conta de concessionária ou tributo'}`);
  if (lido.banco) linhas.push(`Banco: ${lido.banco.codigo} — ${lido.banco.nome}`);
  if (lido.segmento) linhas.push(`Segmento: ${lido.segmento}`);
  linhas.push(`Valor: ${lido.valor > 0 ? emReaisSeguro(lido.valor) : 'não vem no código'}`);
  linhas.push(`Vencimento: ${lido.vencimento ?? 'não vem no código'}`);
  linhas.push('');
  linhas.push(`Código de barras: ${lido.codigo}`);
  linhas.push(`Linha digitável:  ${formatarLinha(lido.linha)}`);
  linhas.push('');
  linhas.push(lido.valido ? 'Dígitos verificadores: conferem.' : 'Dígitos verificadores: NÃO conferem.');
  for (const problema of lido.problemas) linhas.push(`  - ${problema}`);

  linhas.push('');
  linhas.push('O que este laudo NÃO diz:');
  linhas.push('  - Quem emitiu, quem deve pagar, ou o que foi comprado. Isso não está');
  linhas.push('    dentro do código de barras — o código carrega banco, valor e vencimento.');
  linhas.push('  - Se o boleto foi pago, ou se está registrado no banco. Só o banco responde.');

  return linhas;
}

function emReaisSeguro(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function resumoNaTela(lido: Leitura): string[] {
  const notas: string[] = [];

  if (lido.banco) notas.push(`${lido.banco.nome} · ${emReaisSeguro(lido.valor)}`);
  else notas.push(`${lido.segmento} · ${lido.valor > 0 ? emReaisSeguro(lido.valor) : 'valor não vem no código'}`);

  if (lido.vencimento) {
    const [ano, mes, dia] = lido.vencimento.split('-');
    notas.push(`Vence em ${dia}/${mes}/${ano}.`);
  }

  notas.push(`Linha digitável: ${formatarLinha(lido.linha)}`);

  if (!lido.valido) {
    notas.push(
      'ATENÇÃO: os dígitos verificadores não fecham. Ou o número foi digitado errado, ou o boleto foi alterado. ' +
        'Confira com quem emitiu antes de pagar.',
    );
  }

  notas.push('Quem emitiu e o que foi comprado não estão no código de barras, e nenhuma ferramenta tira isso dele.');
  return notas;
}

/**
 * Desenha a folha imprimível a partir de um código já emitido.
 *
 * O código de barras é desenhado em Intercalado 2 de 5, na altura de 13 mm
 * que a FEBRABAN pede, com a área de silêncio nas laterais — sem ela, o
 * leitor do caixa não engata.
 */
export async function boletoParaImpressao(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();

  const codigos = String(ctx.options.codigos ?? '')
    .split(/[\n;]+/)
    .map((linha) => somenteDigitos(linha))
    .filter(Boolean);

  if (codigos.length === 0) {
    throw new Error('Cole ao menos um código de barras ou linha digitável, um por linha.');
  }

  const beneficiario = String(ctx.options.beneficiario ?? '').trim();
  const pagador = String(ctx.options.pagador ?? '').trim();
  const porFolha = Math.min(3, Math.max(1, Number(ctx.options.porFolha ?? 3)));

  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const preto = rgb(0, 0, 0);

  const larguraFolha = mmParaPt(210);
  const margem = mmParaPt(12);

  /**
   * Uma tira: os dados em cima, o codigo de barras colado no rodape.
   *
   * Fica aqui dentro, e nao como funcao solta, porque precisa da pagina e
   * das fontes deste documento. Passar tudo isso por parametro exigiria
   * declarar os tipos do pdf-lib a mao, e o resultado era ilegivel.
   */
  const desenharTira = (
    pagina: ReturnType<typeof doc.addPage>,
    lido: Leitura,
    topo: number,
    numero: number,
  ) => {
    let y = topo - mmParaPt(12);

    const escreve = (texto: string, tamanho: number, negritado = false) => {
      pagina.drawText(texto, { x: margem, y, size: tamanho, font: negritado ? negrito : fonte, color: preto });
      y -= tamanho + 4;
    };

    escreve(formatarLinha(lido.linha), 11, true);
    y -= 4;

    if (beneficiario) escreve(`Beneficiário: ${beneficiario}`, 9);
    if (pagador) escreve(`Pagador: ${pagador}`, 9);

    const vencimento = lido.vencimento ? lido.vencimento.split('-').reverse().join('/') : 'não vem no código';
    escreve(`Vencimento: ${vencimento}    Valor: ${emReaisSeguro(lido.valor)}`, 9);
    if (lido.banco) escreve(`${lido.banco.codigo} — ${lido.banco.nome}`, 9);
    if (codigos.length > 1) escreve(`Parcela ${numero} de ${codigos.length}`, 9);

    // A area de silencio nas laterais e obrigatoria: sem ela o leitor do
    // caixa nao encontra o comeco do codigo.
    const tracos = barrasDoCodigo(lido.codigo);
    const unidades = tracos.reduce((soma, t) => soma + t.largura, 0);
    const silencio = mmParaPt(10);
    const unidade = (larguraFolha - margem * 2 - silencio * 2) / unidades;
    const base = topo - alturaTira + mmParaPt(14);

    let x = margem + silencio;
    for (const traco of tracos) {
      const largura = traco.largura * unidade;
      if (traco.preta) pagina.drawRectangle({ x, y: base, width: largura, height: mmParaPt(13), color: preto });
      x += largura;
    }

    // Pontilhado de corte entre as tiras.
    const corte = topo - alturaTira;
    if (corte > 1) {
      for (let px = margem; px < larguraFolha - margem; px += 6) {
        pagina.drawRectangle({ x: px, y: corte, width: 3, height: 0.4, color: preto, opacity: 0.4 });
      }
    }
  };

  const alturaFolha = mmParaPt(297);
  const alturaTira = alturaFolha / porFolha;

  const lidos: Leitura[] = [];
  let pagina = doc.addPage([larguraFolha, alturaFolha]);
  let naFolha = 0;

  for (let i = 0; i < codigos.length; i += 1) {
    ctx.onProgress(i / codigos.length, `Boleto ${i + 1} de ${codigos.length}`);

    const lido = lerBoleto(codigos[i]);
    lidos.push(lido);

    if (naFolha === porFolha) {
      pagina = doc.addPage([larguraFolha, alturaFolha]);
      naFolha = 0;
    }

    const topo = alturaFolha - naFolha * alturaTira;
    desenharTira(pagina, lido, topo, i + 1);
    naFolha += 1;
  }

  const blob = await salvarPdf(doc);
  ctx.onProgress(1);

  const invalidos = lidos.filter((l) => !l.valido).length;
  const total = lidos.reduce((soma, l) => soma + l.valor, 0);

  const notas = [
    `${codigos.length} boleto(s) em ${doc.getPageCount()} folha(s), ${porFolha} por folha.`,
    `Soma dos valores: ${emReaisSeguro(total)}.`,
    'Imprima em tamanho real, sem ajustar à página: o leitor do caixa mede a largura das barras, ' +
      'e qualquer redução tira o código de escala.',
  ];
  if (invalidos > 0) {
    notas.push(
      `ATENÇÃO: ${invalidos} código(s) com dígito verificador que não fecha. Foram impressos assim mesmo, ` +
        'mas o caixa vai recusar. Confira com quem emitiu.',
    );
  }

  return {
    files: [{ name: 'boletos.pdf', blob, pages: doc.getPageCount() }],
    inputBytes: codigos.join('').length,
    outputBytes: blob.size,
    notes: notas,
  };
}
