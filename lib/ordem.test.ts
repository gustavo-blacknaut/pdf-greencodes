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
import {
  FUNCIONAM_NO_SITE,
  ORDEM,
  TOOLS,
  TOOLS_DO_SITE,
  TOOLS_SO_NO_APLICATIVO,
  defaultOptions,
  getTool,
  isFieldVisible,
} from './tools';
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

  it('o site roda só a lista escolhida, e nada que precise do motor', () => {
    expect(TOOLS_DO_SITE.map((t) => t.slug).sort()).toEqual([...FUNCIONAM_NO_SITE].sort());
    expect(TOOLS_DO_SITE.some((t) => t.soNoAplicativo)).toBe(false);
  });

  it('a lista do site não cita ferramenta que não existe', () => {
    const existentes = new Set(TOOLS.map((t) => t.slug));
    expect(FUNCIONAM_NO_SITE.filter((slug) => !existentes.has(slug))).toEqual([]);
  });

  it('toda ferramenta aparece no site: ou funciona lá, ou leva ao aplicativo', () => {
    // Sumir do site era o que acontecia antes com as de motor. Agora cada uma
    // é uma porta para o download, e nenhuma cai nos dois lados ao mesmo tempo.
    expect(TOOLS_DO_SITE.length + TOOLS_SO_NO_APLICATIVO.length).toBe(TOOLS.length);
    const nosDois = TOOLS_DO_SITE.filter((t) => TOOLS_SO_NO_APLICATIVO.includes(t));
    expect(nosDois).toEqual([]);
  });
});

describe('os campos que aparecem conforme o modo', () => {
  it('o encolher só aparece no modo por tamanho, e vem ligado', () => {
    /*
     * O campo nasceu de um caso concreto: limite de 1 MB pedido, parte de
     * 3,9 MB entregue. Ele vem ligado porque é o que a pessoa espera ao
     * escrever um limite — mas continua desligável, porque encolher custa
     * qualidade e há quem prefira o arquivo maior.
     */
    const dividir = getTool('dividir-pdf')!;
    const campo = dividir.fields.find((f) => f.key === 'reduzir')!;
    expect(campo, 'o campo de encolher sumiu do catálogo').toBeDefined();
    expect(campo.default).toBe(true);

    const opcoes = defaultOptions(dividir);
    expect(isFieldVisible(campo, { ...opcoes, mode: 'size' })).toBe(true);
    expect(isFieldVisible(campo, { ...opcoes, mode: 'every' })).toBe(false);
    expect(isFieldVisible(campo, { ...opcoes, mode: 'ranges' })).toBe(false);
  });
});

describe('as chaves dos campos', () => {
  it('nenhuma ferramenta repete a chave de um campo', () => {
    /*
     * Chave repetida não estoura: os dois campos aparecem na tela com a mesma
     * identidade, o React reclama a cada renderização, e o valor padrão de um
     * sobrescreve o do outro em silêncio.
     *
     * Aconteceu no gerador de QR, quando cada tipo de conteúdo ganhou os seus
     * campos: `nome` servia ao PIX e ao contato, `numero` ao WhatsApp e ao
     * contato, `mensagem` ao WhatsApp e ao e-mail. A saída é um campo só,
     * aparecendo em mais de um tipo pelo `showIf` de lista.
     */
    for (const tool of TOOLS) {
      const chaves = tool.fields.map((campo) => campo.key);
      const repetidas = [...new Set(chaves.filter((c, i) => chaves.indexOf(c) !== i))];
      expect(repetidas, `${tool.slug} repete: ${repetidas.join(', ')}`).toEqual([]);
    }
  });

  it('todo campo com showIf aponta para um campo que existe', () => {
    // Apontar para uma chave que não existe faz o campo nunca aparecer — sem
    // erro nenhum, e sem ninguém notar até alguém procurar a opção.
    for (const tool of TOOLS) {
      const chaves = new Set(tool.fields.map((campo) => campo.key));
      for (const campo of tool.fields) {
        if (!campo.showIf) continue;
        expect(chaves.has(campo.showIf.key), `${tool.slug}: ${campo.key} depende de ${campo.showIf.key}`).toBe(true);
      }
    }
  });
});
