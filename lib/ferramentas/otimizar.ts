import { type Tool, PDF_ACCEPT } from './tipos';

/** Ferramentas da categoria "Otimizar". */
export const OTIMIZAR: Tool[] = [
  {
    slug: 'comprimir-pdf',
    operation: 'compress',
    name: 'Comprimir PDF',
    tagline: 'Deixe o arquivo leve sem estragar',
    description:
      'Recomprime as imagens e reescreve a estrutura interna. Mesmo no nível mais agressivo o documento continua legível e utilizável. E se a compressão não ajudar, devolvemos o original.',
    icon: 'Shrink',
    accent: '16 185 129',
    category: 'Otimizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: true,
    cta: 'Comprimir agora',
    fields: [
      {
        key: 'level',
        type: 'select',
        label: 'Nível',
        default: 'sem-perda',
        options: [
          { value: 'sem-perda', label: 'Sem perda', hint: 'não altera nem um pixel; reduz menos' },
          { value: 'equilibrada', label: 'Equilibrada', hint: '150 DPI · páginas viram imagem, a cor pode mudar' },
          { value: 'maxima', label: 'Máxima', hint: '110 DPI · menor arquivo, a cor pode mudar' },
        ],
      },
      {
        key: 'juntar',
        type: 'toggle',
        label: 'Juntar tudo num arquivo só',
        default: false,
        help: 'Com vários arquivos na fila, sai um documento único na ordem em que estão, em vez de um arquivo para cada entrada.',
      },
    ],
  },
  {
    slug: 'reparar-pdf',
    operation: 'repair',
    name: 'Reparar PDF',
    tagline: 'Reescreve a estrutura de um arquivo com problema',
    description:
      'Reconstrói a tabela de referências e os objetos internos do zero. Resolve boa parte dos "esse PDF não abre", mas não recupera conteúdo que já estava perdido no original.',
    icon: 'Wrench',
    accent: '5 150 105',
    category: 'Otimizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Reparar arquivo',
    fields: [],
  },
  {
    slug: 'pdf-tons-de-cinza',
    operation: 'grayscale',
    name: 'PDF em tons de cinza',
    tagline: 'Tire a cor antes de imprimir',
    description:
      'Converte todas as páginas para cinza, garantindo que nada saia colorido na impressora. As páginas viram imagem no processo, então o texto deixa de ser selecionável.',
    icon: 'Contrast',
    accent: '133 158 143',
    category: 'Otimizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Converter para cinza',
    fields: [
      {
        key: 'dpi',
        type: 'select',
        label: 'Qualidade',
        default: '150',
        options: [
          { value: '110', label: 'Rascunho', hint: '110 DPI · arquivo menor' },
          { value: '150', label: 'Normal', hint: '150 DPI · bom para imprimir' },
          { value: '220', label: 'Alta', hint: '220 DPI · arquivo maior' },
        ],
      },
    ],
  },
];
