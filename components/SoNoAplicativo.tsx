import Link from 'next/link';
import { ArrowRight, Check, Monitor } from 'lucide-react';
import { BaixarAplicativo } from './BaixarAplicativo';
import { ToolIcon } from './ToolIcon';
import { LIMITE_DO_APLICATIVO } from '@/lib/aplicativo';
import { TOOLS, TOOLS_DO_SITE, rotaDaFerramenta, type Tool } from '@/lib/tools';

/**
 * A página, no site, de uma ferramenta que só roda no aplicativo.
 *
 * Existe em vez de um 404 porque quem chega procurando "separar chapas" ou
 * "marcas de corte" deve encontrar a ferramenta — e o caminho até ela.
 */
export function SoNoAplicativo({ tool }: { tool: Tool }) {
  const noSite = TOOLS_DO_SITE.filter((item) => item.category === tool.category).slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
      <div className="flex items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border text-brand"
          style={{ background: `rgb(${tool.accent} / 0.12)`, borderColor: `rgb(${tool.accent} / 0.3)` }}
        >
          <ToolIcon name={tool.icon} className="h-6 w-6" />
        </span>
        <div>
          <span className="chip border-brand/40 text-brand">
            <Monitor className="h-3.5 w-3.5" /> Só no aplicativo para Windows
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{tool.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">{tool.description}</p>
        </div>
      </div>

      <div
        className="card mt-8 overflow-hidden p-6 sm:p-8"
        style={{
          backgroundImage: 'linear-gradient(135deg, rgb(var(--brand) / 0.10), transparent 60%)',
        }}
      >
        <h2 className="text-lg font-semibold tracking-tight">Esta ferramenta é do aplicativo</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          O site tem o básico. O trabalho de gráfica e as ferramentas mais completas ficam no aplicativo, que é
          grátis e roda no seu computador — o arquivo continua sem ir para servidor nenhum.
        </p>

        <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
          {[
            `Todas as ${TOOLS.length} ferramentas, esta incluída`,
            'Motor de PDF até 16 vezes mais rápido em arquivo grande',
            `Arquivos de até ${LIMITE_DO_APLICATIVO} — no site o limite é 200 MB`,
            'O resultado vai direto para a pasta Downloads',
            'Impressão com escala, posição e marcas de corte',
            'Funciona sem internet',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <BaixarAplicativo className="px-6 py-3 text-[15px]" />
          <Link href="/baixar" className="btn-ghost px-5 py-3 text-[15px]">
            Como instalar
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted">Windows 10 e 11 · 64 bits · grátis</p>
      </div>

      {noSite.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-semibold tracking-tight text-muted">
            No navegador, em {tool.category.toLowerCase()}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {noSite.map((item) => (
              <Link
                key={item.slug}
                href={rotaDaFerramenta(item, '')}
                className="group card flex items-center gap-2 p-4 transition hover:-translate-y-0.5"
              >
                <span className="text-sm font-medium">{item.name}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
