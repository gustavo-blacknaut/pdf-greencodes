import type { OperationId } from './pdf/engine';

export type FieldBase = {
  key: string;
  label: string;
  help?: string;
  /** Só aparece quando outro campo tem determinado valor. */
  showIf?: { key: string; equals: string | number | boolean };
};

export type Field =
  | (FieldBase & {
      type: 'select';
      default: string;
      options: { value: string; label: string; hint?: string }[];
    })
  | (FieldBase & { type: 'text'; default: string; placeholder?: string })
  | (FieldBase & { type: 'password'; default: string; placeholder?: string })
  | (FieldBase & { type: 'number'; default: number; min: number; max: number; step?: number })
  | (FieldBase & { type: 'range'; default: number; min: number; max: number; step?: number; unit?: string })
  | (FieldBase & { type: 'toggle'; default: boolean });

/** Ferramentas que trabalham com a grade de miniaturas em vez de campos. */
export type BoardMode = 'organize' | 'remove' | 'keep' | 'rotate';

export type Tool = {
  slug: string;
  /** Nulo nas ferramentas que têm página própria, fora do fluxo genérico. */
  operation: OperationId | null;
  /** Caminho próprio, quando a ferramenta não é servida por /[slug]. */
  rota?: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  accent: string;
  category: 'Otimizar' | 'Organizar' | 'Converter' | 'Editar' | 'Privacidade';
  accept: string[];
  acceptLabel: string;
  multiple: boolean;
  orderable?: boolean;
  /** Aceita PDFs com senha de abertura (só a ferramenta de desbloqueio). */
  allowLocked?: boolean;
  /** Substitui o painel de opções pela grade visual de páginas. */
  board?: BoardMode;
  /** Abre o editor visual sobre a página. */
  editor?: 'completo' | 'assinatura';
  cta: string;
  fields: Field[];
};

const PDF_ACCEPT = ['application/pdf', '.pdf'];
const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp'];

export const TOOLS: Tool[] = [
  {
    slug: 'imprimir',
    operation: null,
    rota: 'imprimir',
    name: 'Imprimir',
    tagline: 'Fila com fotos, PDFs e Word juntos',
    description:
      'Solte fotos, PDFs, Word, Excel e texto de uma vez. Cada arquivo entra numa fila, é convertido aqui mesmo e sai como um trabalho próprio na impressora, sem precisar juntar tudo num documento antes.',
    icon: 'Printer',
    accent: '52 211 153',
    category: 'Converter',
    accept: [
      'application/pdf',
      '.pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.docx',
      '.xlsx',
      '.pptx',
      '.txt',
    ],
    acceptLabel: 'PDF, imagem, Word, Excel, PowerPoint ou texto',
    multiple: true,
    cta: 'Imprimir',
    fields: [],
  },
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
    ],
  },
  {
    slug: 'juntar-pdf',
    operation: 'merge',
    name: 'Juntar PDF',
    tagline: 'PDFs e fotos num documento só',
    description:
      'Combine quantos PDFs e imagens quiser, na ordem que você definir arrastando os cards ou ordenando de A a Z. Arquivo protegido por senha também entra: a gente pede a senha e entrega o resultado sem ela.',
    icon: 'Combine',
    accent: '20 184 166',
    category: 'Organizar',
    accept: [...PDF_ACCEPT, ...IMAGE_ACCEPT],
    acceptLabel: 'PDF, JPG, PNG ou WebP',
    multiple: true,
    orderable: true,
    cta: 'Juntar arquivos',
    fields: [
      {
        key: 'filename',
        type: 'text',
        label: 'Nome do arquivo final',
        default: 'documento-unido',
        placeholder: 'documento-unido',
      },
      {
        key: 'formatoImagem',
        type: 'select',
        label: 'Páginas vindas de imagem',
        default: 'a4',
        options: [
          { value: 'a4', label: 'A4', hint: 'a orientação segue a foto' },
          { value: 'imagem', label: 'Tamanho da própria imagem' },
        ],
        help: 'Só afeta as fotos. Os PDFs entram com o tamanho de página original.',
      },
      {
        key: 'fundoBranco',
        type: 'toggle',
        label: 'Forçar fundo branco',
        default: true,
        help: 'Alguns PDFs não desenham fundo e contam com o papel branco do leitor. Ao juntar, esse fundo some e a página sai cinza ou preta. Isto pinta branco por baixo, sem mexer no conteúdo.',
      },
    ],
  },
  {
    slug: 'organizar-paginas',
    operation: 'apply-plan',
    name: 'Organizar páginas',
    tagline: 'Reordene, gire e exclua vendo tudo',
    description:
      'Todas as páginas em miniatura: arraste para reordenar, gire uma a uma e remova o que não serve. Tudo numa passada só.',
    icon: 'LayoutGrid',
    accent: '52 211 153',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    board: 'organize',
    cta: 'Salvar documento',
    fields: [],
  },
  {
    slug: 'remover-paginas',
    operation: 'apply-plan',
    name: 'Remover páginas',
    tagline: 'Clique nas páginas que devem sair',
    description:
      'Mostramos o documento inteiro em miniaturas. Clique nas páginas que você quer fora e elas ficam marcadas, dá para conferir tudo antes de salvar.',
    icon: 'FileMinus',
    accent: '74 222 128',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    board: 'remove',
    cta: 'Remover as marcadas',
    fields: [],
  },
  {
    slug: 'extrair-paginas',
    operation: 'apply-plan',
    name: 'Extrair páginas',
    tagline: 'Clique nas páginas que quer guardar',
    description:
      'O contrário de remover: clique para selecionar as páginas que vão para o novo arquivo, na ordem original.',
    icon: 'FilePlus',
    accent: '45 212 191',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    board: 'keep',
    cta: 'Extrair as selecionadas',
    fields: [],
  },
  {
    slug: 'dividir-pdf',
    operation: 'split',
    name: 'Dividir PDF',
    tagline: 'Quebre em partes por tamanho, intervalos ou páginas',
    description:
      'Fatie por tamanho (ex: até 10MB), por intervalos de páginas ou a cada N páginas, ou extraia apenas as selecionadas. Quando gera mais de um arquivo, entregamos em .zip.',
    icon: 'Scissors',
    accent: '132 204 22',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Dividir',
    fields: [
      {
        key: 'mode',
        type: 'select',
        label: 'Como dividir',
        default: 'every',
        options: [
          { value: 'every', label: 'A cada N páginas' },
          { value: 'ranges', label: 'Por intervalos' },
          { value: 'size', label: 'Por tamanho de arquivo (MB)' },
          { value: 'extract', label: 'Extrair páginas selecionadas' },
        ],
      },
      {
        key: 'every',
        type: 'number',
        label: 'Páginas por arquivo',
        default: 1,
        min: 1,
        max: 500,
        showIf: { key: 'mode', equals: 'every' },
      },
      {
        key: 'ranges',
        type: 'text',
        label: 'Intervalos',
        default: '1-3, 4-6',
        placeholder: '1-3, 4-6, 7-',
        help: 'Cada intervalo vira um arquivo. Separe com vírgula.',
        showIf: { key: 'mode', equals: 'ranges' },
      },
      {
        key: 'maxSize',
        type: 'number',
        label: 'Tamanho máximo por arquivo (MB)',
        default: 10,
        min: 1,
        max: 500,
        step: 1,
        help: 'Dividirá o PDF em arquivos com até este tamanho limite (ex: 10 MB).',
        showIf: { key: 'mode', equals: 'size' },
      },
      {
        key: 'extractRanges',
        type: 'text',
        label: 'Páginas a extrair (manter)',
        default: '1',
        placeholder: '1, 3, 5-8',
        help: 'Gera um único PDF mantendo apenas as páginas informadas (ex: 1, 3-5).',
        showIf: { key: 'mode', equals: 'extract' },
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
    slug: 'varias-por-folha',
    operation: 'n-up',
    name: 'Várias por folha',
    tagline: 'Duas ou quatro páginas por folha',
    description: 'Monta um PDF econômico para impressão, encaixando 2 ou 4 páginas em cada folha A4.',
    icon: 'Grid2x2',
    accent: '163 230 53',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Montar folhas',
    fields: [
      {
        key: 'perSheet',
        type: 'select',
        label: 'Páginas por folha',
        default: '2',
        options: [
          { value: '2', label: '2 por folha', hint: 'A4 deitada, lado a lado' },
          { value: '4', label: '4 por folha', hint: 'A4 em pé, grade 2 × 2' },
        ],
      },
      {
        key: 'espacamentoMm',
        type: 'range',
        label: 'Espaço entre as páginas',
        default: 0,
        min: 0,
        max: 20,
        step: 1,
        unit: 'mm',
        help: 'Vão entre uma página e outra, sem tocar na beirada da folha.',
      },
      {
        key: 'margemMm',
        type: 'range',
        label: 'Margem na beirada',
        default: 0,
        min: 0,
        max: 20,
        step: 1,
        unit: 'mm',
        help: 'Zero usa a folha inteira. O PDF não precisa de margem de segurança: quem cuida disso é a impressora, na opção de ajustar a área impressa.',
      },
      { key: 'border', type: 'toggle', label: 'Desenhar moldura', default: false },
    ],
  },
  {
    slug: 'girar-pdf',
    operation: 'apply-plan',
    name: 'Girar PDF',
    tagline: 'Clique na página para endireitar',
    description:
      'Cada clique numa miniatura gira aquela página 90°. Se o documento inteiro veio torto, um botão gira todas de uma vez.',
    icon: 'RotateCw',
    accent: '34 197 94',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    board: 'rotate',
    cta: 'Salvar rotação',
    fields: [],
  },
  {
    slug: 'assinar-pdf',
    operation: 'edit',
    name: 'Assinar PDF',
    tagline: 'Desenhe e arraste para onde quiser',
    description:
      'Desenhe a assinatura com o mouse ou o dedo, ou envie uma foto dela. Depois é só arrastar até o lugar certo em qualquer página e ajustar o tamanho pelo canto.',
    icon: 'PenLine',
    accent: '52 211 153',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    editor: 'assinatura',
    cta: 'Salvar assinado',
    fields: [],
  },
  {
    slug: 'editar-pdf',
    operation: 'edit',
    name: 'Editar PDF',
    tagline: 'Escreva, tape e destaque em cima do documento',
    description:
      'Adicione caixas de texto, cubra trechos com um retângulo branco para escrever por cima, passe marca-texto e insira imagens ou assinatura, em qualquer página.',
    icon: 'PencilLine',
    accent: '132 204 22',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    editor: 'completo',
    cta: 'Salvar edições',
    fields: [],
  },
  {
    slug: 'cortar-pdf',
    operation: 'crop',
    name: 'Cortar PDF',
    tagline: 'Corte as margens sobrando',
    description:
      'Reduz a área visível da página por porcentagem em cada lado. Ótimo para tirar margens gigantes de digitalizações.',
    icon: 'Crop',
    accent: '22 163 74',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Cortar',
    fields: [
      { key: 'top', type: 'range', label: 'Topo', default: 0, min: 0, max: 45, step: 1, unit: '%' },
      { key: 'bottom', type: 'range', label: 'Base', default: 0, min: 0, max: 45, step: 1, unit: '%' },
      { key: 'left', type: 'range', label: 'Esquerda', default: 0, min: 0, max: 45, step: 1, unit: '%' },
      { key: 'right', type: 'range', label: 'Direita', default: 0, min: 0, max: 45, step: 1, unit: '%' },
    ],
  },
  {
    slug: 'redimensionar-pdf',
    operation: 'resize',
    name: 'Redimensionar PDF',
    tagline: 'Padronize tudo em A4, Carta ou escala',
    description:
      'Uniformiza páginas de tamanhos diferentes num formato só, centralizando o conteúdo e preservando a orientação de cada uma.',
    icon: 'Scaling',
    accent: '13 148 136',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Redimensionar',
    fields: [
      {
        key: 'target',
        type: 'select',
        label: 'Formato final',
        default: 'a4',
        options: [
          { value: 'a4', label: 'A4', hint: '210 × 297 mm' },
          { value: 'a3', label: 'A3', hint: '297 × 420 mm' },
          { value: 'a5', label: 'A5', hint: '148 × 210 mm' },
          { value: 'carta', label: 'Carta', hint: '216 × 279 mm' },
          { value: 'oficio', label: 'Ofício', hint: '216 × 356 mm' },
          { value: 'personalizado', label: 'Personalizado em mm' },
          { value: 'scale', label: 'Escala livre', hint: 'mantém a proporção original' },
        ],
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura',
        default: 210,
        min: 10,
        max: 2000,
        help: 'Em milímetros.',
        showIf: { key: 'target', equals: 'personalizado' },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura',
        default: 297,
        min: 10,
        max: 2000,
        showIf: { key: 'target', equals: 'personalizado' },
      },
      {
        key: 'scale',
        type: 'range',
        label: 'Escala',
        default: 100,
        min: 25,
        max: 400,
        step: 5,
        unit: '%',
        showIf: { key: 'target', equals: 'scale' },
      },
    ],
  },
  {
    slug: 'marca-dagua',
    operation: 'watermark',
    name: 'Marca d’água',
    tagline: 'Assine o documento em todas as páginas',
    description: 'Texto diagonal e translúcido, com opção de repetir em mosaico por toda a página.',
    icon: 'Stamp',
    accent: '110 231 183',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Aplicar marca d’água',
    fields: [
      { key: 'text', type: 'text', label: 'Texto', default: 'CONFIDENCIAL', placeholder: 'CONFIDENCIAL' },
      { key: 'size', type: 'range', label: 'Tamanho', default: 48, min: 10, max: 140, step: 2, unit: 'pt' },
      { key: 'opacity', type: 'range', label: 'Opacidade', default: 0.18, min: 0.03, max: 1, step: 0.03 },
      { key: 'angle', type: 'range', label: 'Inclinação', default: 45, min: -90, max: 90, step: 5, unit: '°' },
      { key: 'shade', type: 'range', label: 'Tom de cinza', default: 0.4, min: 0, max: 1, step: 0.05 },
      { key: 'tile', type: 'toggle', label: 'Repetir em mosaico', default: false },
    ],
  },
  {
    slug: 'numerar-paginas',
    operation: 'page-numbers',
    name: 'Numerar páginas',
    tagline: 'Enumeração no rodapé ou no topo',
    description: 'Adiciona o número de cada página no canto que você escolher, a partir do número inicial que preferir.',
    icon: 'Hash',
    accent: '16 185 129',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Numerar páginas',
    fields: [
      {
        key: 'position',
        type: 'select',
        label: 'Posição',
        default: 'rodape-centro',
        options: [
          { value: 'rodape-centro', label: 'Rodapé, centro' },
          { value: 'rodape-esquerda', label: 'Rodapé, esquerda' },
          { value: 'rodape-direita', label: 'Rodapé, direita' },
          { value: 'topo-centro', label: 'Topo, centro' },
          { value: 'topo-esquerda', label: 'Topo, esquerda' },
          { value: 'topo-direita', label: 'Topo, direita' },
        ],
      },
      {
        key: 'format',
        type: 'select',
        label: 'Formato',
        default: 'numero',
        options: [
          { value: 'numero', label: '1, 2, 3...' },
          { value: 'de-total', label: 'Página 1 de 10' },
        ],
      },
      {
        key: 'startAt',
        type: 'number',
        label: 'Começar a contar em',
        default: 1,
        min: 1,
        max: 9999,
      },
      {
        key: 'size',
        type: 'range',
        label: 'Tamanho',
        default: 11,
        min: 6,
        max: 36,
        step: 1,
        unit: 'pt',
      },
    ],
  },
  {
    slug: 'pdf-para-jpg',
    operation: 'pdf-to-images',
    name: 'PDF para imagem',
    tagline: 'Cada página vira JPG ou PNG',
    description: 'Renderiza as páginas em alta resolução. Com mais de uma página, entregamos tudo em um .zip.',
    icon: 'ImageIcon',
    accent: '5 150 105',
    category: 'Converter',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Converter para imagem',
    fields: [
      {
        key: 'format',
        type: 'select',
        label: 'Formato',
        default: 'jpeg',
        options: [
          { value: 'jpeg', label: 'JPG', hint: 'leve, ideal para documentos' },
          { value: 'png', label: 'PNG', hint: 'sem perda, arquivos maiores' },
        ],
      },
      { key: 'dpi', type: 'range', label: 'Resolução', default: 150, min: 72, max: 300, step: 6, unit: 'DPI' },
      {
        key: 'quality',
        type: 'range',
        label: 'Qualidade JPG',
        default: 0.85,
        min: 0.4,
        max: 1,
        step: 0.05,
        showIf: { key: 'format', equals: 'jpeg' },
      },
    ],
  },
  {
    slug: 'jpg-para-pdf',
    operation: 'images-to-pdf',
    name: 'Imagem para PDF',
    tagline: 'Fotos e prints viram um PDF só',
    description: 'Aceita JPG, PNG e WebP. Escolha entre página do tamanho da imagem ou A4 centralizado.',
    icon: 'FileImage',
    accent: '134 239 172',
    category: 'Converter',
    accept: IMAGE_ACCEPT,
    acceptLabel: 'JPG, PNG ou WebP',
    multiple: true,
    orderable: true,
    cta: 'Gerar PDF',
    fields: [
      {
        key: 'formato',
        type: 'select',
        label: 'Tamanho da página',
        default: 'imagem',
        options: [
          { value: 'imagem', label: 'Do tamanho da imagem' },
          { value: 'a4', label: 'A4', hint: '210 × 297 mm' },
          { value: 'a5', label: 'A5', hint: '148 × 210 mm' },
          { value: 'carta', label: 'Carta', hint: '216 × 279 mm' },
          { value: '10x15', label: 'Foto 10 × 15 cm' },
          { value: '13x18', label: 'Foto 13 × 18 cm' },
          { value: 'personalizado', label: 'Personalizado em mm' },
        ],
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura',
        default: 50,
        min: 10,
        max: 2000,
        help: 'Em milímetros. Para 50 × 70 cm, use 500 e 700.',
        showIf: { key: 'formato', equals: 'personalizado' },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura',
        default: 70,
        min: 10,
        max: 2000,
        showIf: { key: 'formato', equals: 'personalizado' },
      },
      {
        key: 'ajuste',
        type: 'select',
        label: 'Como encaixar a foto',
        default: 'proporcao',
        options: [
          { value: 'proporcao', label: 'Manter proporção', hint: 'cabe inteira, pode sobrar branco' },
          { value: 'preencher', label: 'Preencher cortando', hint: 'dá um zoom e corta o excesso' },
          { value: 'esticar', label: 'Esticar', hint: 'ocupa tudo, mas distorce' },
        ],
      },
      {
        key: 'orientacao',
        type: 'select',
        label: 'Orientação',
        default: 'auto',
        options: [
          { value: 'auto', label: 'Seguir a foto' },
          { value: 'retrato', label: 'Sempre em pé' },
        ],
      },
      { key: 'margemMm', type: 'range', label: 'Margem', default: 0, min: 0, max: 50, step: 1, unit: 'mm' },
      { key: 'filename', type: 'text', label: 'Nome do arquivo final', default: 'imagens', placeholder: 'imagens' },
    ],
  },
  {
    slug: 'pdf-para-texto',
    operation: 'pdf-to-text',
    name: 'PDF para texto',
    tagline: 'Todo o texto num .txt',
    description:
      'Extrai o texto embutido no PDF, página por página. Em documento digitalizado não há texto para extrair — a gente avisa e sugere rodar a ferramenta de OCR antes.',
    icon: 'FileType',
    accent: '101 163 13',
    category: 'Converter',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Extrair texto',
    fields: [{ key: 'separators', type: 'toggle', label: 'Marcar o número de cada página', default: true }],
  },
  {
    slug: 'ocr-pdf',
    operation: 'ocr',
    name: 'OCR: PDF pesquisável',
    tagline: 'Digitalizou? Isto reconhece o texto',
    description:
      'Roda um motor de OCR inteiro dentro do navegador (baixa alguns megabytes só na primeira vez) e desenha o texto reconhecido, invisível, por cima da imagem original de cada página. A aparência não muda: o que muda é que agora dá para selecionar, copiar e pesquisar o conteúdo.',
    icon: 'ScanText',
    accent: '20 184 166',
    category: 'Converter',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Reconhecer texto',
    fields: [
      {
        key: 'language',
        type: 'select',
        label: 'Idioma do documento',
        default: 'por+eng',
        options: [
          { value: 'por+eng', label: 'Português + Inglês', hint: 'mais lento, cobre os dois' },
          { value: 'por', label: 'Português' },
          { value: 'eng', label: 'Inglês' },
        ],
        help: 'Escolher o idioma certo deixa o reconhecimento mais rápido e mais preciso.',
      },
    ],
  },
  {
    slug: 'word-para-pdf',
    operation: 'word-to-pdf',
    name: 'Word para PDF',
    tagline: 'O texto do .docx vira um PDF',
    description:
      'Lê os parágrafos de um .docx e monta um PDF em A4 com o texto formatado (negrito é preservado). Layout, colunas, imagens e tabelas do original não atravessam.',
    icon: 'FileType2',
    accent: '13 148 136',
    category: 'Converter',
    accept: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    acceptLabel: 'DOCX',
    multiple: true,
    orderable: true,
    cta: 'Converter para PDF',
    fields: [],
  },
  {
    slug: 'pdf-para-word',
    operation: 'pdf-to-word',
    name: 'PDF para Word',
    tagline: 'O texto do PDF num .docx editável',
    description:
      'Extrai o texto embutido no PDF (o mesmo que "PDF para texto" usa) e monta um documento .docx de verdade. Só o texto atravessa: layout, colunas, imagens e tabelas do original não são preservados. Para PDF digitalizado, rode o OCR antes.',
    icon: 'FileType2',
    accent: '13 148 136',
    category: 'Converter',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Converter para Word',
    fields: [],
  },
  {
    slug: 'extrair-imagens',
    operation: 'extract-images',
    name: 'Extrair imagens',
    tagline: 'Tire as fotos de dentro do PDF',
    description:
      'Varre o documento atrás das imagens embutidas e devolve cada uma como arquivo, sem repetir a mesma imagem em páginas diferentes.',
    icon: 'Images',
    accent: '132 204 22',
    category: 'Converter',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Extrair imagens',
    fields: [
      {
        key: 'format',
        type: 'select',
        label: 'Formato',
        default: 'png',
        options: [
          { value: 'png', label: 'PNG', hint: 'sem perda' },
          { value: 'jpeg', label: 'JPG', hint: 'arquivos menores' },
        ],
      },
      {
        key: 'minSize',
        type: 'range',
        label: 'Ignorar imagens menores que',
        default: 64,
        min: 0,
        max: 400,
        step: 8,
        unit: 'px',
        help: 'Evita exportar ícones, linhas e máscaras decorativas.',
      },
    ],
  },
  {
    slug: 'proteger-pdf',
    operation: 'protect',
    name: 'Proteger PDF',
    tagline: 'Senha de abertura de verdade',
    description:
      'Criptografa o documento com AES. Sem a senha ninguém abre, nem nós. Você ainda escolhe se quem tiver a senha pode imprimir, copiar texto ou editar.',
    icon: 'Lock',
    accent: '4 120 87',
    category: 'Privacidade',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Proteger com senha',
    fields: [
      {
        key: 'password',
        type: 'password',
        label: 'Senha de abertura',
        default: '',
        placeholder: 'mínimo 4 caracteres',
        help: 'Digitada aqui, usada aqui. Ela não é enviada nem guardada em lugar nenhum.',
      },
      { key: 'printing', type: 'toggle', label: 'Permitir impressão', default: true },
      { key: 'copying', type: 'toggle', label: 'Permitir copiar texto', default: true },
      { key: 'modifying', type: 'toggle', label: 'Permitir edição e anotações', default: false },
    ],
  },
  {
    slug: 'desbloquear-pdf',
    operation: 'unlock',
    name: 'Desbloquear PDF',
    tagline: 'Tire a senha e restrições de um arquivo',
    description:
      'Remove restrições de permissão/impressão automaticamente sem senha. Se o arquivo exige senha de abertura, informe-a para gravar uma cópia desbloqueada.',
    icon: 'Unlock',
    accent: '110 231 183',
    category: 'Privacidade',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    allowLocked: true,
    cta: 'Remover senha',
    fields: [
      {
        key: 'password',
        type: 'password',
        label: 'Senha do PDF (opcional)',
        default: '',
        placeholder: 'deixe em branco se não souber',
        help: 'Removemos restrições de permissão sem senha. Se o PDF exigir senha de abertura, digite-a aqui.',
      },
    ],
  },
  {
    slug: 'limpar-metadados',
    operation: 'strip-metadata',
    name: 'Limpar metadados',
    tagline: 'Apague os rastros do arquivo',
    description:
      'Zera autor, título, produtor e datas de criação, que é o que costuma vazar nome, empresa e o software que gerou o documento.',
    icon: 'Eraser',
    accent: '74 222 128',
    category: 'Privacidade',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Limpar metadados',
    fields: [],
  },
  {
    slug: 'definir-metadados',
    operation: 'set-metadata',
    name: 'Definir metadados',
    tagline: 'Escreva título, autor e assunto',
    description:
      'Grava os campos que os leitores e os sistemas de busca mostram no lugar do nome do arquivo. Campo deixado em branco é gravado vazio, apagando o que estava lá.',
    icon: 'Tags',
    accent: '52 211 153',
    category: 'Privacidade',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Gravar metadados',
    fields: [
      { key: 'title', type: 'text', label: 'Título', default: '', placeholder: 'Relatório anual' },
      { key: 'author', type: 'text', label: 'Autor', default: '', placeholder: 'Nome ou empresa' },
      { key: 'subject', type: 'text', label: 'Assunto', default: '', placeholder: 'Do que trata o documento' },
      {
        key: 'keywords',
        type: 'text',
        label: 'Palavras-chave',
        default: '',
        placeholder: 'contrato, 2026, financeiro',
        help: 'Separadas por vírgula.',
      },
    ],
  },
  {
    slug: 'inverter-paginas',
    operation: 'reverse',
    name: 'Inverter páginas',
    tagline: 'A última vira a primeira',
    description:
      'Põe o documento de trás para frente. Resolve a digitalização feita na ordem contrária sem precisar arrastar página por página.',
    icon: 'ArrowUpDown',
    accent: '20 184 166',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Inverter ordem',
    fields: [],
  },
  {
    slug: 'intercalar-pdf',
    operation: 'interleave',
    name: 'Intercalar PDF',
    tagline: 'Frentes e versos num documento só',
    description:
      'Junta dois arquivos alternando as páginas: a 1 do primeiro, a 1 do segundo, a 2 do primeiro, e assim por diante. É o caso do escâner sem duplex, que gera as frentes num arquivo e os versos noutro.',
    icon: 'Shuffle',
    accent: '134 239 172',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: true,
    orderable: true,
    cta: 'Intercalar',
    fields: [
      {
        key: 'reverseSecond',
        type: 'toggle',
        label: 'O segundo arquivo está de trás para frente',
        default: true,
        help: 'Ao virar a pilha de papel e digitalizar de novo, os versos saem na ordem contrária. Mantenha ligado se foi assim.',
      },
    ],
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
  {
    slug: 'achatar-pdf',
    operation: 'flatten',
    name: 'Achatar formulário',
    tagline: 'Trave o que já foi preenchido',
    description:
      'Transforma os campos preenchidos em conteúdo fixo da página. O documento continua legível igual, mas ninguém do outro lado consegue mais alterar as respostas.',
    icon: 'Layers',
    accent: '163 230 53',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Achatar campos',
    fields: [],
  },
  {
    slug: 'cabecalho-rodape',
    operation: 'header-footer',
    name: 'Cabeçalho e rodapé',
    tagline: 'Um texto fixo em toda página',
    description:
      'Carimba o mesmo texto no topo e/ou no pé de todas as páginas. Serve para identificação interna, nome do processo ou aviso de confidencialidade.',
    icon: 'Heading',
    accent: '16 185 129',
    category: 'Editar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Carimbar páginas',
    fields: [
      { key: 'header', type: 'text', label: 'Cabeçalho', default: '', placeholder: 'deixe em branco para não usar' },
      { key: 'footer', type: 'text', label: 'Rodapé', default: '', placeholder: 'deixe em branco para não usar' },
      {
        key: 'align',
        type: 'select',
        label: 'Alinhamento',
        default: 'centro',
        options: [
          { value: 'esquerda', label: 'À esquerda' },
          { value: 'centro', label: 'No centro' },
          { value: 'direita', label: 'À direita' },
        ],
      },
      { key: 'size', type: 'range', label: 'Tamanho da letra', default: 10, min: 6, max: 24, step: 1, unit: 'pt' },
    ],
  },
  {
    slug: 'dividir-paginas',
    operation: 'split-pages',
    name: 'Dividir páginas ao meio',
    tagline: 'Uma folha vira duas ou quatro',
    description:
      'Corta cada página em partes e cada parte vira uma página própria. O caso comum é livro digitalizado, em que o escâner pegou as duas páginas abertas numa imagem só.',
    icon: 'SplitSquareHorizontal',
    accent: '52 211 153',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Dividir páginas',
    fields: [
      {
        key: 'mode',
        type: 'select',
        label: 'Onde cortar',
        default: 'vertical',
        options: [
          { value: 'vertical', label: 'Ao meio, na vertical', hint: 'esquerda e direita' },
          { value: 'horizontal', label: 'Ao meio, na horizontal', hint: 'cima e baixo' },
          { value: 'quatro', label: 'Em quatro', hint: 'grade 2 x 2' },
        ],
      },
    ],
  },
  {
    slug: 'livreto-pdf',
    operation: 'booklet',
    name: 'Livreto',
    tagline: 'Ordem certa para dobrar e grampear',
    description:
      'Reorganiza as páginas para brochura: imprima frente e verso virando na borda curta, dobre a pilha ao meio e grampeie no vinco. As páginas caem na ordem de leitura.',
    icon: 'BookOpen',
    accent: '163 230 53',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Montar livreto',
    fields: [],
  },
  {
    slug: 'separar-pares-impares',
    operation: 'odd-even',
    name: 'Separar pares e ímpares',
    tagline: 'Dois arquivos: ímpares e pares',
    description:
      'Quebra o documento em dois, um com as páginas ímpares e outro com as pares. Serve para imprimir frente e verso numa impressora sem duplex.',
    icon: 'Columns2',
    accent: '20 184 166',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Separar',
    fields: [],
  },
  {
    slug: 'paginas-em-branco',
    operation: 'blank-pages',
    name: 'Inserir páginas em branco',
    tagline: 'Folhas vazias entre as páginas',
    description:
      'Acrescenta folhas em branco do mesmo tamanho das páginas do documento, no começo, no fim ou entre uma página e outra.',
    icon: 'FilePlus',
    accent: '134 239 172',
    category: 'Organizar',
    accept: PDF_ACCEPT,
    acceptLabel: 'PDF',
    multiple: false,
    cta: 'Inserir páginas',
    fields: [
      {
        key: 'where',
        type: 'select',
        label: 'Onde inserir',
        default: 'depois-de-cada',
        options: [
          { value: 'depois-de-cada', label: 'Entre uma página e outra' },
          { value: 'no-inicio', label: 'No começo do documento' },
          { value: 'no-fim', label: 'No fim do documento' },
        ],
      },
      { key: 'count', type: 'number', label: 'Quantas de cada vez', default: 1, min: 1, max: 10 },
    ],
  },
  {
    slug: 'excel-para-pdf',
    operation: 'excel-to-pdf',
    name: 'Excel para PDF',
    tagline: 'As células da planilha viram documento',
    description:
      'Lê as abas de um .xlsx e monta um PDF com as células alinhadas em colunas. Fórmula entra com o resultado que o Excel gravou. Gráficos, imagens, cores e células mescladas não atravessam.',
    icon: 'Table',
    accent: '16 185 129',
    category: 'Converter',
    accept: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
    acceptLabel: 'XLSX',
    multiple: true,
    orderable: true,
    cta: 'Converter para PDF',
    fields: [],
  },
  {
    slug: 'powerpoint-para-pdf',
    operation: 'powerpoint-to-pdf',
    name: 'PowerPoint para PDF',
    tagline: 'O texto dos slides num documento',
    description:
      'Lê os slides de um .pptx na ordem e monta um PDF com o texto de cada um. Layout, imagens, cores e animações não atravessam: é o roteiro da apresentação, não a apresentação.',
    icon: 'Presentation',
    accent: '134 239 172',
    category: 'Converter',
    accept: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
    acceptLabel: 'PPTX',
    multiple: true,
    orderable: true,
    cta: 'Converter para PDF',
    fields: [],
  },
  {
    slug: 'texto-para-pdf',
    operation: 'text-to-pdf',
    name: 'Texto para PDF',
    tagline: 'Um .txt vira documento',
    description:
      'Lê um arquivo de texto e monta um PDF em A4 com quebra de linha automática. O caminho inverso de "PDF para texto".',
    icon: 'FileText',
    accent: '101 163 13',
    category: 'Converter',
    accept: ['text/plain', '.txt'],
    acceptLabel: 'TXT',
    multiple: true,
    orderable: true,
    cta: 'Gerar PDF',
    fields: [
      { key: 'size', type: 'range', label: 'Tamanho da letra', default: 11, min: 7, max: 18, step: 1, unit: 'pt' },
    ],
  },
];

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
