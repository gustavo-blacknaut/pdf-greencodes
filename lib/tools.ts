/**
 * O catálogo das ferramentas.
 *
 * A descrição de cada uma mora no arquivo da sua categoria; aqui elas são
 * juntadas na ordem em que aparecem na tela, com os utilitários que a
 * interface usa para ler o catálogo.
 */

import { CODIGOS } from './ferramentas/codigos';
import { CONVERTER } from './ferramentas/converter';
import { EDITAR } from './ferramentas/editar';
import { GRAFICA } from './ferramentas/grafica';
import { BOLETO } from './ferramentas/boleto';
import { IMAGEM } from './ferramentas/imagem';
import { ORGANIZAR } from './ferramentas/organizar';
import { OTIMIZAR } from './ferramentas/otimizar';
import { PRIVACIDADE } from './ferramentas/privacidade';
import type { Field, Tool } from './ferramentas/tipos';

export type { BoardMode, Field, FieldBase, Tool } from './ferramentas/tipos';

/**
 * A ordem em que as ferramentas aparecem na grade, e portanto a numeração.
 *
 * Fica explícita aqui porque não é alfabética nem por categoria: as mais
 * usadas vêm primeiro. Ferramenta fora desta lista entra no fim, então
 * esquecer de incluir não some com ela da tela.
 */
export const ORDEM = [
  'imprimir',
  'comprimir-pdf',
  'juntar-pdf',
  'organizar-paginas',
  'remover-paginas',
  'extrair-paginas',
  'dividir-pdf',
  'reparar-pdf',
  'varias-por-folha',
  'marcas-de-corte',
  'cartao-de-visita',
  'etiquetas',
  'gerar-qrcode',
  'gerar-codigo-barras',
  'numeracao-sequencial',
  'folha-de-fotos',
  'cartaz-em-partes',
  'adicionar-sangria',
  'marcas-de-dobra',
  'frente-e-verso',
  'carimbar-logo',
  'separar-chapas',
  'cobertura-de-tinta',
  'verificar-impressao',
  'espelhar-pdf',
  'repetir-paginas',
  'converter-imagem',
  'redimensionar-imagem',
  'comprimir-imagem',
  'heic-para-jpg',
  'melhorar-imagem',
  'cortar-imagem',
  'remover-fundo',
  'ajustar-imagem',
  'limpar-digitalizacao',
  'girar-imagem',
  'juntar-imagens',
  'moldura-imagem',
  'marca-dagua-imagem',
  'ler-boleto',
  'imprimir-boleto',
  'girar-pdf',
  'assinar-pdf',
  'editar-pdf',
  'cortar-pdf',
  'redimensionar-pdf',
  'marca-dagua',
  'numerar-paginas',
  'pdf-para-jpg',
  'jpg-para-pdf',
  'pdf-para-texto',
  'ocr-pdf',
  'word-para-pdf',
  'pdf-para-word',
  'extrair-imagens',
  'proteger-pdf',
  'desbloquear-pdf',
  'limpar-metadados',
  'definir-metadados',
  'inverter-paginas',
  'intercalar-pdf',
  'pdf-tons-de-cinza',
  'inverter-cor',
  'pdf-tons-de-preto',
  'rgb-para-cmyk',
  'achatar-pdf',
  'cabecalho-rodape',
  'dividir-paginas',
  'livreto-pdf',
  'separar-pares-impares',
  'paginas-em-branco',
  'excel-para-pdf',
  'powerpoint-para-pdf',
  'texto-para-pdf',
];

const CATALOGO = [
  ...CONVERTER,
  ...OTIMIZAR,
  ...ORGANIZAR,
  ...EDITAR,
  ...GRAFICA,
  ...IMAGEM,
  ...CODIGOS,
  ...BOLETO,
  ...PRIVACIDADE,
];

export const TOOLS: Tool[] = [...CATALOGO].sort(
  (a, b) =>
    (ORDEM.indexOf(a.slug) + 1 || ORDEM.length + 1) - (ORDEM.indexOf(b.slug) + 1 || ORDEM.length + 1),
);

/**
 * O que funciona no site. O resto aparece lá com o selo "Só no aplicativo" e
 * o botão de baixar, em vez de sumir.
 *
 * Decisão do Gustavo (2026-09-11): o site é a porta de entrada, com o básico
 * — o que o iLovePDF oferece —, e o trabalho de gráfica fica no aplicativo,
 * que é mais rápido e aceita arquivo de GB. Mudar o que o site oferece é
 * mexer só nesta lista.
 *
 * Ferramenta que precisa do motor do aplicativo (`soNoAplicativo`) não entra
 * nem se for listada aqui: no navegador ela não teria como funcionar.
 */
export const FUNCIONAM_NO_SITE = [
  'comprimir-pdf',
  'juntar-pdf',
  'dividir-pdf',
  'organizar-paginas',
  'remover-paginas',
  'extrair-paginas',
  'girar-pdf',
  'pdf-para-jpg',
  'jpg-para-pdf',
  'word-para-pdf',
  'pdf-para-word',
  'excel-para-pdf',
  'powerpoint-para-pdf',
  'assinar-pdf',
  'numerar-paginas',
  'marca-dagua',
  'proteger-pdf',
  'desbloquear-pdf',
  'reparar-pdf',
  'gerar-qrcode',
];

export function funcionaNoSite(tool: Tool): boolean {
  return !tool.soNoAplicativo && FUNCIONAM_NO_SITE.includes(tool.slug);
}

/** As que rodam no site, na ordem da grade. */
export const TOOLS_DO_SITE: Tool[] = TOOLS.filter(funcionaNoSite);

/** As que o site mostra só para levar ao aplicativo. */
export const TOOLS_SO_NO_APLICATIVO: Tool[] = TOOLS.filter((tool) => !funcionaNoSite(tool));

export const CATEGORIES = [
  'Otimizar',
  'Organizar',
  'Converter',
  'Editar',
  'Gráfica',
  'Imagem',
  'Códigos',
  'Boleto',
  'Privacidade',
] as const;

/** Onde a ferramenta vive. A de impressão tem página própria. */
export function rotaDaFerramenta(tool: Tool, base: '' | '/app' = ''): string {
  return `${base}/${tool.rota ?? tool.slug}`;
}

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

export function defaultOptions(tool: Tool): Record<string, string | number | boolean> {
  const values = Object.fromEntries(tool.fields.map((field) => [field.key, field.default]));
  // A grade de páginas publica o plano assim que as miniaturas carregam.
  if (tool.board) {
    values.plan = '[]';
    values.board = tool.board;
  }
  if (tool.editor) {
    values.elementos = '[]';
    values.editor = tool.editor;
  }
  return values;
}

/** "compressao" acha "Compressão": sem acento e sem caixa dos dois lados. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * A ferramenta responde ao que a pessoa digitou?
 *
 * Casa palavra por palavra, e não a frase inteira de uma vez. A diferença
 * apareceu com uma pergunta de verdade: "transforma um pdf em vários" não
 * achava nada, porque o sinônimo escrito era "transformar" — e "transforma um
 * pdf" não é um pedaço de "transformar um pdf", por causa do "r" no meio.
 *
 * Exigindo que cada palavra apareça em algum lugar, a ordem deixa de importar
 * ("pdf vários" acha igual), o verbo conjugado acha o infinitivo, e quem
 * digita meia palavra continua achando enquanto digita.
 *
 * Fica aqui, e não na tela, para o teste medir a busca de verdade em vez de
 * uma cópia dela que pode envelhecer sozinha.
 */
export function combina(tool: Tool, termo: string): boolean {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;

  const procuravel = normalizar(
    `${tool.name} ${tool.tagline} ${tool.category} ${tool.busca?.join(' ') ?? ''}`,
  );
  return palavras.every((palavra) => procuravel.includes(palavra));
}

export function isFieldVisible(field: Field, values: Record<string, string | number | boolean>): boolean {
  if (!field.showIf) return true;
  const atual = String(values[field.showIf.key]);
  const aceitos = Array.isArray(field.showIf.equals) ? field.showIf.equals : [field.showIf.equals];
  return aceitos.some((valor) => String(valor) === atual);
}
