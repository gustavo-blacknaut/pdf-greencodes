/**
 * O catálogo das ferramentas.
 *
 * A descrição de cada uma mora no arquivo da sua categoria; aqui elas são
 * juntadas na ordem em que aparecem na tela, com os utilitários que a
 * interface usa para ler o catálogo.
 */

import { CONVERTER } from './ferramentas/converter';
import { EDITAR } from './ferramentas/editar';
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
const ORDEM = [
  'imprimir',
  'comprimir-pdf',
  'juntar-pdf',
  'organizar-paginas',
  'remover-paginas',
  'extrair-paginas',
  'dividir-pdf',
  'reparar-pdf',
  'varias-por-folha',
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

const CATALOGO = [...CONVERTER, ...OTIMIZAR, ...ORGANIZAR, ...EDITAR, ...PRIVACIDADE];

export const TOOLS: Tool[] = [...CATALOGO].sort(
  (a, b) =>
    (ORDEM.indexOf(a.slug) + 1 || ORDEM.length + 1) - (ORDEM.indexOf(b.slug) + 1 || ORDEM.length + 1),
);

export const CATEGORIES = ['Otimizar', 'Organizar', 'Converter', 'Editar', 'Privacidade'] as const;

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

export function isFieldVisible(field: Field, values: Record<string, string | number | boolean>): boolean {
  if (!field.showIf) return true;
  return String(values[field.showIf.key]) === String(field.showIf.equals);
}
