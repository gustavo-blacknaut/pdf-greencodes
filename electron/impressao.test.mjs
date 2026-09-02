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
  it('gera uma imagem por página, e não uma só', () => {
    const html = montarHtml([folha(1), folha(2), folha(3)], 'A4');
    expect((html.match(/<img /g) || []).length).toBe(3);
  });

  it('quebra folha entre as páginas', () => {
    const html = montarHtml([folha(1), folha(2)], 'A4');
    expect(html).toContain('page-break-after: always');
    expect(html).toContain('break-after: page');
  });

  it('usa o tamanho do papel escolhido', () => {
    expect(montarHtml([folha(1)], 'A4')).toContain('size: 210mm 297mm');
    expect(montarHtml([folha(1)], 'Legal')).toContain('size: 216mm 356mm');
    expect(montarHtml([folha(1)], 'A3')).toContain('size: 297mm 420mm');
  });

  it('cai em A4 quando o papel é desconhecido', () => {
    expect(montarHtml([folha(1)], 'Inventado')).toContain('size: 210mm 297mm');
  });

  it('não deixa margem: o recorte já veio pronto do desenho', () => {
    expect(montarHtml([folha(1)], 'A4')).toContain('margin: 0');
  });

  it('mantém a ordem das páginas mesmo recebendo fora de ordem', () => {
    const html = montarHtml([folha(3), folha(1), folha(2)], 'A4');
    const ordem = [...html.matchAll(/(\d{4})\.jpg/g)].map((m) => m[1]);
    expect(ordem).toEqual(['0001', '0002', '0003']);
  });

  it('escreve caminho de arquivo com barra normal, que é o que o file:// aceita', () => {
    const html = montarHtml([folha(1)], 'A4');
    expect(html).toContain('file://');
    expect(html).not.toMatch(/file:\/\/[^"]*\\/);
  });

  it('desconta a margem do tamanho da imagem, senão ela não apareceria', () => {
    const html = montarHtml([folha(1)], 'A4', { margemLadosMm: 10, margemCimaMm: 5 });
    expect(html).toContain('margin: 5mm 10mm');
    // A4 tem 210 x 297; sobra 190 x 287.
    expect(html).toContain('width: 190mm');
    expect(html).toContain('height: 287mm');
  });

  it('traduz o ajuste para o encaixe do CSS', () => {
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'pagina' })).toContain('object-fit: contain');
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'preencher' })).toContain('object-fit: cover');
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'original' })).toContain('object-fit: none');
  });

  it('cai em ajustar à página quando o ajuste é desconhecido', () => {
    expect(montarHtml([folha(1)], 'A4', { ajuste: 'inventado' })).toContain('object-fit: contain');
  });

  it('não deixa a margem comer a folha inteira', () => {
    const html = montarHtml([folha(1)], 'A5', { margemLadosMm: 999, margemCimaMm: 999 });
    // 40mm é o teto por lado; A5 tem 148 de largura, então sobram 68.
    expect(html).toContain('margin: 40mm 40mm');
    expect(html).toContain('width: 68mm');
  });
});
