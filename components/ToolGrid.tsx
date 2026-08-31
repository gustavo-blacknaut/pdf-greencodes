'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { CATEGORIES, TOOLS, type Tool } from '@/lib/tools';
import { warmEngine } from '@/lib/pdf/lazy';
import { ToolIcon } from './ToolIcon';
import { cx } from '@/lib/utils';

export function ToolGrid() {
  const router = useRouter();
  const [filter, setFilter] = useState<string>('Todas');

  const visible = filter === 'Todas' ? TOOLS : TOOLS.filter((tool) => tool.category === filter);

  /** Hover = intenção. Buscamos a rota e aquecemos o motor antes do clique. */
  function preload(tool: Tool) {
    router.prefetch(`/${tool.slug}`);
    void warmEngine({ raster: tool.operation === 'compress' || tool.operation === 'pdf-to-images' });
  }

  return (
    <section id="ferramentas" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Todas as ferramentas</h2>
          <p className="mt-1.5 text-sm text-muted">Escolha uma. O arquivo continua no seu computador.</p>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((tool, index) => (
          <Link
            key={tool.slug}
            href={`/${tool.slug}`}
            onPointerEnter={() => preload(tool)}
            onFocus={() => preload(tool)}
            className="group card relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1 animate-fade-up"
            style={{ animationDelay: `${Math.min(index * 30, 350)}ms` }}
          >
            <span
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30"
              style={{ background: `rgb(${tool.accent})` }}
              aria-hidden
            />
            <span
              className="grid h-11 w-11 place-items-center rounded-xl border"
              style={{ background: `rgb(${tool.accent} / 0.12)`, borderColor: `rgb(${tool.accent} / 0.28)` }}
            >
              <ToolIcon name={tool.icon} className="h-5 w-5" />
            </span>

            <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{tool.name}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{tool.tagline}</p>

            <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand opacity-0 transition-all duration-300 group-hover:opacity-100">
              Abrir <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
