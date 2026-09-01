import Link from 'next/link';
import { CATEGORIES, TOOLS } from '@/lib/tools';

export function Footer() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_2fr]">
        <div>
          <p className="text-lg font-semibold tracking-tight">PDF.GreenCodes</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            Ferramentas de PDF que rodam dentro do navegador. Sem upload, sem fila e sem conta. O resultado sai da
            memória assim que o download termina.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {CATEGORIES.map((category) => {
            const items = TOOLS.filter((tool) => tool.category === category);
            if (!items.length) return null;
            return (
              <div key={category}>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{category}</p>
                <ul className="space-y-2">
                  {items.map((tool) => (
                    <li key={tool.slug}>
                      <Link href={`/${tool.slug}`} className="text-sm text-ink/80 transition hover:text-brand">
                        {tool.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} PDF.GreenCodes</p>
          <Link href="/privacidade" className="transition hover:text-ink">
            O que acontece com seus arquivos
          </Link>
        </div>
      </div>
    </footer>
  );
}
