import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { BaixarAplicativo } from './BaixarAplicativo';

/**
 * O erro de uma ferramenta, e a saída quando existe uma.
 *
 * No site, arquivo acima do limite tem saída — o aplicativo —, e o botão vem
 * junto da mensagem: quem acabou de ser recusado não vai procurar o link.
 */
export function ErroDaFerramenta({ erro, sugerirApp }: { erro: string; sugerirApp?: boolean }) {
  return (
    <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-500">
      <div className="flex gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{erro}</span>
      </div>
      {sugerirApp && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
          <BaixarAplicativo className="px-3 py-2 text-xs" />
          <Link href="/baixar" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Como instalar
          </Link>
        </div>
      )}
    </div>
  );
}
