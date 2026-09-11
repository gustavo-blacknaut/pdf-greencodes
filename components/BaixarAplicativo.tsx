import { Download } from 'lucide-react';
import { LINK_DO_INSTALADOR } from '@/lib/aplicativo';
import { cx } from '@/lib/utils';

/**
 * O botão que baixa o instalador.
 *
 * Um link comum para a última release do GitHub, e não um download feito por
 * script: o navegador cuida da barra, da pasta e do "Manter" do SmartScreen,
 * que é onde a pessoa espera encontrar tudo isso.
 */
export function BaixarAplicativo({
  className,
  texto = 'Baixar o aplicativo',
  discreto,
}: {
  className?: string;
  texto?: string;
  /** Versão fantasma, para ficar ao lado de outro botão principal. */
  discreto?: boolean;
}) {
  return (
    <a
      href={LINK_DO_INSTALADOR}
      rel="noopener"
      className={cx(discreto ? 'btn-ghost' : 'btn-primary', className)}
    >
      <Download className="h-4 w-4" /> {texto}
    </a>
  );
}
