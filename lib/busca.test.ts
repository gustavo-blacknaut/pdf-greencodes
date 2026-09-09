/**
 * A busca tem que achar a ferramenta pelo nome que a pessoa usa.
 *
 * Este arquivo nasceu de uma pergunta feita no balcão: "transforma um pdf em
 * vários pdfs". A ferramenta existia — chama-se Dividir PDF — e a busca não a
 * encontrava, porque olhava só o nome, a chamada e a categoria. Quem está com
 * o cliente na frente digita o que precisa, não o nome que o programa deu.
 *
 * O que se testa aqui não é a lista de sinônimos em si, e sim que ela
 * funciona: cada termo escrito no catálogo precisa levar à ferramenta dele, e
 * as perguntas mais comuns precisam ter resposta.
 */
import { describe, expect, it } from 'vitest';
import { TOOLS, combina, normalizar } from './tools';

/** A busca de verdade, a mesma que a tela usa — e não uma cópia dela. */
function procurar(termo: string) {
  return TOOLS.filter((tool) => combina(tool, termo));
}

describe('o que a pessoa digita acha o que ela quer', () => {
  it.each([
    // A frase exata que foi perguntada no balcão, com o verbo conjugado. Ela
    // nao achava nada enquanto a busca comparava a frase inteira de uma vez.
    ['transforma um pdf em varios', 'dividir-pdf'],
    ['transformar um pdf em varios', 'dividir-pdf'],
    // A ordem nao importa, e meia palavra tambem acha.
    ['varios pdf', 'dividir-pdf'],
    ['divid', 'dividir-pdf'],
    ['separar paginas', 'dividir-pdf'],
    ['uma pagina por arquivo', 'dividir-pdf'],
    ['unir pdf', 'juntar-pdf'],
    ['mesclar', 'juntar-pdf'],
    ['diminuir tamanho', 'comprimir-pdf'],
    ['tirar a senha', 'desbloquear-pdf'],
    ['por senha', 'proteger-pdf'],
    ['tirar fundo', 'remover-fundo'],
    ['png transparente', 'remover-fundo'],
    ['iphone', 'heic-para-jpg'],
    ['scanner', 'limpar-digitalizacao'],
    ['pix', 'gerar-qrcode'],
    ['etiqueta de preco', 'gerar-codigo-barras'],
    ['banner', 'cartaz-em-partes'],
    ['duplex', 'frente-e-verso'],
    ['economizar papel', 'varias-por-folha'],
    ['negativo', 'inverter-cor'],
    ['3x4', 'folha-de-fotos'],
    ['booklet', 'livreto-pdf'],
  ])('"%s" leva a %s', (termo, slug) => {
    expect(procurar(termo).map((t) => t.slug)).toContain(slug);
  });

  it('acha sem acento e sem caixa, dos dois lados', () => {
    // "compressao" tem que achar "Compressão", e "PIX" tem que achar "pix".
    expect(procurar('COMPRIMIR').length).toBeGreaterThan(0);
    expect(procurar('cartao').map((t) => t.slug)).toContain('cartao-de-visita');
  });

  it('termo que não é de ninguém não devolve tudo', () => {
    expect(procurar('xyzabc')).toHaveLength(0);
  });
});

describe('os sinônimos do catálogo', () => {
  it('todo termo escrito acha a ferramenta que o declarou', () => {
    /*
     * É o erro fácil: escrever um sinônimo com acento, ou com uma vírgula
     * dentro, e ele nunca casar com nada. O sinônimo que não acha nada não
     * dá erro nenhum — só não serve para nada, em silêncio.
     */
    for (const tool of TOOLS) {
      for (const termo of tool.busca ?? []) {
        expect(procurar(termo).map((t) => t.slug), `"${termo}" em ${tool.slug}`).toContain(tool.slug);
      }
    }
  });

  it('a maior parte do catálogo tem sinônimo', () => {
    // Não exijo de todas: há ferramenta cujo nome já é como se fala dela.
    // Mas se a proporção cair muito, alguém adicionou dez sem pensar nisso.
    const com = TOOLS.filter((t) => t.busca?.length).length;
    expect(com / TOOLS.length).toBeGreaterThan(0.8);
  });

  it('não repete o próprio nome como sinônimo', () => {
    // Repetir o nome não acrescenta nada: a busca já olha o nome.
    for (const tool of TOOLS) {
      for (const termo of tool.busca ?? []) {
        expect(normalizar(termo), `${tool.slug}`).not.toBe(normalizar(tool.name));
      }
    }
  });
});
