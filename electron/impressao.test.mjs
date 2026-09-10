/**
 * O HTML que vai para a impressora.
 *
 * A versão anterior abria o PDF numa janela escondida e mandava imprimir nela,
 * e saía uma folha só com um retângulo preto: aquele print() imprime o
 * visualizador, não o documento. Estes testes prendem o que substituiu isso —
 * uma folha por página, no tamanho do papel, na ordem certa.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// O módulo importa `electron`, que não existe fora do app. Só o montarHtml
// interessa aqui, então lemos a função do arquivo sem carregar o resto.
const fonte = fs.readFileSync(path.join(__dirname, 'impressao.js'), 'utf8');
const corpo = fonte.slice(fonte.indexOf('const PAPEL_MM'), fonte.indexOf('async function preparar'));
const montar = fonte.slice(fonte.indexOf('const AJUSTES'), fonte.indexOf('/** Espera as imagens'));
const montarHtml = new Function('path', `${corpo}\n${montar}\nreturn montarHtml;`)(path);
const folhaEmMicrons = new Function(`${corpo}
return folhaEmMicrons;`)();
const folhaEmMm = new Function(`${corpo}
return folhaEmMm;`)();

const folha = (n) => path.join(os.tmpdir(), 'sessao', `${String(n).padStart(4, '0')}.jpg`);

describe('HTML de impressão', () => {
  it('gera uma folha por página, e não uma só', () => {
    const html = montarHtml([folha(1), folha(2), folha(3)], 'A4');
    expect((html.match(/<img /g) || []).length).toBe(3);
    expect((html.match(/class="folha"/g) || []).length).toBe(3);
  });

  it('quebra folha entre as páginas', () => {
    const html = montarHtml([folha(1), folha(2)], 'A4');
    expect(html).toContain('page-break-after: always');
    expect(html).toContain('break-after: page');
  });

  /*
   * O `@page` tem que dar as duas medidas em milímetros, e não o nome do
   * papel.
   *
   * Nome de papel traz a orientação junto — `A4` é retrato — enquanto a
   * orientação de verdade vai separada, no `landscape` da chamada do print.
   * Quando os dois discordavam, o driver encolhia o trabalho para caber por
   * 210/297, e a arte saía com metade da área no meio da folha: uma A5
   * impressa numa A4, que foi como o defeito chegou aqui.
   */
  it('dá a folha em milímetros, e não pelo nome do papel', () => {
    const html = montarHtml([folha(1)], 'A4');
    expect(html).toContain('size: 210mm 297mm');
    expect(html).not.toMatch(/size:\s*A4\s*;/);
  });

  it('a folha do CSS mede o mesmo que o papel escolhido', () => {
    expect(montarHtml([folha(1)], 'A3')).toContain('size: 297mm 420mm');
    expect(montarHtml([folha(1)], 'A5')).toContain('size: 148mm 210mm');
    expect(montarHtml([folha(1)], 'Legal')).toContain('size: 216mm 356mm');
    expect(montarHtml([folha(1)], 'Tabloid')).toContain('size: 279mm 432mm');
  });

  it('deitado troca as medidas, para o CSS não brigar com o driver', () => {
    // É a correção do defeito: sem a troca, o CSS monta 210x297 enquanto o
    // Windows alimenta 297x210, e o trabalho é encolhido para caber.
    const html = montarHtml([folha(1)], 'A4', { paisagem: true });
    expect(html).toContain('size: 297mm 210mm');
    expect(html).toContain('width: 297mm');
    expect(html).toContain('height: 210mm');
  });

  it('a folha ocupa a página inteira, sem sobrar nem transbordar', () => {
    const html = montarHtml([folha(1)], 'A4');
    expect(html).toContain('width: 210mm');
    expect(html).toContain('height: 297mm');
    // Nada de `vh`: em impressão a unidade se resolve contra a página com
    // margem incluída, e a folha passava a transbordar para a seguinte.
    expect(html).not.toContain('vh');
  });

  it('cai em A4 quando o papel é desconhecido', () => {
    expect(montarHtml([folha(1)], 'Inventado')).toContain('size: 210mm 297mm');
  });

  it('a margem é recuo por dentro da folha, e não margem de @page', () => {
    // Com margem no @page a caixa da página encolhe, mas a folha continua
    // pedindo a altura cheia: cada página transbordava um pouco na seguinte
    // e a impressão enchia de folhas quase em branco.
    const html = montarHtml([folha(1)], 'A4', { margemLadosMm: 10, margemCimaMm: 5 });
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
    expect(html).toContain('padding: 5mm 10mm');
    expect(html).toContain('box-sizing: border-box');
  });

  it('limita a margem para ela não comer a folha', () => {
    expect(montarHtml([folha(1)], 'A4', { margemLadosMm: 999 })).toContain('padding: 0mm 40mm');
  });

  it('traduz o ajuste para o encaixe do CSS', () => {
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'pagina' })).toContain('object-fit: contain');
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'preencher' })).toContain('object-fit: cover');
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'original' })).toContain('object-fit: none');
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'inventado' })).toContain('object-fit: contain');
  });

  /* O nome do trabalho na fila da impressora sai do <title>. */
  it('usa o nome do documento como título, e não o do arquivo temporário', () => {
    const html = montarHtml([folha(1)], 'A4', { titulo: 'contrato.pdf' });
    expect(html).toContain('<title>contrato.pdf</title>');
    expect(html).not.toContain(String.fromCharCode(92));
  });

  it('não deixa o nome do documento injetar marcação no título', () => {
    const html = montarHtml([folha(1)], 'A4', { titulo: '<script>x</script>' });
    expect(html).not.toContain('<script>');
  });

  it('mantém a ordem das páginas mesmo recebendo fora de ordem', () => {
    const html = montarHtml([folha(3), folha(1), folha(2)], 'A4');
    const ordem = [...html.matchAll(/(\d{4})\.jpg/g)].map((m) => m[1]);
    expect(ordem).toEqual(['0001', '0002', '0003']);
  });

  it('escreve caminho com barra normal, que é o que o file:// aceita', () => {
    const html = montarHtml([folha(1)], 'A4');
    expect(html).toContain('file://');
    // Caminho de Windows tem contrabarra; o file:// precisa de barra normal.
    expect(html).not.toContain(String.fromCharCode(92));
  });
});
describe('escala, posição e marcas', () => {
  /*
   * O `object-fit` do CSS resolve o "cabe na folha" e mais nada: ele não sabe
   * onde a arte ficou nem de que tamanho, e sem isso não há marca de corte
   * alinhada com a borda. Por isso, quando escala, posição ou marca entram, a
   * posição passa a ser calculada depois das imagens carregarem.
   *
   * Estes testes prendem *quando* o cálculo entra. O que ele calcula está em
   * `lib/impressao/layout.test.ts`, com a mesma conta.
   */
  it('sem nada disso, mantém o caminho simples e provado', () => {
    const html = montarHtml([folha(1)], 'A4', { ajuste: 'pagina' });
    expect(html).not.toContain('__posicionar');
    expect(html).toContain('object-fit: contain');
  });

  it('escala em porcentagem liga o cálculo', () => {
    const html = montarHtml([folha(1)], 'A4', { escala: 'porcento', escalaPorcento: 50 });
    expect(html).toContain('window.__posicionar');
    expect(html).toContain('"porcento":50');
  });

  it('deslocar a arte liga o cálculo', () => {
    expect(montarHtml([folha(1)], 'A4', { deslocaXmm: 5 })).toContain('window.__posicionar');
    expect(montarHtml([folha(1)], 'A4', { deslocaYmm: -3 })).toContain('window.__posicionar');
  });

  it('as marcas ligam o cálculo, porque precisam saber onde a arte está', () => {
    expect(montarHtml([folha(1)], 'A4', { marcasCorte: true })).toContain('window.__posicionar');
    expect(montarHtml([folha(1)], 'A4', { marcasRegistro: true })).toContain('window.__posicionar');
  });

  it('o DPI vai junto: é dele que sai o tamanho de verdade', () => {
    // Sem a resolução, "tamanho original" não quer dizer nada — a imagem é um
    // raster, e px só vira mm sabendo em quantos pontos por polegada.
    const html = montarHtml([folha(1)], 'A4', { escala: 'original', dpi: 600 });
    expect(html).toContain('"dpi":600');
  });

  it('espelhar e negativo são CSS, e não precisam de cálculo', () => {
    // Os dois valem para a imagem inteira, onde quer que ela esteja.
    const espelhada = montarHtml([folha(1)], 'A4', { espelho: 'horizontal' });
    expect(espelhada).toContain('transform: scaleX(-1)');
    expect(espelhada).not.toContain('__posicionar');

    expect(montarHtml([folha(1)], 'A4', { negativo: true })).toContain('filter: invert(1)');
  });

  it('define a função sem chamá-la', () => {
    /*
     * Chamar no carregamento do HTML mediria imagem com tamanho zero, e a
     * conta sairia errada em silêncio — arte de tamanho nenhum no canto da
     * folha. Quem chama é o processo principal, depois de esperar.
     */
    const html = montarHtml([folha(1)], 'A4', { marcasCorte: true });
    expect(html).toContain('window.__posicionar = function');
    expect(html).not.toMatch(/\n\s*posicionar\(\{/);
  });
});

/**
 * O tamanho que vai na chamada do `print`.
 *
 * O defeito que estes testes prendem: a chamada mandava o **nome** do papel
 * enquanto o CSS já falava em milímetros. Nome depende da tabela do Chromium
 * e carrega orientação; quando o driver estava guardado noutro tamanho, ele
 * encolhia a arte para caber, e a folha A4 saía com uma A5 impressa no meio.
 */
describe('folha do print', () => {
  it('mede A4 em microns, não pelo nome', () => {
    expect(folhaEmMicrons('A4')).toEqual({ width: 210000, height: 297000 });
  });

  it('cai em A4 quando o papel é desconhecido', () => {
    expect(folhaEmMicrons('inexistente')).toEqual({ width: 210000, height: 297000 });
    expect(folhaEmMicrons(undefined)).toEqual({ width: 210000, height: 297000 });
  });

  it('vai sempre em retrato, porque quem gira é o landscape da chamada', () => {
    const a4 = folhaEmMicrons('A4');
    expect(a4.height).toBeGreaterThan(a4.width);
  });

  it('fala da mesma folha que o CSS', () => {
    for (const papel of ['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid']) {
      const [larguraMm, alturaMm] = folhaEmMm(papel, false);
      const microns = folhaEmMicrons(papel);
      expect(microns.width).toBe(larguraMm * 1000);
      expect(microns.height).toBe(alturaMm * 1000);
    }
  });

  it('não confunde A4 com A5', () => {
    const a4 = folhaEmMicrons('A4');
    const a5 = folhaEmMicrons('A5');
    expect(a4).not.toEqual(a5);
    // A5 é metade da A4: é essa razão que aparecia na folha impressa.
    expect(a5.height).toBe(a4.width);
  });
});
