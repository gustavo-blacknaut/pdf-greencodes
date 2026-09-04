import type { OperationId } from '../pdf/engine';

/**
 * A forma de uma ferramenta no catálogo.
 *
 * Fica separado do catálogo em si para que o arquivo de cada categoria só
 * descreva ferramentas, sem carregar definição de tipo junto.
 */
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
  category: 'Otimizar' | 'Organizar' | 'Converter' | 'Editar' | 'Gráfica' | 'Imagem' | 'Privacidade';
  accept: string[];
  acceptLabel: string;
  multiple: boolean;
  orderable?: boolean;
  /** Aceita PDFs com senha de abertura (só a ferramenta de desbloqueio). */
  allowLocked?: boolean;
  /**
   * Não aparece no site.
   *
   * Para o que depende do motor do aplicativo e não tem como funcionar no
   * navegador — gravar DeviceCMYK, por exemplo. Mostrar no site levaria a
   * pessoa a uma tela que não entrega o que promete.
   */
  soNoAplicativo?: boolean;
  /** Substitui o painel de opções pela grade visual de páginas. */
  board?: BoardMode;
  /** Abre o editor visual sobre a página. */
  editor?: 'completo' | 'assinatura';
  cta: string;
  fields: Field[];
};

export const PDF_ACCEPT = ['application/pdf', '.pdf'];
export const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp'];

/**
 * As resoluções que as ferramentas de desenho oferecem.
 *
 * 600 e 1200 existem porque impressora de 600 e de 1200 DPI existe. Mas DPI de
 * impressora e DPI de imagem não são a mesma coisa: os 1200 de uma laser são
 * endereçamento de retícula — de quantos pontinhos ela dispõe para simular
 * meio-tom —, não a resolução que o arquivo precisa ter. Foto a 300 numa
 * impressora de 1200 sai perfeita; a 1200 sai igual, com o arquivo dezesseis
 * vezes maior. Onde 600 e 1200 ganham de verdade é em traço e texto fininho.
 */
export const OPCOES_DE_DPI = [
  { value: '110', label: 'Rascunho', hint: '110 DPI · arquivo menor' },
  { value: '150', label: 'Normal', hint: '150 DPI · bom para ler na tela' },
  { value: '300', label: 'Impressão', hint: '300 DPI · o padrão de gráfica' },
  { value: '600', label: 'Alta', hint: '600 DPI · para traço fino; arquivo bem maior' },
  { value: '1200', label: 'Máxima', hint: '1200 DPI · só para traço; foto não ganha e o arquivo pesa muito' },
];
