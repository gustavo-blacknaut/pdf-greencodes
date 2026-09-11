import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Monitor, ShieldAlert } from 'lucide-react';
import { BaixarAplicativo } from '@/components/BaixarAplicativo';
import { LIMITE_DO_APLICATIVO, PAGINA_DAS_VERSOES } from '@/lib/aplicativo';
import { TOOLS, TOOLS_DO_SITE, TOOLS_SO_NO_APLICATIVO, rotaDaFerramenta } from '@/lib/tools';

export const metadata: Metadata = {
  title: 'Baixar o aplicativo para Windows',
  description: `O PDF.GreenCodes para Windows: ${TOOLS.length} ferramentas de PDF e de gráfica, arquivos de até ${LIMITE_DO_APLICATIVO} e o resultado direto na pasta Downloads. Grátis.`,
  alternates: { canonical: '/baixar' },
};

export default function BaixarPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-8 pt-14 sm:px-6 sm:pt-20">
      <div className="text-center">
        <span className="chip border-brand/40 text-brand">
          <Monitor className="h-3.5 w-3.5" /> Windows 10 e 11 · 64 bits
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">O aplicativo para Windows</h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          O site tem as {TOOLS_DO_SITE.length} ferramentas do dia a dia. O aplicativo tem todas as {TOOLS.length},
          com o motor de PDF rápido e o trabalho de gráfica. É grátis, e o arquivo continua no seu computador.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <BaixarAplicativo className="px-7 py-3.5 text-base" />
          <a href={PAGINA_DAS_VERSOES} rel="noopener" className="btn-ghost px-5 py-3.5 text-base">
            O que mudou na última versão
          </a>
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-[15px] font-semibold tracking-tight">No site</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {[
              `${TOOLS_DO_SITE.length} ferramentas básicas`,
              'Arquivos de até 200 MB',
              'Roda no navegador, com o motor que ele tem',
              'Você baixa o resultado',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-muted/60">—</span> {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="card border-brand/40 p-6">
          <h2 className="text-[15px] font-semibold tracking-tight text-brand">No aplicativo</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              `Todas as ${TOOLS.length} ferramentas`,
              `Arquivos de até ${LIMITE_DO_APLICATIVO}`,
              'Motor de PDF até 16 vezes mais rápido em arquivo grande',
              'O resultado aparece sozinho na pasta Downloads',
              'Impressão com escala, posição, espelho e marcas de corte',
              'Funciona sem internet',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="card mt-4 p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <ShieldAlert className="h-4 w-4 text-amber-400" /> Se o Windows mostrar &quot;O Windows protegeu o computador&quot;
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          O aviso aparece com programa que ainda não tem assinatura digital paga, e não quer dizer que haja algo
          errado nele. Para instalar:
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            Se o navegador perguntar, escolha <strong>Manter</strong>.
          </li>
          <li>Abra o arquivo baixado.</li>
          <li>
            Na tela azul, clique em <strong>Mais informações</strong> e depois em{' '}
            <strong>Executar assim mesmo</strong>.
          </li>
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Quem tinha a versão antiga não precisa desinstalar antes: o instalador troca uma pela outra.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-lg font-semibold tracking-tight">Só no aplicativo</h2>
        <p className="mt-1 text-sm text-muted">
          {TOOLS_SO_NO_APLICATIVO.length} ferramentas que o site não tem.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {TOOLS_SO_NO_APLICATIVO.map((tool) => (
            <Link
              key={tool.slug}
              href={rotaDaFerramenta(tool, '')}
              className="rounded-full border px-3 py-1.5 text-[13px] text-ink/85 transition hover:border-brand/50 hover:text-brand"
            >
              {tool.name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
