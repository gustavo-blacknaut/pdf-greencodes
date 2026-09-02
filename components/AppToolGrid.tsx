'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CATEGORIES, TOOLS, rotaDaFerramenta, type Tool } from '@/lib/tools';
import { warmEngine } from '@/lib/pdf/lazy';
import { ToolIcon } from './ToolIcon';
import { cx } from '@/lib/utils';

/** "compressao" acha "Compressão": busca sem acento e sem caixa. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function AppToolGrid() {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('Todas');

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim());
    return TOOLS.filter((tool) => {
      if (categoria !== 'Todas' && tool.category !== categoria) return false;
      if (!termo) return true;
      return normalizar(`${tool.name} ${tool.tagline} ${tool.category}`).includes(termo);
    });
  }, [busca, categoria]);

  function preparar(tool: Tool) {
    router.prefetch(rotaDaFerramenta(tool, '/app'));
    void warmEngine({ raster: tool.operation === 'compress' || tool.operation === 'pdf-to-images' });
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ferramenta"
            aria-label="Buscar ferramenta"
            className="input pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {['Todas', ...CATEGORIES].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategoria(item)}
              className={cx(
                'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                categoria === item ? 'border-transparent bg-ink text-bg' : 'text-muted hover:text-ink',
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">Nenhuma ferramenta com esse nome.</p>
      ) : (
        <>
        <p className="mt-4 text-xs text-muted">
          {visiveis.length === TOOLS.length
            ? `${TOOLS.length} ferramentas`
            : `${visiveis.length} de ${TOOLS.length} ferramentas`}
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((tool, indice) => (
            <Link
              key={tool.slug}
              href={rotaDaFerramenta(tool, '/app')}
              onPointerEnter={() => preparar(tool)}
              onFocus={() => preparar(tool)}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 transition hover:border-brand/50 hover:bg-elevated"
            >
              <span className="w-5 shrink-0 pt-1.5 text-right text-[11px] tabular-nums text-muted">{indice + 1}</span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg text-brand">
                <ToolIcon name={tool.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium tracking-tight">{tool.name}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{tool.tagline}</span>
              </span>
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
