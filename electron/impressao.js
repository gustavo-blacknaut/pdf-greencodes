'use strict';

/**
 * Impressão no Windows.
 *
 * A primeira versão abria o PDF numa janela escondida e chamava print() nela.
 * Não funciona: essa janela mostra o visualizador de PDF do Chromium, e o
 * print() imprime o que está na tela dele, não o documento. O resultado era
 * uma folha só, com um retângulo preto — o pedaço do visualizador que estava
 * pintado naquele instante.
 *
 * Agora a interface desenha cada página como imagem (ela já tem o pdf.js) e
 * manda uma por uma para cá. Montamos um HTML com uma imagem por folha e é
 * esse HTML que vai para a impressora. Fica determinístico: o que aparece na
 * prévia é exatamente o que sai no papel.
 *
 * O custo é que o envio vira imagem, e não vetor. Para foto e adesivo, que é
 * o uso aqui, dá no mesmo; para texto miúdo em 1200 DPI seria pior, e por isso
 * o desenho é limitado a 300 DPI, onde a diferença não aparece no papel.
 */

const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/** Sessões abertas: cada impressão junta suas páginas antes de sair. */
const sessoes = new Map();

/** Tamanhos de papel em milímetros, para a regra @page do HTML. */
const PAPEL_MM = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Legal: [216, 356],
  Letter: [216, 279],
  Tabloid: [279, 432],
};

async function preparar() {
  const id = `greencodes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pasta = path.join(os.tmpdir(), id);
  await fsp.mkdir(pasta, { recursive: true });
  sessoes.set(id, { pasta, paginas: [] });
  return { ok: true, id };
}

/**
 * Recebe uma página desenhada e grava em disco na hora.
 *
 * Uma de cada vez de propósito: um documento de 55 páginas em 300 DPI passa
 * de 50 MB, e segurar tudo na memória do renderer antes de enviar derrubaria
 * a aba em máquina fraca.
 */
async function receberPagina({ id, indice, bytes }) {
  const sessao = sessoes.get(id);
  if (!sessao) return { ok: false, erro: 'Sessão de impressão não encontrada.' };
  if (!(bytes instanceof ArrayBuffer)) return { ok: false, erro: 'Página inválida.' };

  const arquivo = path.join(sessao.pasta, `${String(indice).padStart(4, '0')}.jpg`);
  await fsp.writeFile(arquivo, Buffer.from(bytes));
  sessao.paginas.push(arquivo);
  return { ok: true };
}

/**
 * Como a página se encaixa na folha.
 *
 * Os nomes são os do CSS porque é literalmente isso que acontece: a página
 * vira uma imagem dentro de uma caixa do tamanho do papel.
 */
const AJUSTES = {
  // Cabe inteira, sem cortar nada. Pode sobrar branco nas beiradas.
  pagina: 'contain',
  // Ocupa a folha toda, cortando o que não couber.
  preencher: 'cover',
  // Tamanho original, sem redimensionar.
  original: 'none',
};

/**
 * Uma folha por imagem.
 *
 * A margem entra na regra @page e é descontada do tamanho da imagem: sem
 * descontar, a imagem ocuparia a folha inteira e a margem não apareceria.
 */
function montarHtml(paginas, papel, opcoes = {}) {
  const [larguraMm, alturaMm] = PAPEL_MM[papel] || PAPEL_MM.A4;

  const limitar = (valor) => Math.min(Math.max(Number(valor) || 0, 0), 40);
  const lados = limitar(opcoes.margemLadosMm);
  const cima = limitar(opcoes.margemCimaMm);
  const encaixe = AJUSTES[opcoes.ajuste] || AJUSTES.pagina;

  const larguraUtil = Math.max(10, larguraMm - lados * 2);
  const alturaUtil = Math.max(10, alturaMm - cima * 2);

  const imagens = paginas
    .sort()
    .map((arquivo) => `<img src="file://${arquivo.split(path.sep).join('/')}" alt="">`)
    .join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<style>
  @page { size: ${larguraMm}mm ${alturaMm}mm; margin: ${cima}mm ${lados}mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  img {
    display: block;
    width: ${larguraUtil}mm;
    height: ${alturaUtil}mm;
    object-fit: ${encaixe};
    page-break-after: always;
    break-after: page;
  }
  img:last-child { page-break-after: auto; break-after: auto; }
</style>
${imagens}
`;
}

/** Espera as imagens carregarem: imprimir antes disso sai em branco. */
const ESPERAR_IMAGENS = `
  new Promise((pronto) => {
    const imagens = [...document.images];
    const faltando = imagens.filter((i) => !i.complete);
    if (!faltando.length) return pronto(imagens.length);
    let restam = faltando.length;
    for (const img of faltando) {
      const conta = () => { if (--restam <= 0) pronto(imagens.length); };
      img.addEventListener('load', conta, { once: true });
      img.addEventListener('error', conta, { once: true });
    }
  })
`;

async function enviar({ id, opcoes }) {
  const sessao = sessoes.get(id);
  if (!sessao) return { ok: false, erro: 'Sessão de impressão não encontrada.' };
  if (!sessao.paginas.length) return { ok: false, erro: 'Nenhuma página para imprimir.' };

  const config = opcoes || {};
  const html = path.join(sessao.pasta, 'folhas.html');
  let janela = null;

  try {
    await fsp.writeFile(html, montarHtml(sessao.paginas, config.papel, config), 'utf8');

    janela = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: true, offscreen: false },
    });
    await janela.loadFile(html);
    await janela.webContents.executeJavaScript(ESPERAR_IMAGENS);

    const resultado = await new Promise((resolve) => {
      janela.webContents.print(
        {
          // Calado só quando há impressora escolhida e ninguém pediu o
          // diálogo. O diálogo é o caminho garantido para os ajustes do
          // driver — tipo de papel, padrão fino ou grosso, melhor qualidade —
          // que a impressão silenciosa monta por conta própria e pode ignorar.
          silent: Boolean(config.impressora) && !config.usarDialogo,
          deviceName: config.impressora || undefined,
          color: config.colorido !== false,
          copies: Math.max(1, Math.min(99, Number(config.copias) || 1)),
          landscape: Boolean(config.paisagem),
          duplexMode: config.duplex || 'simplex',
          pageSize: config.papel || 'A4',
          dpi: { horizontal: Number(config.dpi) || 300, vertical: Number(config.dpi) || 300 },
          // A margem já está no @page do HTML; deixar o Chromium somar a
          // dele daria margem em cima de margem.
          margins: { marginType: 'none' },
          printBackground: true,
        },
        (sucesso, motivo) => resolve({ sucesso, motivo }),
      );
    });

    // Cancelar no diálogo do Windows não é erro: a pessoa desistiu.
    if (!resultado.sucesso && resultado.motivo && resultado.motivo !== 'cancelled') {
      return { ok: false, erro: resultado.motivo };
    }
    return { ok: true, cancelado: !resultado.sucesso, folhas: sessao.paginas.length };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  } finally {
    if (janela && !janela.isDestroyed()) janela.destroy();
    descartar(id);
  }
}

/** Apaga a pasta temporária. Chamado no fim e também quando dá errado. */
function descartar(id) {
  const sessao = sessoes.get(id);
  if (!sessao) return { ok: true };
  sessoes.delete(id);
  fsp.rm(sessao.pasta, { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

/** Na saída do app, não deixa lixo em %TEMP%. */
function limparTudo() {
  for (const id of [...sessoes.keys()]) descartar(id);
}

module.exports = { preparar, receberPagina, enviar, descartar, limparTudo, PAPEL_MM };
