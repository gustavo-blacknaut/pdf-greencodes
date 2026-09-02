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
   * O tamanho tem que sair em porcentagem. Em milímetros o Chromium montava
   * a página maior que a área imprimível e encolhia tudo: uma A4 saía do
   * tamanho de uma A5, no meio da folha.
   */
  it('dimensiona em porcentagem da folha, e não em milímetros', () => {
    const html = montarHtml([folha(1)], 'A4');
    expect(html).toContain('width: 100%');
    expect(html).toContain('height: 100vh');
    expect(html).not.toMatch(/width: d+mm/);
    expect(html).not.toMatch(/height: d+mm/);
  });

  it('nomeia o papel para o CSS, em vez de dar medidas', () => {
    expect(montarHtml([folha(1)], 'A4')).toContain('size: A4;');
    expect(montarHtml([folha(1)], 'Legal')).toContain('size: legal;');
    expect(montarHtml([folha(1)], 'Tabloid')).toContain('size: ledger;');
  });

  it('cai em A4 quando o papel é desconhecido', () => {
    expect(montarHtml([folha(1)], 'Inventado')).toContain('size: A4;');
  });

  it('põe a margem no @page, que é onde ela vale', () => {
    const html = montarHtml([folha(1)], 'A4', { margemLadosMm: 10, margemCimaMm: 5 });
    expect(html).toContain('margin: 5mm 10mm');
  });

  it('limita a margem para ela não comer a folha', () => {
    expect(montarHtml([folha(1)], 'A4', { margemLadosMm: 999 })).toContain('margin: 0mm 40mm');
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