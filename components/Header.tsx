'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LayoutGrid, Menu, X } from 'lucide-react';
import { CATEGORIES, TOOLS } from '@/lib/tools';
import { warmEngine } from '@/lib/pdf/lazy';
import { cx } from '@/lib/utils';

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled ? 'border-line bg-bg/90' : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-128.png"
            alt="PDF GreenCodes"
            className="h-9 w-9 shrink-0 transition-transform group-hover:scale-105"
          />
          {/* A marca é o próprio endereço: quem chega aqui já sabe onde voltar. */}
          <span className="text-[17px] font-semibold leading-none tracking-tight">
            <span className="text-brand">PDF</span>
            <span className="text-muted">.</span>
            GreenCodes
            <span className="hidden text-sm font-normal text-muted sm:inline">.com.br</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          <Link href="/#ferramentas" className="rounded-lg px-3 py-2 text-sm text-muted transition hover:text-ink">
            Ferramentas
          </Link>
          <Link href="/#como-funciona" className="rounded-lg px-3 py-2 text-sm text-muted transition hover:text-ink">
            Como funciona
          </Link>
          <Link href="/privacidade" className="rounded-lg px-3 py-2 text-sm text-muted transition hover:text-ink">
            Privacidade
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/#ferramentas"
            onPointerEnter={() => void warmEngine()}
            className="btn-primary hidden sm:inline-flex"
          >
            <LayoutGrid className="h-4 w-4" /> Ver ferramentas
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-xl border text-muted md:hidden"
            aria-label="Abrir menu"
            aria-expanded={open}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t bg-bg md:hidden">
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
            {CATEGORIES.map((category) => {
              const items = TOOLS.filter((tool) => tool.category === category);
              if (!items.length) return null;
              return (
                <div key={category}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{category}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {items.map((tool) => (
                      <Link
                        key={tool.slug}
                        href={`/${tool.slug}`}
                        onClick={() => setOpen(false)}
                        className="rounded-lg px-2 py-1.5 text-sm text-ink/90 hover:bg-elevated"
                      >
                        {tool.name}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
