import { OPCOES_DE_DPI, type Field, type Tool } from './tipos';

/**
 * Ferramentas de imagem.
 *
 * Todas rodam no navegador, e aparecem no site. Não é escolha de estilo: o
 * motor Python grava só `png, pnm, pgm, ppm, pbm, pam, psd, ps, jpg, jpeg` —
 * não grava webp. O Chromium grava, e ainda decodifica webp e avif sem custar
 * um byte de instalador. É o inverso do que acontece com PDF.
 *
 * Todas aceitam vários arquivos: no balcão nunca é uma foto só.
 */

/** O que o navegador consegue abrir. */
const ENTRADA = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.bmp',
];

const FORMATO_DE_SAIDA: Field = {
  key: 'formato',
  type: 'select',
  label: 'Salvar como',
  default: 'jpeg',
  options: [
    { value: 'jpeg', label: 'JPG', hint: 'o mais compatível; não guarda transparência' },
    { value: 'png', label: 'PNG', hint: 'sem perda e com transparência; arquivo maior' },
    { value: 'webp', label: 'WEBP', hint: 'menor que o JPG na mesma qualidade; para web' },
  ],
};

const QUALIDADE: Field = {
  key: 'qualidade',
  type: 'range',
  label: 'Qualidade',
  default: 90,
  min: 30,
  max: 100,
  step: 1,
  unit: '%',
  help: 'Vale para JPG e WEBP. O PNG ignora, porque é sem perda.',
  showIf: { key: 'formato', equals: 'jpeg' },
};

export const IMAGEM: Tool[] = [
  {
    slug: 'converter-imagem',
    operation: 'convert-image',
    name: 'Converter imagem',
    tagline: 'WEBP, PNG, JPG e AVIF, em lote',
    description:
      'Troca o formato de várias imagens de uma vez. Abre WEBP, AVIF, GIF e BMP — que muito programa antigo recusa — e devolve em JPG, PNG ou WEBP. Saindo mais de uma, vem tudo num .zip.',
    icon: 'Repeat',
    accent: '14 165 233',
    category: 'Imagem',
    accept: ENTRADA,
    acceptLabel: 'imagens',
    multiple: true,
    cta: 'Converter',
    fields: [FORMATO_DE_SAIDA, QUALIDADE],
  },
  {
    slug: 'redimensionar-imagem',
    operation: 'resize-image',
    name: 'Redimensionar imagem',
    tagline: 'Por medida, por porcentagem ou para impressão',
    description:
      'Muda o tamanho de várias imagens de uma vez. O modo de impressão faz a conta de milímetro para pixel no DPI que você escolher — é o que diz se a foto do cliente aguenta o tamanho pedido.',
    icon: 'Scaling',
    accent: '99 102 241',
    category: 'Imagem',
    accept: ENTRADA,
    acceptLabel: 'imagens',
    multiple: true,
    cta: 'Redimensionar',
    fields: [
      {
        key: 'modo',
        type: 'select',
        label: 'Como medir',
        default: 'maior-lado',
        options: [
          { value: 'maior-lado', label: 'Pelo maior lado', hint: 'o outro acompanha a proporção' },
          { value: 'porcento', label: 'Por porcentagem', hint: '50% é metade de cada lado' },
          { value: 'impressao', label: 'Para impressão', hint: 'em milímetros, no DPI escolhido' },
        ],
      },
      {
        key: 'pixels',
        type: 'number',
        label: 'Maior lado (px)',
        default: 1600,
        min: 16,
        max: 20000,
        showIf: { key: 'modo', equals: 'maior-lado' },
      },
      {
        key: 'porcento',
        type: 'range',
        label: 'Tamanho',
        default: 50,
        min: 1,
        max: 400,
        step: 1,
        unit: '%',
        showIf: { key: 'modo', equals: 'porcento' },
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura (mm)',
        default: 100,
        min: 1,
        max: 5000,
        showIf: { key: 'modo', equals: 'impressao' },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura (mm)',
        default: 150,
        min: 1,
        max: 5000,
        showIf: { key: 'modo', equals: 'impressao' },
      },
      {
        key: 'dpi',
        type: 'select',
        label: 'Resolução',
        default: '300',
        options: OPCOES_DE_DPI,
        showIf: { key: 'modo', equals: 'impressao' },
      },
      {
        key: 'ajuste',
        type: 'select',
        label: 'Se a proporção não bater',
        default: 'cabe',
        options: [
          { value: 'cabe', label: 'Cabe inteira', hint: 'pode sobrar borda' },
          { value: 'preenche', label: 'Preenche', hint: 'passa da medida e é aparada depois' },
          { value: 'esticar', label: 'Estica', hint: 'medida exata, mas deforma' },
        ],
        showIf: { key: 'modo', equals: 'impressao' },
      },
      {
        key: 'aumentar',
        type: 'toggle',
        label: 'Deixar aumentar',
        default: false,
        help: 'Por padrão a imagem pequena fica como está. Esticar não cria detalhe: entrega o mesmo borrão num arquivo maior.',
      },
      FORMATO_DE_SAIDA,
      QUALIDADE,
    ],
  },
  {
    slug: 'comprimir-imagem',
    operation: 'compress-image',
    name: 'Comprimir imagem',
    tagline: 'Até o peso que o sistema aceitar',
    description:
      'Você diz o peso — "500 KB", "2 MB" — e a ferramenta procura a melhor qualidade que cabe nele. Serve para aquele site do governo que só aceita foto até um tamanho, e para anexo de e-mail.',
    icon: 'Minimize2',
    accent: '16 185 129',
    category: 'Imagem',
    accept: ENTRADA,
    acceptLabel: 'imagens',
    multiple: true,
    cta: 'Comprimir',
    fields: [
      {
        key: 'alvo',
        type: 'text',
        label: 'Peso máximo',
        default: '500 KB',
        placeholder: '500 KB',
        help: 'Aceita "500 KB", "1,5 MB" ou o número em bytes.',
      },
      {
        key: 'formato',
        type: 'select',
        label: 'Salvar como',
        default: 'jpeg',
        options: [
          { value: 'jpeg', label: 'JPG', hint: 'o mais compatível' },
          { value: 'webp', label: 'WEBP', hint: 'chega no mesmo peso com mais qualidade' },
        ],
        help: 'O PNG não entra: sendo sem perda, ele não tem como mirar um peso.',
      },
    ],
  },
  {
    slug: 'heic-para-jpg',
    operation: 'heic-to-image',
    name: 'HEIC para JPG',
    tagline: 'A foto que vem do iPhone',
    description:
      'O iPhone grava em HEIC desde 2017, e quase nada abre esse formato — nem o navegador, nem a maioria dos programas de impressão. Aqui a foto vira JPG ou PNG no tamanho original, em lote.',
    icon: 'Smartphone',
    accent: '236 72 153',
    category: 'Imagem',
    accept: ['image/heic', 'image/heif', '.heic', '.heif'],
    acceptLabel: 'HEIC do iPhone',
    multiple: true,
    cta: 'Converter',
    fields: [
      {
        key: 'formato',
        type: 'select',
        label: 'Salvar como',
        default: 'jpeg',
        options: [
          { value: 'jpeg', label: 'JPG', hint: 'o que todo mundo abre' },
          { value: 'png', label: 'PNG', hint: 'sem perda; arquivo bem maior' },
        ],
      },
      {
        key: 'qualidade',
        type: 'range',
        label: 'Qualidade',
        default: 92,
        min: 30,
        max: 100,
        step: 1,
        unit: '%',
        showIf: { key: 'formato', equals: 'jpeg' },
      },
    ],
  },
];
