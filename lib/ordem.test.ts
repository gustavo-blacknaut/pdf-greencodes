/**
 * A divisão do catálogo em arquivos por categoria não pode mudar o que a
 * pessoa vê. Este teste prende a ordem da grade, que também é a numeração.
 */
import { describe, expect, it } from 'vitest';
import { TOOLS } from './tools';

const ORDEM_ESPERADA = [
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
  'numeracao-sequencial',
  'folha-de-fotos',
  'separar-chapas',
  'cobertura-de-tinta',
  'verificar-impressao',
  'espelhar-pdf',
  'repetir-paginas',
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
  'texto-para-pdf'
];

describe('ordem da grade', () => {
  it('mantém a ordem escolhida a dedo, e não a das categorias', () => {
    expect(TOOLS.map((t) => t.slug)).toEqual(ORDEM_ESPERADA);
  });

  it('não perdeu nem duplicou ferramenta na divisão', () => {
    expect(TOOLS).toHaveLength(ORDEM_ESPERADA.length);
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
  });
});
