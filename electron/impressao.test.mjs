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