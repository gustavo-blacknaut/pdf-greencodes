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

/**
 * A folha em milímetros, já deitada quando for o caso.
 *
 * Aqui morava um mapa de **nomes** de papel para o CSS — `@page { size: A4 }`.
 * Parecia mais limpo e escondia um defeito que só o papel na mão mostrava:
 * nome de papel no CSS declara também a **orientação**, e A4 é retrato. Só
 * que a orientação de verdade vai separada, na chamada do `print`, em
 * `landscape`.
 *
 * Quando a pessoa marcava "deitado", os dois discordavam: o CSS montava as
 * páginas em retrato, de 210 por 297, e o Windows recebia uma folha deitada,
 * de 297 por 210. O driver então encolhia o trabalho para caber — por
 * 210/297, que é 0,707 — e a arte saía com metade da área no meio da folha.
 * É exatamente uma A5 impressa no meio de uma A4, que foi como o defeito
 * chegou aqui descrito.
 *
 * Dando as duas medidas em milímetros, na ordem certa, não sobra o que
 * discordar: o CSS e o `print` falam da mesma folha.
 */
/**
 * A folha para o `print`, em microns e sempre em retrato.
 *
 * A regra 1 de `montarHtml` diz que o CSS e o `print` têm que falar da
 * mesma folha. O CSS já falava em milímetros, mas a chamada continuava
 * mandando o **nome** do papel — e nome carrega orientação e depende da
 * tabela do Chromium. Quando o driver estava guardado noutro tamanho, ele
 * encolhia a arte para caber: uma fatura A4 saía do tamanho de uma A5 no
 * meio da folha.
 *
 * Em microns não sobra o que interpretar. Vai em retrato porque o
 * `landscape` da própria chamada é quem gira a folha; girar aqui também
 * deixaria a folha de volta em pé.
 */
function folhaEmMicrons(papel) {
  const [largura, altura] = PAPEL_MM[papel] || PAPEL_MM.A4;
  return { width: Math.round(largura * 1000), height: Math.round(altura * 1000) };
}

function folhaEmMm(papel, deitado) {
  const [largura, altura] = PAPEL_MM[papel] || PAPEL_MM.A4;
  return deitado ? [altura, largura] : [largura, altura];
}

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
 * Duas regras seguram o tamanho, e as duas foram aprendidas errando:
 *
 * 1. **A folha do CSS é a folha do `print`, medida em milímetros e na mesma
 *    orientação.** Nome de papel — `size: A4` — traz orientação junto e
 *    briga com o `landscape` da chamada; quando os dois discordam, o driver
 *    encolhe o trabalho para caber e a arte sai pequena no meio do papel.
 *
 * 2. **A margem é recuo por dentro da folha, e não margem de `@page`.** Com
 *    margem no `@page`, a caixa da página encolhe mas a folha continua
 *    pedindo a altura inteira, e cada página transborda um pouco para a
 *    seguinte — o que enche a impressão de folhas quase em branco.
 *
 * Com a folha valendo exatamente uma página, e o recuo por dentro dela, não
 * sobra nada para o Chromium nem para o driver interpretarem.
 */
function montarHtml(paginas, papel, opcoes = {}) {
  const limitar = (valor) => Math.min(Math.max(Number(valor) || 0, 0), 40);
  const lados = limitar(opcoes.margemLadosMm);
  const cima = limitar(opcoes.margemCimaMm);
  const encaixe = AJUSTES[opcoes.ajuste] || AJUSTES.pagina;
  const [folhaL, folhaA] = folhaEmMm(papel, Boolean(opcoes.paisagem));

  /*
   * O que a montagem de gráfica pede, além de "cabe na folha".
   *
   * Posicionar em milímetro, escalar por porcentagem, espelhar e marcar o
   * corte são o serviço entre a arte pronta e a máquina. O `object-fit` do
   * CSS resolve o "cabe" e mais nada: ele não sabe onde a arte está nem de
   * que tamanho ela ficou, e sem isso não há como desenhar marca de corte
   * alinhada com a borda.
   *
   * Por isso, quando qualquer um desses entra em jogo, a posição passa a ser
   * calculada — depois das imagens carregarem, que é quando se sabe o
   * tamanho real de cada página. A conta em si mora em `lib/impressao/layout`
   * e é a mesma que a prévia usa; aqui vai uma cópia enxuta dela, porque
   * este HTML roda solto numa janela sem o pacote do aplicativo.
   */
  const posicionado = {
    escala: String(opcoes.escala ?? 'pagina'),
    porcento: Number(opcoes.escalaPorcento) || 100,
    deslocaX: Number(opcoes.deslocaXmm) || 0,
    deslocaY: Number(opcoes.deslocaYmm) || 0,
    espelho: String(opcoes.espelho ?? 'nao'),
    negativo: Boolean(opcoes.negativo),
    marcasCorte: Boolean(opcoes.marcasCorte),
    marcasRegistro: Boolean(opcoes.marcasRegistro),
    dpi: Number(opcoes.dpi) || 300,
  };

  // Sem nada disso ligado, o caminho antigo continua valendo — é mais simples
  // e já está provado no papel.
  const precisaCalcular =
    posicionado.escala !== 'pagina' ||
    posicionado.deslocaX !== 0 ||
    posicionado.deslocaY !== 0 ||
    posicionado.marcasCorte ||
    posicionado.marcasRegistro;

  // O nome do trabalho na fila da impressora sai daqui. Sem isto aparecia o
  // nome do arquivo temporário, e a fila mostrava 'folhas.html'.
  const titulo = String(opcoes.titulo || 'Documento')
    .replace(/[<>&]/g, '')
    .slice(0, 120);

  const imagens = paginas
    .sort()
    .map(
      (arquivo) =>
        `<div class="folha"><img src="file://${arquivo.split(path.sep).join('/')}" alt=""></div>`,
    )
    .join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<title>${titulo}</title>
<style>
  @page { size: ${folhaL}mm ${folhaA}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }

  /* A folha é a página inteira, e a margem é recuo por dentro dela. */
  .folha {
    width: ${folhaL}mm;
    height: ${folhaA}mm;
    padding: ${cima}mm ${lados}mm;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .folha:last-child { page-break-after: auto; break-after: auto; }

  .folha img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: ${encaixe};
    ${posicionado.espelho === 'horizontal' ? 'transform: scaleX(-1);' : ''}
    ${posicionado.espelho === 'vertical' ? 'transform: scaleY(-1);' : ''}
    ${posicionado.negativo ? 'filter: invert(1);' : ''}
  }

  /* As marcas ficam por cima da folha, e nunca por cima da arte. */
  .marca { position: absolute; background: #000; }
  .alvo {
    position: absolute;
    border: 0.25mm solid #000;
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }
  .alvo::before, .alvo::after {
    content: '';
    position: absolute;
    background: #000;
  }
  .alvo::before { left: 50%; top: -1mm; width: 0.2mm; height: calc(100% + 2mm); margin-left: -0.1mm; }
  .alvo::after { top: 50%; left: -1mm; height: 0.2mm; width: calc(100% + 2mm); margin-top: -0.1mm; }
</style>
${imagens}
${
  precisaCalcular
    ? `<script>${SCRIPT_DE_POSICAO}
// Só define. Quem chama é o processo principal, depois de as imagens
// carregarem: antes disso o tamanho real de cada página é zero, e a conta
// toda sairia errada em silêncio.
window.__posicionar = function () { posicionar(${JSON.stringify({ ...posicionado, folhaL, folhaA, lados, cima })}); };
</script>`
    : ''
}
`;
}

/**
 * Posiciona cada arte na folha, depois de as imagens carregarem.
 *
 * Roda dentro da janela escondida da impressão, então é texto — não dá para
 * importar o módulo do aplicativo aqui. A conta é a mesma de
 * `lib/impressao/layout.ts`, e o teste de lá é que a prende.
 *
 * O tamanho real de cada página só se sabe com a imagem carregada: ela é um
 * raster num DPI conhecido, e é daí que sai o "tamanho original".
 */
const SCRIPT_DE_POSICAO = `
function posicionar(cfg) {
  var mm = function (v) { return v + 'mm'; };
  var folhas = document.querySelectorAll('.folha');

  for (var i = 0; i < folhas.length; i++) {
    var folha = folhas[i];
    var img = folha.querySelector('img');
    if (!img || !img.naturalWidth) continue;

    folha.style.position = 'relative';
    folha.style.padding = '0';
    folha.style.display = 'block';

    var arteL = (img.naturalWidth / cfg.dpi) * 25.4;
    var arteA = (img.naturalHeight / cfg.dpi) * 25.4;
    var dispL = Math.max(1, cfg.folhaL - cfg.lados * 2);
    var dispA = Math.max(1, cfg.folhaA - cfg.cima * 2);

    var fator;
    if (cfg.escala === 'preencher') fator = Math.max(dispL / arteL, dispA / arteA);
    else if (cfg.escala === 'original') fator = 1;
    else if (cfg.escala === 'porcento') fator = Math.min(Math.max(cfg.porcento, 1), 1000) / 100;
    else fator = Math.min(dispL / arteL, dispA / arteA);

    var largura = arteL * fator;
    var altura = arteA * fator;
    var x = (cfg.folhaL - largura) / 2 + cfg.deslocaX;
    var y = (cfg.folhaA - altura) / 2 + cfg.deslocaY;

    img.style.position = 'absolute';
    img.style.left = mm(x);
    img.style.top = mm(y);
    img.style.width = mm(largura);
    img.style.height = mm(altura);
    img.style.objectFit = 'fill';

    if (cfg.marcasCorte) {
      var vao = 2, comp = 4, esp = 0.25;
      var risco = function (left, top, w, h) {
        var d = document.createElement('div');
        d.className = 'marca';
        d.style.left = mm(left); d.style.top = mm(top);
        d.style.width = mm(w); d.style.height = mm(h);
        folha.appendChild(d);
      };
      var dir = x + largura, bai = y + altura;
      // Dois riscos por canto, nenhum encostando na arte.
      risco(x - vao - comp, y - esp / 2, comp, esp);
      risco(x - esp / 2, y - vao - comp, esp, comp);
      risco(dir + vao, y - esp / 2, comp, esp);
      risco(dir - esp / 2, y - vao - comp, esp, comp);
      risco(dir + vao, bai - esp / 2, comp, esp);
      risco(dir - esp / 2, bai + vao, esp, comp);
      risco(x - vao - comp, bai - esp / 2, comp, esp);
      risco(x - esp / 2, bai + vao, esp, comp);
    }

    if (cfg.marcasRegistro) {
      var af = 6, raio = 3;
      var alvos = [
        [x + largura / 2, y - af],
        [x + largura / 2, y + altura + af],
        [x - af, y + altura / 2],
        [x + largura + af, y + altura / 2],
      ];
      for (var a = 0; a < alvos.length; a++) {
        var el = document.createElement('div');
        el.className = 'alvo';
        el.style.left = mm(alvos[a][0]);
        el.style.top = mm(alvos[a][1]);
        el.style.width = mm(raio);
        el.style.height = mm(raio);
        folha.appendChild(el);
      }
    }
  }
}
`;

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

async function enviar({ id, opcoes, nome }) {
  const sessao = sessoes.get(id);
  if (!sessao) return { ok: false, erro: 'Sessão de impressão não encontrada.' };
  if (!sessao.paginas.length) return { ok: false, erro: 'Nenhuma página para imprimir.' };

  const config = opcoes || {};
  const html = path.join(sessao.pasta, 'folhas.html');
  let janela = null;

  try {
    await fsp.writeFile(html, montarHtml(sessao.paginas, config.papel, { ...config, titulo: nome }), 'utf8');

    janela = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: true, offscreen: false },
    });
    await janela.loadFile(html);
    await janela.webContents.executeJavaScript(ESPERAR_IMAGENS);

    // Agora sim: com as imagens carregadas, o tamanho real de cada página é
    // conhecido e a arte pode ser posicionada em milímetro.
    await janela.webContents.executeJavaScript(
      'window.__posicionar ? (window.__posicionar(), true) : false',
    );

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
          pageSize: folhaEmMicrons(config.papel),
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
