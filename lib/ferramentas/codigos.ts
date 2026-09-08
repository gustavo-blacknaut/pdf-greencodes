import { FORMATOS_MM } from '../pdf/nucleo';
import { CORRECOES } from '../codigos/qr';
import { SIMBOLOGIAS } from '../codigos/barras';
import type { Field, Tool } from './tipos';

/**
 * Gerador de QR Code e de código de barras.
 *
 * Nenhuma das duas recebe arquivo: a entrada é o texto. Uma linha por
 * código, o que transforma a mesma tela num gerador em lote — colar ali uma
 * coluna do Excel é o caso mais comum, e não precisou de campo nenhum a mais
 * para funcionar.
 */

const PAPEIS: Field = {
  key: 'papel',
  type: 'select',
  label: 'Papel',
  default: 'a4',
  options: Object.entries(FORMATOS_MM).map(([valor, medida]) => ({
    value: valor,
    label: valor.toUpperCase(),
    hint: `${medida.largura} x ${medida.altura} mm`,
  })),
  showIf: { key: 'saida', equals: 'folha' },
};

const SAIDA: Field = {
  key: 'saida',
  type: 'select',
  label: 'Como entregar',
  default: 'png',
  options: [
    { value: 'png', label: 'PNG', hint: 'para mandar no WhatsApp, pôr no site, colar num slide' },
    { value: 'pdf', label: 'PDF do tamanho exato', hint: 'uma página por código, na medida em milímetros' },
    { value: 'folha', label: 'Folha de etiquetas', hint: 'vários por folha, prontos para recortar' },
  ],
  help: 'Para imprimir, prefira PDF: lá o código é desenho vetorial e a medida sai exata em qualquer resolução.',
};

const MARGEM: Field = {
  key: 'margemMm',
  type: 'number',
  label: 'Margem da folha (mm)',
  default: 8,
  min: 0,
  max: 40,
  showIf: { key: 'saida', equals: 'folha' },
};

const ESPACO: Field = {
  key: 'espacoMm',
  type: 'number',
  label: 'Espaço entre eles (mm)',
  default: 3,
  min: 0,
  max: 30,
  showIf: { key: 'saida', equals: 'folha' },
};

const REPETIR: Field = {
  key: 'repetir',
  type: 'number',
  label: 'Repetir cada um',
  default: 1,
  min: 1,
  max: 500,
  help: 'Quantas etiquetas iguais de cada código. Elas saem em bloco, na ordem, para recortar de uma vez.',
  showIf: { key: 'saida', equals: 'folha' },
};

export const CODIGOS: Tool[] = [
  {
    slug: 'gerar-qrcode',
    operation: 'qr-code',
    name: 'Gerar QR Code',
    tagline: 'Um por linha, em PNG ou em folha de etiquetas',
    description:
      'Endereço de site, PIX copia-e-cola, wi-fi, telefone, texto: o que estiver escrito vira QR Code. Uma linha para cada código, então dá para colar uma coluna inteira da planilha e receber tudo de uma vez. No PDF o código sai em vetor, e é isso que faz ele ler impresso pequeno.',
    icon: 'QrCode',
    accent: '20 184 166',
    category: 'Códigos',
    accept: [],
    acceptLabel: '',
    multiple: false,
    semArquivo: true,
    cta: 'Gerar',
    fields: [
      {
        key: 'conteudo',
        type: 'texto-longo',
        label: 'O que vai dentro',
        default: '',
        placeholder: 'https://exemplo.com.br\n\nUma linha para cada código.',
        help: 'Cada linha vira um QR Code. Linha vazia é ignorada.',
      },
      SAIDA,
      {
        key: 'correcao',
        type: 'select',
        label: 'Correção de erro',
        default: 'M',
        options: Object.entries(CORRECOES).map(([valor, dados]) => ({
          value: valor,
          label: dados.rotulo,
          hint: `lê com até ${dados.perda} do código danificado`,
        })),
        help: 'Mais correção aguenta sujeira e dobra, mas aperta mais módulos no mesmo espaço. Para adesivo de vitrine e etiqueta de caixa, vale subir.',
      },
      {
        key: 'ladoMm',
        type: 'number',
        label: 'Tamanho do lado (mm)',
        default: 30,
        min: 5,
        max: 200,
        help: 'Abaixo de 20 mm, um código com muito conteúdo começa a falhar em celular antigo.',
        showIf: { key: 'saida', equals: ['pdf', 'folha'] },
      },
      {
        key: 'pixels',
        type: 'number',
        label: 'Tamanho (px)',
        default: 600,
        min: 64,
        max: 4000,
        showIf: { key: 'saida', equals: 'png' },
      },
      PAPEIS,
      { key: 'deitado', type: 'toggle', label: 'Folha deitada', default: false, showIf: { key: 'saida', equals: 'folha' } },
      MARGEM,
      ESPACO,
      REPETIR,
    ],
  },
  {
    slug: 'gerar-codigo-barras',
    operation: 'barcode',
    name: 'Gerar código de barras',
    tagline: 'EAN, Code 128, Code 39 e ITF',
    description:
      'Etiqueta de preço, código interno, caixa de transporte. Calcula o dígito verificador sozinho, respeita a zona de silêncio da norma e avisa quando a barra ficou fina demais para a impressora dar conta. No PDF a largura da barra sai exata — e é ela, não o desenho, que decide se o leitor do caixa bipa.',
    icon: 'Barcode',
    accent: '100 116 139',
    category: 'Códigos',
    accept: [],
    acceptLabel: '',
    multiple: false,
    semArquivo: true,
    cta: 'Gerar',
    fields: [
      {
        key: 'simbologia',
        type: 'select',
        label: 'Tipo de código',
        default: 'code128',
        options: Object.entries(SIMBOLOGIAS).map(([valor, dados]) => ({
          value: valor,
          label: dados.nome,
          hint: dados.sobre,
        })),
      },
      {
        key: 'conteudo',
        type: 'texto-longo',
        label: 'O que vai dentro',
        default: '',
        placeholder: 'GRAFICA-001\n\nUma linha para cada código.',
        help: 'Cada linha vira um código. O EAN dispensa o último dígito: ele é calculado.',
      },
      SAIDA,
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura (mm)',
        default: 50,
        min: 15,
        max: 300,
        help: 'Estreito demais fecha o espaço entre barras quando a tinta espalha no papel. O aviso no fim mede isso.',
        showIf: { key: 'saida', equals: ['pdf', 'folha'] },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura (mm)',
        default: 20,
        min: 6,
        max: 100,
        help: 'O EAN de mercado tem 22,85 mm. Etiqueta interna funciona com 12 a 15.',
      },
      {
        key: 'pixels',
        type: 'number',
        label: 'Largura (px)',
        default: 900,
        min: 200,
        max: 4000,
        showIf: { key: 'saida', equals: 'png' },
      },
      {
        key: 'legenda',
        type: 'toggle',
        label: 'Escrever o número embaixo',
        default: true,
        help: 'Serve para digitar à mão quando o leitor não pega — e é obrigatório no EAN de varejo.',
      },
      PAPEIS,
      { key: 'deitado', type: 'toggle', label: 'Folha deitada', default: false, showIf: { key: 'saida', equals: 'folha' } },
      MARGEM,
      ESPACO,
      REPETIR,
    ],
  },
];
