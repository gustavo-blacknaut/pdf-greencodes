'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Monitor } from 'lucide-react';
import { BaixarAplicativo } from './BaixarAplicativo';
import { CATEGORIES, TOOLS, TOOLS_DO_SITE, TOOLS_SO_NO_APLICATIVO, rotaDaFerramenta, type Tool } from '@/lib/tools';
import { warmEngine } from '@/lib/pdf/lazy';
import { ToolIcon } from './ToolIcon';
import { cx } from '@/lib/utils';

/**
 * A grade do site, em duas partes: o que roda aqui e o que é do aplicativo.
 *
 * As do aplicativo aparecem inteiras, com nome e descrição, em vez de sumir:
 * cada uma é o motivo de alguém baixar o programa.
 */
export function ToolGrid() {
  const router = useRouter();
  const [filter, setFilter] = useState<string>('Todas');

  const naCategoria = (lista: Tool[]) => (filter === 'Todas' ? lista : lista.filter((t) => t.category === filter));
  const noSite = naCategoria(TOOLS_DO_SITE);
  const noApp = naCategoria(TOOLS_SO_NO_APLICATIVO);

  /** Hover = intenção. Buscamos a rota e aquecemos o motor antes do clique. */
  function preload(tool: Tool) {
    router.prefetch(rotaDaFerramenta(tool, ''));
    void warmEngine({ raster: tool.operation === 'compress' || tool.operation === 'pdf-to-images' });
  }

  return (
    <section id="ferramentas" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Todas as ferramentas</h2>
          <p className="mt-1.5 text-sm text-muted">
            {TOOLS_DO_SITE.length} rodam aqui no navegador. As {TOOLS.length} estão no aplicativo para Windows.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {['Todas', ...CATEGORIES].map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setFilter(category)}
              className={cx(
                'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
                filter === category
                  ? 'border-transparent bg-ink text-bg'
                  : 'text-muted hover:border-brand/40 hover:text-ink',
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {noSite.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {noSite.map((tool, index) => (
            <Cartao key={tool.slug} tool={tool} index={index} onPreload={preload} />
          ))}
        </div>
      )}

      {noApp.length > 0 && (
        <div className={cx(noSite.length > 0 && 'mt-14')}>
          <div
            className="card mb-5 flex flex-wrap items-center gap-4 p-5"
            style={{ backgroundImage: 'linear-gradient(120deg, rgb(var(--brand) / 0.10), transparent 60%)' }}
          >
            <Monitor className="h-6 w-6 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold tracking-tight">Só no aplicativo para Windows</h3>
              <p className="mt-0.5 text-sm text-muted">
                {noApp.length} ferramentas {filter === 'Todas' ? '' : `de ${filter.toLowerCase()} `}que o site não
                tem. Grátis, mais rápido e aceita arquivos de até 2 GB.
              </p>
            </div>
            <BaixarAplicativo className="shrink-0" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {noApp.map((tool, index) => (
              <Cartao key={tool.slug} tool={tool} index={index} soNoApp />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Cartao({
  tool,
  index,
  soNoApp,
  onPreload,
}: {
  tool: Tool;
  index: number;
  soNoApp?: boolean;
  onPreload?: (tool: Tool) => void;
}) {
  return (
    <Link
      href={rotaDaFerramenta(tool, '')}
      onPointerEnter={() => onPreload?.(tool)}
      onFocus={() => onPreload?.(tool)}
      className={cx(
        'group card relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1 animate-fade-up',
        soNoApp && 'opacity-85 hover:opacity-100',
      )}
      style={{ animationDelay: `${Math.min(index * 30, 350)}ms` }}
    >
      <span
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30"
        style={{ background: `rgb(${tool.accent})` }}
        aria-hidden
      />
      {soNoApp ? (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-brand/40 px-2 py-0.5 text-[11px] font-medium text-brand">
          <Monitor className="h-3 w-3" /> App
        </span>
      ) : (
        <span className="absolute right-4 top-4 text-xs tabular-nums text-muted/70">{index + 1}</span>
      )}
      <span
        className="grid h-11 w-11 place-items-center rounded-xl border"
        style={{ background: `rgb(${tool.accent} / 0.12)`, borderColor: `rgb(${tool.accent} / 0.28)` }}
      >
        <ToolIcon name={tool.icon} className="h-5 w-5" />
      </span>

      <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{tool.name}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{tool.tagline}</p>

      <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand opacity-0 transition-all duration-300 group-hover:opacity-100">
        {soNoApp ? 'Ver no aplicativo' : 'Abrir'}{' '}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
