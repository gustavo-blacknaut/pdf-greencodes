/**
 * A ordem da grade, que também é a numeração das ferramentas.
 *
 * Este teste já foi uma cópia da lista inteira, o que obrigava a editar dois
 * lugares em sincronia a cada ferramenta nova — e uma lista copiada que
 * precisa ser mantida à mão erra em silêncio. Agora ele confere as regras que
 * a ordenação promete, mais os primeiros lugares, que são a única parte
 * escolhida a dedo.
 */
import { describe, expect, it } from 'vitest';
import { ORDEM, TOOLS, TOOLS_DO_SITE } from './tools';
import { OPERATIONS } from './pdf/engine';

/** O começo da grade é decisão de negócio: o que mais se usa no balcão. */
const AS_PRIMEIRAS = [
  'imprimir',
  'comprimir-pdf',
  'juntar-pdf',
  'organizar-paginas',
  'remover-paginas',
  'extrair-paginas',
  'dividir-pdf',
  'reparar-pdf',
];

describe('ordem da grade', () => {
  it('começa pelas mais usadas, na ordem escolhida', () => {
    expect(TOOLS.slice(0, AS_PRIMEIRAS.length).map((t) => t.slug)).toEqual(AS_PRIMEIRAS);
  });

  it('segue a lista de ordem, sem pular ninguém', () => {
    // A ordenação é estável e a lista manda: o resultado tem que ser a lista
    // inteira, na sequência, antes de qualquer ferramenta não listada.
    const listadas = TOOLS.map((t) => t.slug).filter((slug) => ORDEM.includes(slug));
    expect(listadas).toEqual(ORDEM);
  });

  it('a lista de ordem não cita ferramenta que não existe', () => {
    // Slug renomeado e esquecido aqui empurraria tudo depois dele uma casa.
    const existentes = new Set(TOOLS.map((t) => t.slug));
    const fantasmas = ORDEM.filter((slug) => !existentes.has(slug));
    expect(fantasmas).toEqual([]);
  });

  it('ferramenta fora da lista aparece no fim, e não some', () => {
    const foraDaLista = TOOLS.filter((t) => !ORDEM.includes(t.slug));
    const ultimas = TOOLS.slice(TOOLS.length - foraDaLista.length);
    expect(ultimas).toEqual(foraDaLista);
  });

  it('não perdeu nem duplicou ferramenta na divisão por categoria', () => {
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
    expect(new Set(ORDEM).size).toBe(ORDEM.length);
  });
});

describe('o catálogo bate com o motor', () => {
  it('toda ferramenta aponta para uma operação que existe', () => {
    // É o erro que só aparece quando alguém clica: o cartão abre a tela, a
    // tela chama a operação, e o motor responde "ferramenta desconhecida".
    for (const tool of TOOLS) {
      if (tool.operation === null) continue;
      expect(Object.keys(OPERATIONS), tool.slug).toContain(tool.operation);
    }
  });

  it('duas ferramentas não disputam o mesmo endereço', () => {
    const rotas = TOOLS.map((t) => t.rota ?? t.slug);
    expect(new Set(rotas).size).toBe(rotas.length);
  });

  it('o site mostra tudo menos o que depende do motor do aplicativo', () => {
    const soNoApp = TOOLS.filter((t) => t.soNoAplicativo);
    expect(TOOLS_DO_SITE).toHaveLength(TOOLS.length - soNoApp.length);
    expect(TOOLS_DO_SITE.some((t) => t.soNoAplicativo)).toBe(false);
  });
});
