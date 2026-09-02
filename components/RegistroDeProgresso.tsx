'use client';

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { cx, formatDuration } from '@/lib/utils';

export type LinhaDoRegistro = { texto: string; em: number };

/**
 * O que o programa está fazendo, linha a linha.
 *
 * Existe porque uma barra de progresso sozinha não distingue "está lento" de
 * "travou": nos dois casos ela fica parada. Aqui aparece qual arquivo, qual
 * página e há quanto tempo — se a última linha for de vinte segundos atrás,
 * a coisa empacou, e dá para cancelar sabendo onde.
 */
export function RegistroDeProgresso({
  linhas,
  aberto,
  onAlternar,
  inicio,
}: {
  linhas: LinhaDoRegistro[];
  aberto: boolean;
  onAlternar: () => void;
  inicio: number;
}) {
  const fimRef = useRef<HTMLDivElement>(null);

  // Acompanha a última linha sem puxar a página junto.
  useEffect(() => {
    if (aberto) fimRef.current?.scrollIntoView({ block: 'nearest' });
  }, [linhas.length, aberto]);

  if (!linhas.length) return null;
  const ultima = linhas[linhas.length - 1];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-bg/60">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted transition hover:text-ink"
        aria-expanded={aberto}
      >
        <Terminal className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono">{ultima.texto}</span>
        <span className="shrink-0 tabular-nums">{formatDuration(ultima.em - inicio)}</span>
        {aberto ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {aberto && (
        <ol className="max-h-52 space-y-0.5 overflow-y-auto border-t border-line px-3 py-2 font-mono text-[11px]">
          {linhas.map((linha, i) => (
            <li key={`${linha.em}-${i}`} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-muted/60">{formatDuration(linha.em - inicio)}</span>
              <span className={cx('min-w-0 flex-1', i === linhas.length - 1 ? 'text-ink' : 'text-muted')}>
                {linha.texto}
              </span>
            </li>
          ))}
          <div ref={fimRef} />
        </ol>
      )}
    </div>
  );
}
