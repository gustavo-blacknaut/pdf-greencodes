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

export const PDF_ACCEPT = ['application/pdf', '.pdf'];
export const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp'];
