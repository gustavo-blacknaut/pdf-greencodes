import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { ToolWorkspace } from '@/components/ToolWorkspace';
import { getTool, TOOLS_DO_SITE } from '@/lib/tools';

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  // A de impressão tem página própria; gerar /imprimir aqui colidiria com ela.
  return TOOLS_DO_SITE.filter((tool) => !tool.rota).map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return { title: 'Ferramenta não encontrada' };
  return {
    title: `${tool.name} online e privado`,
    description: `${tool.description} Sem upload: tudo roda no seu navegador.`,
    alternates: { canonical: `/${tool.slug}` },
  };
}

export default async function ToolPage({ params }: Params) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const related = TOOLS_DO_SITE.filter((item) => item.slug !== tool.slug && item.category === tool.category).slice(0, 3);

  return (
    <>
      <ToolWorkspace tool={tool} />

      {related.length > 0 && (
        <section className="mx-auto mt-16 max-w-5xl px-4 sm:px-6">
          <h2 className="text-sm font-semibold tracking-tight text-muted">Também em {tool.category.toLowerCase()}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link
                key={item.slug}
                href={`/${item.slug}`}
                className="group card flex items-center gap-2 p-4 transition hover:-translate-y-0.5"
              >
                <span className="text-sm font-medium">{item.name}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
